/**
 * Admin routes — analytics data API, compliance score capture, IndexNow trigger, manual user creation.
 * Owns: admin-facing analytics, compliance-score lead capture, IndexNow manual trigger, founder-only user provisioning.
 * Does NOT own: admin HTML pages (routes/pages.js), user-facing API (routes/api.js).
 */
const express = require('express');
const router = express.Router();
const { hashPassword, signToken, canalsForPlan } = require('../middleware/auth');
const { getDailyViews, getTopPages, getTopReferrers, getTopEvents, getFunnelData, getUtmSources } = require('../db/page-views');
const { insertComplianceScoreLead, updateComplianceScoreEmail, insertComplianceScoreWithEmail } = require('../db/compliance-scores');
const { upsertLead, insertLeadIfNew } = require('../db/leads');
const { getUserByEmail, createUser } = require('../db/users');

// ── Analytics data API (used by admin page) ────────────────────────────────
router.get('/admin/analytics', async (req, res) => {
  const adminToken = process.env.ANALYTICS_ADMIN_TOKEN;
  const provided = req.query.token || req.headers['x-admin-token'];
  if (adminToken && provided !== adminToken) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const pool = req.app.locals.pool;
  const days = parseInt(req.query.days) || 14;

  try {
    const [dailyViews, topPages, topReferrers, topEvents, funnelData, utmSources] = await Promise.all([
      getDailyViews(pool, days),
      getTopPages(pool, days),
      getTopReferrers(pool, days),
      getTopEvents(pool, days),
      getFunnelData(pool, days),
      getUtmSources(pool, days),
    ]);

    res.json({
      success: true,
      days,
      daily_views: dailyViews,
      top_pages: topPages,
      top_referrers: topReferrers,
      top_events: topEvents,
      funnel: funnelData,
      utm_sources: utmSources,
    });
  } catch (err) {
    console.error('[Admin Analytics] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Compliance Score Tool — save assessment ────────────────────────────────
router.post('/compliance-score', async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    imo_number, vessel_name, flag_state, vessel_type,
    gross_tonnage, transit_date, cargo_type,
    overall_score, vumpa_score, pcsopep_score, docs_score, risk_score, risk_flags,
  } = req.body || {};

  try {
    const lead = await insertComplianceScoreLead(pool, {
      imo_number, vessel_name, flag_state, vessel_type, gross_tonnage,
      transit_date, cargo_type, overall_score, vumpa_score, pcsopep_score,
      docs_score, risk_score, risk_flags,
    });
    return res.json({ success: true, lead_id: lead.id });
  } catch (err) {
    console.error('[ComplianceScore] insert error:', err.message);
    return res.json({ success: false, lead_id: null });
  }
});

// ── Compliance Score — email capture ────────────────────────────────────────
router.post('/compliance-score/email', async (req, res) => {
  const pool = req.app.locals.pool;
  const { email, lead_id, imo_number, vessel_name, overall_score } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }

  try {
    if (lead_id) {
      await updateComplianceScoreEmail(pool, lead_id, email);
    } else {
      await insertLeadIfNew(pool, {
        email, company_name: vessel_name ? `Vessel: ${vessel_name}` : null,
        fleet_size: imo_number || null, source: 'compliance_score',
      }).catch(() => {});

      await insertComplianceScoreWithEmail(pool, {
        imo_number, vessel_name, overall_score, email,
      });
    }

    await upsertLead(pool, {
      email, company_name: vessel_name ? `Vessel: ${vessel_name}` : null,
      fleet_size: imo_number || null, source: 'compliance_score',
    }).catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    console.error('[ComplianceScore] email capture error:', err.message);
    return res.json({ success: false });
  }
});

// ── Admin: Manual user creation (bypasses Stripe — for manual/invoiced sales) ─
router.post('/admin/create-user', async (req, res) => {
  // Hardcoded admin secret — only the founder uses this endpoint.
  const adminToken = process.env.ADMIN_TOKEN || 'admin-secret-key';
  const provided = req.headers['x-admin-token'] || req.query.token;
  if (provided !== adminToken) {
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }

  const pool = req.app.locals.pool;
  // canals: optional override for allowed_canals (e.g. ['panama','suez']).
  // If not provided, derived from the plan. Use ['all'] as shorthand for all waterways.
  const { email, password, plan, vessel_count, canals } = req.body || {};

  // Validate required fields
  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
  }

  // Map incoming plan tier to internal subscription_plan + plan_type + vessel_limit.
  // Accepted plan values: agent_pro, ops_manager, bundle
  // Canal variants also accepted: agent_pro_panama, agent_pro_suez, agent_pro_bundle, ops_manager_panama, etc.
  const PLAN_ALIASES = {
    agent_pro:          'agent_pro_bundle',
    ops_manager:        'ops_manager_bundle',
    bundle:             'agent_pro_bundle',
  };
  const subscriptionPlan = PLAN_ALIASES[plan] || plan || 'agent_pro_bundle';

  // Derive plan_type from subscription_plan
  let planType;
  if (subscriptionPlan.startsWith('ops_manager')) planType = 'ops_manager';
  else if (subscriptionPlan.startsWith('agent_pro')) planType = 'agent_pro';
  else planType = 'agent_pro'; // safe default

  // vessel_limit: null = unlimited (agent_pro); explicit count for ops_manager
  const vesselLimit = planType === 'ops_manager'
    ? (vessel_count ? parseInt(vessel_count, 10) : 5)
    : null;

  // Compute allowed_canals: explicit override takes precedence over plan derivation.
  // ['all'] shorthand expands to all known waterways.
  const ALL_CANALS = ['panama', 'suez', 'bosporus', 'malacca'];
  let allowedCanals;
  if (canals && Array.isArray(canals) && canals.length > 0) {
    allowedCanals = canals.includes('all') ? ALL_CANALS : canals.filter(c => ALL_CANALS.includes(c));
  } else {
    allowedCanals = canalsForPlan(subscriptionPlan);
    // Bundle plans and full-access legacy plans get all canals
    if (allowedCanals.length === 0) allowedCanals = ALL_CANALS;
  }

  // Set far-future expiry — manually managed accounts don't auto-expire.
  // 10 years out is effectively permanent without being a sentinel value.
  const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const normalized = email.toLowerCase().trim();

    // Reject if user already exists — don't overwrite active accounts
    const existing = await getUserByEmail(pool, normalized);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `User ${normalized} already exists (id=${existing.id}, status=${existing.subscription_status}). Use /api/admin/update-user if you need to change their plan.`,
      });
    }

    const hash = await hashPassword(password);

    const user = await createUser(pool, {
      email: normalized,
      password_hash: hash,
      subscription_status: 'active',
      subscription_plan: subscriptionPlan,
      subscription_expires_at: expiresAt,
      vessel_limit: vesselLimit,
      plan_type: planType,
      allowed_canals: allowedCanals,
    });
    const token = signToken(user);

    console.log(`[AdminCreateUser] Provisioned ${normalized} (plan=${subscriptionPlan}, type=${planType}, vessels=${vesselLimit ?? 'unlimited'}, canals=${allowedCanals.join(',')})`);

    return res.status(201).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan,
        plan_type: user.plan_type,
        vessel_limit: user.vessel_limit,
        allowed_canals: user.allowed_canals,
        created_at: user.created_at,
      },
      // JWT token in case caller wants to verify immediately
      token,
      login_url: `https://canalclear.org/login`,
      note: 'User can log in immediately. Onboarding flow will run on first login.',
    });
  } catch (err) {
    console.error('[AdminCreateUser] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: Manual IndexNow trigger ──────────────────────────────────────────
router.post('/admin/trigger-indexnow', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN || 'admin-secret-key';
  const provided = req.query.token || req.headers['x-admin-token'];
  if (provided !== adminToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { pingIndexNow, INDEXNOW_URLS } = require('../services/startup');
  await pingIndexNow();
  res.json({ success: true, urls_submitted: INDEXNOW_URLS.length, message: `Pinged IndexNow with ${INDEXNOW_URLS.length} URLs` });
});

module.exports = router;
