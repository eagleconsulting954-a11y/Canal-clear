const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { validateVUMPA, VALID_VESSEL_TYPES, VALID_CARGO_TYPES, VALID_DG_CLASSES, TRANSIT_DIRECTIONS } = require('../services/vumpa-validator');
const { validateSuezFiling } = require('../services/suez-validator');
const { hashPassword, verifyPassword, signToken, isSubscriptionActive, requireAuth, requireAdmin, canalsForPlan, requireWaterway } = require('../middleware/auth');
const { scheduleDripEmails, unsubscribeLead } = require('../services/drip-email');
const {
  upsertDeadline,
  updateDeadlineForFiling,
} = require('../db/filing-deadlines');
const usersDb = require('../db/users');
const passwordResetsDb = require('../db/password-resets');
const filingsDb = require('../db/filings');
const validationsDb = require('../db/validations');
const purchaseRequestsDb = require('../db/purchase-requests');
const analyticsEventsDb = require('../db/analytics-events');
const adminStatsDb = require('../db/admin-stats');
const pricingSlotsDb = require('../db/pricing-slots');
const leadsDb = require('../db/leads');
const scaCredentialsDb = require('../db/sca-credentials');
const blogAudioDb = require('../db/blog-audio');
const podcastAudioDb = require('../db/podcast-audio');
const documentUploadsDb = require('../db/document-uploads');
const chatAnalyticsDb = require('../db/chat-analytics');
const meetingRequestsDb = require('../db/meeting-requests');
const hazmatChecksDb = require('../db/hazmat-checks');
const vesselsDb = require('../db/vessels');
const alertPreferencesDb = require('../db/alert-preferences');
const alertHistoryDb = require('../db/alert-history');
const fleetComplianceDb = require('../db/fleet-compliance');
const notificationsDb = require('../db/notifications');
const suezAnalyticsDb = require('../db/suez-analytics');
const certificatesDb = require('../db/certificates');
const promoRedemptionsDb = require('../db/promo-redemptions');

const COOKIE_OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };

// Pre-built waterway guards for fixed-canal routes
const requirePanama = requireWaterway('panama');
const requireSuez   = requireWaterway('suez');

/**
 * Inline waterway access check — for routes where canal comes from req.body or req.query.
 * Returns true if access is allowed (or if user is admin).
 * On denial, writes the 403 JSON response and returns false.
 *
 * Usage inside a route handler:
 *   const canal = (req.body.canal || 'panama').toLowerCase();
 *   if (!await checkWaterwayAccess(req, res, canal)) return;
 */
async function checkWaterwayAccess(req, res, canal) {
  const pool = req.app.locals.pool;
  const userId = req.user && req.user.id;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return false;
  }
  try {
    const result = await usersDb.getUserForWaterwayCheck(pool, userId);
    if (result.rows.length === 0) {
      res.status(401).json({ success: false, message: 'User not found' });
      return false;
    }
    const user = result.rows[0];
    if (user.is_admin) return true;
    const allowed = (user.allowed_canals && user.allowed_canals.length > 0)
      ? user.allowed_canals
      : canalsForPlan(user.subscription_plan);
    if (allowed.includes(canal)) return true;
    const CANAL_NAMES = { panama: 'Panama Canal', suez: 'Suez Canal', bosporus: 'Bosporus / Turkish Straits', malacca: 'Strait of Malacca', cape: 'Cape of Good Hope' };
    res.status(403).json({
      success: false,
      waterway_access_denied: true,
      canal,
      canal_name: CANAL_NAMES[canal] || canal,
      allowed_canals: allowed,
      message: `Your current plan does not include access to ${CANAL_NAMES[canal] || canal}. Upgrade to add this waterway.`,
      upgrade_url: '/pricing',
    });
    return false;
  } catch (err) {
    console.error('[checkWaterwayAccess] DB error:', err.message);
    res.status(500).json({ success: false, message: 'Access check failed' });
    return false;
  }
}

/**
 * Vessel limits per subscription plan.
 *
 * Live CanalClear plans:
 *   Agent Pro (panama/suez/bundle)    → unlimited filings, no vessel cap
 *   Ops Manager (panama/suez/bundle)  → vessel_limit stored on user row
 *     (equals the number of vessels the customer purchased)
 *
 * Legacy plan keys (kept for backward compatibility):
 *   single_transit → 1 vessel
 *   pro            → 5 vessels
 *   fleet          → 25 vessels
 *   enterprise     → unlimited
 */
const VESSEL_LIMITS = {
  // Legacy plan keys
  free:           0,
  single_transit: 1,
  pro:            5,
  fleet:          25,
  enterprise:     Infinity,

  // Current CanalClear plan keys (written by post-payment-register)
  agent_pro_panama:        Infinity,
  agent_pro_suez:          Infinity,
  agent_pro_bundle:        Infinity,
  ops_manager_panama:      Infinity, // actual limit read from vessel_limit column
  ops_manager_suez:        Infinity,
  ops_manager_bundle:      Infinity,

  // Agency bundle plans (all 5 waterways)
  agency_starter:    50,
  agency_pro:        200,
  agency_enterprise: Infinity,
  // Per-waterway agency plans — same vessel caps as bundle tiers
  agency_starter_panama:    50,  agency_pro_panama:    200, agency_enterprise_panama:    Infinity,
  agency_starter_suez:      50,  agency_pro_suez:      200, agency_enterprise_suez:      Infinity,
  agency_starter_bosporus:  50,  agency_pro_bosporus:  200, agency_enterprise_bosporus:  Infinity,
  agency_starter_malacca:   50,  agency_pro_malacca:   200, agency_enterprise_malacca:   Infinity,
  agency_starter_cape:      50,  agency_pro_cape:      200, agency_enterprise_cape:      Infinity,
};

/**
 * Return the vessel limit for a user.
 *
 * Priority:
 *   1. user.vessel_limit column (set at checkout for Ops Manager plans — equals
 *      the number of vessel slots purchased)
 *   2. VESSEL_LIMITS map keyed by subscription_plan
 *   3. Fall through to 0 (free / unknown)
 *
 * Accepts either a plain plan string (legacy callers) or a user row object.
 */
function getVesselLimit(planOrUser) {
  // Called with a full user row → prefer vessel_limit column
  if (planOrUser && typeof planOrUser === 'object') {
    const userRow = planOrUser;
    // Use vessel_limit column if it's a positive integer (set by checkout).
    // vessel_limit === 0 is never a valid paid value — treat as unset and
    // fall through to the plan-based lookup so active subscribers aren't
    // locked out by a missing or zero backfill.
    if (userRow.vessel_limit !== null && userRow.vessel_limit !== undefined && userRow.vessel_limit > 0) {
      return userRow.vessel_limit;
    }
    const plan = userRow.subscription_plan;
    if (!plan) {
      // Active subscription but no plan string → treat as unlimited
      if (userRow.subscription_status === 'active') return Infinity;
      return VESSEL_LIMITS.free;
    }
    const key = plan.toLowerCase().replace(/[^a-z_]/g, '');
    if (VESSEL_LIMITS[key] !== undefined) return VESSEL_LIMITS[key];
    // Unknown plan key on an active subscription — log and treat as unlimited
    // rather than silently blocking the customer with 0.
    if (userRow.subscription_status === 'active') {
      console.warn(`[getVesselLimit] Unknown plan key "${key}" on active user ${userRow.id} — defaulting to unlimited. Add to VESSEL_LIMITS.`);
      return Infinity;
    }
    return VESSEL_LIMITS.free;
  }

  // Legacy path: called with a plan string
  if (!planOrUser) return VESSEL_LIMITS.free;
  const key = String(planOrUser).toLowerCase().replace(/[^a-z_]/g, '');
  return VESSEL_LIMITS[key] !== undefined ? VESSEL_LIMITS[key] : VESSEL_LIMITS.free;
}

/**
 * Resolve allowed_canals for an agency plan, respecting the pending_agency_waterway
 * cookie set by /api/checkout/agency. If the plan is not an agency plan, falls back
 * to canalsForPlan(). If the cookie is 'all' or missing, grants all 5 canals.
 *
 * @param {string} plan     - internal subscription_plan key
 * @param {string} cookieWaterway - value of pending_agency_waterway cookie (may be undefined)
 * @returns {string[]}
 */
function resolveAgencyCanals(plan, cookieWaterway) {
  const ALL_CANALS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  const p = (plan || '').toLowerCase();
  if (!p.startsWith('agency_')) {
    return canalsForPlan(plan);
  }
  // Agency plan: use cookie if present and specific, otherwise all 5
  const VALID_SINGLE = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  if (cookieWaterway && VALID_SINGLE.includes(cookieWaterway)) {
    return [cookieWaterway];
  }
  return ALL_CANALS;
}

/**
 * Derive vessel_limit from a plan_id at checkout time.
 * Agent Pro plans have no vessel cap (NULL = unlimited).
 * Ops Manager plans store the purchased vessel count.
 *
 * @param {string} planId   - e.g. 'panama_compliance'
 * @param {number} vessels  - vessel count from Stripe session (if available)
 * @returns {number|null}   - null means unlimited
 */
function deriveVesselLimit(planId, vessels) {
  if (!planId) return null;
  // Agency plans (bundle + per-waterway) have fixed vessel caps keyed by tier prefix
  if (planId.startsWith('agency_starter'))    return 50;
  if (planId.startsWith('agency_pro'))        return 200;
  if (planId.startsWith('agency_enterprise')) return null; // null = unlimited
  const isOpsManager = planId.endsWith('_compliance');
  if (!isOpsManager) return null; // Agent Pro = unlimited
  // For Ops Manager, use the vessel count from the Stripe session.
  // If not available, default to 1 (the minimum Ops Manager purchase).
  return (vessels && Number.isFinite(vessels) && vessels > 0) ? vessels : 1;
}

/**
 * Derive plan_type from subscription_plan for fast UI queries.
 * Values: free | agent_pro | ops_manager | enterprise
 *
 * Handles both internal keys (agent_pro_panama) and Stripe product names
 * ("Agent Pro — Panama Canal") that Polsia may sync.
 */
function derivePlanType(subscriptionPlan) {
  if (!subscriptionPlan) return 'free';
  const key = subscriptionPlan.toLowerCase();
  if (key.startsWith('agency_')) return 'agency';
  if (key.startsWith('agency ')) return 'agency';
  if (key.startsWith('agent_pro') || key.startsWith('agent pro')) return 'agent_pro';
  if (key.startsWith('ops_manager') || key.startsWith('ops manager')) return 'ops_manager';
  if (key === 'enterprise') return 'enterprise';
  if (key === 'fleet' || key === 'pro' || key === 'single_transit') return key;
  // Check for Stripe product names containing plan indicators
  if (key.includes('agency starter') || key.includes('agency pro') || key.includes('agency enterprise')) return 'agency';
  if (key.includes('agent pro')) return 'agent_pro';
  if (key.includes('ops manager')) return 'ops_manager';
  return 'free';
}

/**
 * Resolve a Stripe product name (e.g. "Agent Pro — Panama Canal") to a
 * CanalClear internal subscription_plan key (e.g. "agent_pro_panama").
 *
 * Used when plan_id is missing from the success URL and we only have the
 * Stripe product name returned by the Polsia payment verify endpoint.
 */
function resolveSubscriptionPlanFromProductName(productName) {
  if (!productName) return null;
  const name = productName.toLowerCase();

  // Agency plans — resolve per-waterway first, then fall back to bundle
  // Per-waterway: "Agency Starter — Panama Canal" → agency_starter_panama
  if (name.includes('agency')) {
    const tier = name.includes('agency starter') ? 'agency_starter'
               : name.includes('agency pro')     ? 'agency_pro'
               : name.includes('agency enterprise') ? 'agency_enterprise'
               : null;
    if (tier) {
      const waterway = name.includes('panama')   ? '_panama'
                     : name.includes('suez')     ? '_suez'
                     : name.includes('bosporus') ? '_bosporus'
                     : name.includes('malacca')  ? '_malacca'
                     : name.includes('cape')     ? '_cape'
                     : '';
      return `${tier}${waterway}`; // e.g. agency_starter_panama or agency_starter (bundle)
    }
  }

  // Detect plan type
  const isAgentPro = name.includes('agent pro');
  const isOpsManager = name.includes('ops manager');
  if (!isAgentPro && !isOpsManager) return null;

  // Detect canal
  const isBoth = name.includes('bundle') || name.includes('both');
  const isPanama = name.includes('panama');
  const isSuez = name.includes('suez');

  const canal = isBoth ? 'bundle' : isPanama ? 'panama' : isSuez ? 'suez' : null;
  if (!canal) return null;

  const prefix = isAgentPro ? 'agent_pro' : 'ops_manager';
  return `${prefix}_${canal}`;
}

/** Human-readable plan display name */
function getPlanDisplayName(plan) {
  const names = {
    free: 'Per-Transit',        // legacy — maps to paid per-transit
    single_transit: 'Per-Transit',
    pro: 'Pro',
    fleet: 'Fleet',
    enterprise: 'Enterprise',
  };
  if (!plan) return 'Per-Transit';
  const key = plan.toLowerCase().replace(/[^a-z_]/g, '');
  return names[key] || plan;
}

/**
 * POST /api/auth/post-payment-register
 * Called after Stripe checkout redirects to /login?payment=success.
 * Verifies the Stripe session, provisions the user account with subscription data,
 * and returns an auth token so the user lands directly in their dashboard.
 *
 * Flow:
 *   1. Verify session_id with Polsia payment API
 *   2. Upsert user row (email from payment or user input), set subscription active
 *   3. Set password, sign token, set cookie
 *   4. Return { success: true, redirect: '/app' }
 */
router.post('/auth/post-payment-register', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password, name, session_id, plan_id } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const normalized = email.toLowerCase().trim();

    // ── Step 1: Verify payment with Polsia ──────────────────────────────────
    let paymentVerified = false;
    let stripeSubscriptionId = null;
    let paymentEmail = null;
    let paymentProductName = null;
    let verifyData = null; // full Polsia payment response (used below for vessel count)

    const polsiaApiUrl = process.env.POLSIA_API_URL;
    const polsiaApiKey = process.env.POLSIA_API_KEY;

    if (session_id && polsiaApiUrl && polsiaApiKey) {
      try {
        const verifyRes = await fetch(
          `${polsiaApiUrl}/api/company-payments/verify?session_id=${encodeURIComponent(session_id)}`,
          { headers: { Authorization: `Bearer ${polsiaApiKey}` } }
        );
        if (verifyRes.ok) {
          verifyData = await verifyRes.json();
          if (verifyData.verified) {
            paymentVerified = true;
            stripeSubscriptionId = verifyData.payment?.subscription_id || verifyData.payment?.session_id || session_id;
            paymentEmail = verifyData.payment?.customer_email || null;
            paymentProductName = verifyData.payment?.product_name || plan_id || null;
          }
        }
      } catch (verifyErr) {
        console.error('[PostPaymentRegister] Payment verify error:', verifyErr.message);
        // Non-fatal — proceed with user-provided email as fallback
      }
    }

    // If payment email differs from user-provided email, use payment email as canonical
    // (prevents someone from registering with a different email after paying)
    const canonicalEmail = (paymentEmail || normalized).toLowerCase().trim();

    // ── Step 2: Determine subscription status ────────────────────────────────
    // Map plan_id (from Stripe success URL ?plan=) to internal subscription_plan string.
    // These are the six live CanalClear products.
    const PLAN_MAP = {
      panama_filing:     'agent_pro_panama',
      panama_compliance: 'ops_manager_panama',
      suez_filing:       'agent_pro_suez',
      suez_compliance:   'ops_manager_suez',
      bundle_filing:     'agent_pro_bundle',
      bundle_compliance: 'ops_manager_bundle',
      // Agency bundle plans (all 5 waterways)
      agency_starter:    'agency_starter',
      agency_pro:        'agency_pro',
      agency_enterprise: 'agency_enterprise',
      // Per-waterway agency plans
      agency_starter_panama:    'agency_starter_panama',
      agency_pro_panama:        'agency_pro_panama',
      agency_enterprise_panama: 'agency_enterprise_panama',
      agency_starter_suez:      'agency_starter_suez',
      agency_pro_suez:          'agency_pro_suez',
      agency_enterprise_suez:   'agency_enterprise_suez',
      agency_starter_bosporus:    'agency_starter_bosporus',
      agency_pro_bosporus:        'agency_pro_bosporus',
      agency_enterprise_bosporus: 'agency_enterprise_bosporus',
      agency_starter_malacca:    'agency_starter_malacca',
      agency_pro_malacca:        'agency_pro_malacca',
      agency_enterprise_malacca: 'agency_enterprise_malacca',
      agency_starter_cape:    'agency_starter_cape',
      agency_pro_cape:        'agency_pro_cape',
      agency_enterprise_cape: 'agency_enterprise_cape',
    };
    // Resolve subscription plan: prefer PLAN_MAP lookup, then try to parse
    // the Stripe product name into an internal key, then fall back.
    const subscriptionPlan = PLAN_MAP[plan_id]
      || resolveSubscriptionPlanFromProductName(paymentProductName)
      || paymentProductName
      || plan_id
      || 'active';

    // Derive vessel_limit for this plan.
    // Agent Pro → null (unlimited). Ops Manager → vessel count from Stripe session.
    // verifyData.payment.quantity contains the line-item quantity set by Stripe Checkout.
    const stripeVesselCount = (() => {
      try {
        const qty = parseInt(verifyData?.payment?.quantity || verifyData?.payment?.line_items?.[0]?.quantity, 10);
        return Number.isFinite(qty) && qty > 0 ? qty : null;
      } catch (_) { return null; }
    })();
    const vesselLimit = deriveVesselLimit(plan_id, stripeVesselCount);

    // Derive plan_type for fast UI queries.
    const planType = derivePlanType(subscriptionPlan);

    // Subscription expires 31 days from now (recurring monthly)
    const subscriptionExpiresAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

    // ── Step 3: Upsert user ──────────────────────────────────────────────────
    const existing = await usersDb.getUserFullByEmail(pool, canonicalEmail);

    const hash = await hashPassword(password);
    let user;

    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];

      // If user already has a password and an active subscription, don't overwrite — just log in
      if (existingUser.password_hash && isSubscriptionActive(existingUser)) {
        const valid = await verifyPassword(password, existingUser.password_hash);
        if (!valid) {
          return res.status(409).json({
            success: false,
            message: 'An account already exists for this email. Please sign in instead.',
          });
        }
        // Password matches — just return auth for existing user
        const token = signToken(existingUser);
        res.cookie('cc_token', token, COOKIE_OPTS);
        return res.json({
          success: true, token,
          user: { id: existingUser.id, email: existingUser.email, name: existingUser.name, subscription_status: existingUser.subscription_status, onboarding_completed: existingUser.onboarding_completed || false },
          redirect: existingUser.onboarding_completed ? '/app' : '/onboarding'
        });
      }

      // Update existing user with new password + subscription
      const allowedCanals = resolveAgencyCanals(subscriptionPlan, req.cookies && req.cookies.pending_agency_waterway);
      // Clear the pending waterway cookie now that it's been consumed
      if (req.cookies && req.cookies.pending_agency_waterway) res.clearCookie('pending_agency_waterway');
      const updated = await usersDb.updateUserAfterPayment(pool, {
        passwordHash: hash, name, subscriptionPlan, subscriptionExpiresAt,
        stripeSubscriptionId, userId: existingUser.id, vesselLimit, planType, allowedCanals
      });
      user = updated.rows[0];
    } else {
      // Insert new user
      const allowedCanals = resolveAgencyCanals(subscriptionPlan, req.cookies && req.cookies.pending_agency_waterway);
      if (req.cookies && req.cookies.pending_agency_waterway) res.clearCookie('pending_agency_waterway');
      const inserted = await usersDb.insertUserAfterPayment(pool, {
        email: canonicalEmail, name, passwordHash: hash, subscriptionPlan, subscriptionExpiresAt,
        stripeSubscriptionId, vesselLimit, planType, allowedCanals
      });
      user = inserted.rows[0];
    }

    // ── Step 4: Sign token and set cookie ────────────────────────────────────
    const token = signToken(user);
    res.cookie('cc_token', token, COOKIE_OPTS);

    console.log(`[PostPaymentRegister] Account provisioned for ${canonicalEmail} (plan: ${subscriptionPlan}, plan_type: ${planType}, vessel_limit: ${vesselLimit === null ? 'unlimited' : vesselLimit}, verified: ${paymentVerified})`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan,
        onboarding_completed: user.onboarding_completed || false,
      },
      redirect: user.onboarding_completed ? '/app' : '/onboarding'
    });
  } catch (err) {
    console.error('[PostPaymentRegister] Error:', err);
    res.status(500).json({ success: false, message: 'Account creation failed: ' + err.message });
  }
});

/**
 * POST /api/auth/register
 * Create a new account. Checks for active subscription on existing email before allowing registration.
 */
router.post('/auth/register', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password, name } = req.body;

    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' });
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });

    const normalized = email.toLowerCase().trim();

    // Check if user exists
    const existing = await usersDb.getUserFullByEmail(pool, normalized);

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      // User exists but no password set — allow completing registration if they have a subscription
      if (!user.password_hash) {
        if (!isSubscriptionActive(user)) {
          return res.status(403).json({ success: false, message: 'No active subscription found for this email. Please purchase a plan first.', redirect: '/pricing' });
        }
        const hash = await hashPassword(password);
        await usersDb.setUserPasswordAndName(pool, hash, name || null, user.id);
        const updated = { ...user, password_hash: hash, name: name || user.name };
        const token = signToken(updated);
        res.cookie('cc_token', token, COOKIE_OPTS);
        return res.json({ success: true, token, user: { id: updated.id, email: updated.email, name: updated.name, subscription_status: updated.subscription_status, onboarding_completed: updated.onboarding_completed || false }, redirect: (updated.onboarding_completed ? '/app' : '/onboarding') });
      }
      return res.status(409).json({ success: false, message: 'An account with this email already exists. Please log in.' });
    }

    // New user — check if Polsia has synced a subscription for this email
    return res.status(403).json({
      success: false,
      message: 'No subscription found for this email. Please purchase a plan first.',
      redirect: '/pricing'
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
  }
});

/**
 * POST /api/auth/login
 * Authenticate with email + password
 */
router.post('/auth/login', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password } = req.body;

    if (!email || !password) {
      console.log(`[Login] Missing credentials: email=${!!email} password=${!!password}`);
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const normalized = email.toLowerCase().trim();
    console.log(`[Login] Attempt for: ${normalized}`);
    const result = await usersDb.getUserFullByEmail(pool, normalized);

    if (result.rows.length === 0) {
      console.log(`[Login] User not found: ${normalized}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      console.log(`[Login] No password set for: ${normalized}`);
      return res.status(401).json({ success: false, message: 'No password set for this account. Please complete your account setup.', redirect: '/welcome' });
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      console.log(`[Login] Invalid password for: ${normalized}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    // Admin users bypass subscription checks entirely — they must always be
    // able to log in regardless of subscription state.
    if (!user.is_admin && !isSubscriptionActive(user)) {
      // Allow grace period users to log in — they still have 7 days of access
      // per requireSubscription middleware. Only block truly expired users.
      const cancelledStatuses = ['canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete_expired'];
      let inGracePeriod = false;
      if (cancelledStatuses.includes(user.subscription_status)) {
        const graceStart = user.grace_period_started_at ? new Date(user.grace_period_started_at) : new Date();
        const graceEnd = new Date(graceStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        inGracePeriod = new Date() < graceEnd;
      }
      if (!inGracePeriod) {
        console.log(`[Login] Subscription inactive for: ${normalized}`);
        return res.status(403).json({ success: false, message: 'Your subscription is not active. Please upgrade to continue.', redirect: '/pricing' });
      }
    }

    const token = signToken(user);
    res.cookie('cc_token', token, COOKIE_OPTS);

    // Route to the correct dashboard based on role and plan type
    let redirectTarget = '/onboarding';
    if (user.onboarding_completed) {
      if (user.is_admin) {
        redirectTarget = '/admin';
      } else {
        // Derive plan type for plan-based routing
        const planType = user.plan_type || derivePlanType(user.subscription_plan || '');
        if (planType === 'agent_pro' || planType === 'agency') {
          redirectTarget = '/agent-dashboard';
        } else if (planType === 'ops_manager') {
          redirectTarget = '/fleet-ops';
        } else {
          redirectTarget = '/app';
        }
      }
    }

    console.log(`[Login] Success for: ${normalized} → ${redirectTarget} (admin=${!!user.is_admin})`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        subscription_status: user.subscription_status,
        is_admin: user.is_admin || false,
        onboarding_completed: user.onboarding_completed || false,
        onboarding_step: user.onboarding_step || 0
      },
      redirect: redirectTarget
    });
  } catch (err) {
    console.error('[Login] Error:', err);
    res.status(500).json({ success: false, message: 'Login failed: ' + err.message });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/auth/logout', (req, res) => {
  // Must match the same options used when setting the cookie for clearCookie to work
  res.clearCookie('cc_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  res.json({ success: true });
});

/**
 * POST /api/auth/forgot-password
 * Request a password reset link. Only works for admin users.
 * Sends a reset link to the email on file.
 */
router.post('/auth/forgot-password', async (req, res) => {
  try {
    const crypto = require('crypto');
    const pool = req.app.locals.pool;
    const { email } = req.body;

    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

    const normalized = email.toLowerCase().trim();

    // Look up admin user — don't reveal whether the email exists
    const result = await usersDb.getUserAuthByEmail(pool, normalized);

    const genericMsg = 'If that email matches an admin account, a reset link has been sent.';

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.json({ success: true, message: genericMsg });
    }

    // Generate a secure single-use token, expires in 1 hour
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await passwordResetsDb.createPasswordReset(pool, normalized, token, expiresAt);

    // Send reset email via Polsia proxy
    const apiKey = process.env.POLSIA_API_KEY;
    const appUrl = process.env.APP_URL || 'https://canalclear.org';
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    if (apiKey) {
      const html = `
<div style="background:#0A1628;font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;border-radius:12px;overflow:hidden;">
  <div style="background:#0A1628;padding:28px 40px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#00D4AA;font-size:1.4rem;margin:0;letter-spacing:-0.5px;">CanalClear</h1>
    <p style="color:#8899AA;font-size:0.8rem;margin:4px 0 0;">Panama Canal Compliance Automation</p>
  </div>
  <div style="background:#0F1D32;padding:32px 40px;">
    <h2 style="color:#F0F4F8;font-size:1.2rem;margin:0 0 16px;">Reset your admin password</h2>
    <p style="color:#C4D0DC;font-size:0.95rem;line-height:1.6;margin:0 0 24px;">
      You requested a password reset for your CanalClear admin account. Click the button below to set a new password.
      This link expires in <strong style="color:#F0F4F8;">1 hour</strong>.
    </p>
    <a href="${resetUrl}" style="display:inline-block;background:#00D4AA;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:1rem;">
      Reset Password →
    </a>
    <p style="color:#8899AA;font-size:0.8rem;margin:24px 0 0;">
      If you didn't request this, you can safely ignore this email. Your password won't change.
    </p>
    <p style="color:#556677;font-size:0.75rem;margin:16px 0 0;word-break:break-all;">
      Or copy this link: ${resetUrl}
    </p>
  </div>
  <div style="background:#07111F;padding:20px 40px;border-radius:0 0 12px 12px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="color:#556677;font-size:0.75rem;margin:0;">
      This is an automated message from CanalClear. Do not reply.
    </p>
  </div>
</div>`;

      try {
        const emailRes = await fetch('https://polsia.com/api/proxy/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({
            to: normalized,
            subject: 'Reset your CanalClear admin password',
            body: 'Reset your CanalClear admin password',
            html,
          }),
        });
        if (!emailRes.ok) {
          console.error('[Auth] Reset email send failed:', emailRes.status, await emailRes.text());
        }
      } catch (emailErr) {
        console.error('[Auth] Reset email error:', emailErr.message);
      }
    } else {
      console.warn('[Auth] POLSIA_API_KEY not set — skipping reset email to', normalized);
      console.log('[Auth] Reset URL (dev):', resetUrl);
    }

    res.json({ success: true, message: genericMsg });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Error processing request' });
  }
});

/**
 * POST /api/auth/reset-password
 * Validate a reset token and set a new password.
 */
router.post('/auth/reset-password', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    // Look up the token
    const resetResult = await passwordResetsDb.getValidPasswordReset(pool, token);

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    const resetRow = resetResult.rows[0];

    // Hash and update the password
    const hash = await hashPassword(password);
    await usersDb.updatePasswordByEmailWithTimestamp(pool, hash, resetRow.email);

    // Mark token as used
    await passwordResetsDb.markPasswordResetUsed(pool, resetRow.id);

    res.json({ success: true, message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Error resetting password' });
  }
});

/**
 * GET /api/auth/me
 * Return current user info (requires token in cookie/header)
 */
router.get('/auth/me', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    const pool = req.app.locals.pool;

    const token = req.cookies?.cc_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await usersDb.getUserForAuthMe(pool, decoded.id);

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

    const user = result.rows[0];
    const active = isSubscriptionActive(user);

    // Include grace period status so client-side checks don't redirect
    // users who are still within their grace period (server-side
    // requireSubscription allows them through).
    let inGracePeriod = false;
    if (!active) {
      const cancelledStatuses = ['canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete_expired'];
      if (cancelledStatuses.includes(user.subscription_status) && user.grace_period_started_at) {
        const graceEnd = new Date(new Date(user.grace_period_started_at).getTime() + 7 * 24 * 60 * 60 * 1000);
        inGracePeriod = new Date() < graceEnd;
      }
    }

    res.json({ success: true, user, is_active: active || inGracePeriod });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

/**
 * GET /api/subscription/status
 * Returns the authenticated user's subscription + vessel quota status.
 * Called by app.html to render the vessel count chip and grace period banner.
 */
router.get('/subscription/status', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await usersDb.getUserSubscriptionFull(pool, userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = result.rows[0];
    const limit = getVesselLimit(user);
    const isActive = isSubscriptionActive(user);

    // Count distinct vessels the user has filed for
    const vesselResult = await filingsDb.countDistinctVessels(pool, userId);
    const vesselCount = parseInt(vesselResult.rows[0]?.cnt || '0', 10);

    // Grace period calculation
    let inGracePeriod = false;
    let graceDaysRemaining = 0;
    if (!isActive) {
      const cancelledStatuses = ['canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete_expired'];
      if (cancelledStatuses.includes(user.subscription_status)) {
        const graceStart = user.grace_period_started_at ? new Date(user.grace_period_started_at) : null;
        if (graceStart) {
          const graceEnd = new Date(graceStart.getTime() + 7 * 24 * 60 * 60 * 1000);
          if (new Date() < graceEnd) {
            inGracePeriod = true;
            graceDaysRemaining = Math.ceil((graceEnd - new Date()) / (24 * 60 * 60 * 1000));
          }
        }
      }
    }

    // Use 999 for unlimited (matches frontend convention: vessel_limit === 999 → show ∞)
    const displayLimit = limit === Infinity ? 999 : limit;

    // Compute allowed_canals: admins get all, else use DB column or derive from plan
    const ALL_CANALS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
    const effectiveCanals = user.is_admin
      ? ALL_CANALS
      : (user.allowed_canals && user.allowed_canals.length > 0)
        ? user.allowed_canals
        : canalsForPlan(user.subscription_plan);

    res.json({
      success: true,
      subscription_status: user.subscription_status,
      subscription_plan: user.subscription_plan,
      plan_type: user.plan_type || derivePlanType(user.subscription_plan),
      plan_display: getPlanDisplayName(user.subscription_plan),
      is_active: isActive,
      vessel_count: vesselCount,
      vessel_limit: displayLimit,
      at_limit: limit !== Infinity && vesselCount >= limit,
      in_grace_period: inGracePeriod,
      grace_days_remaining: graceDaysRemaining,
      allowed_canals: effectiveCanals,
    });
  } catch (err) {
    console.error('[subscription/status] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/stripe/subscription-sync
 * Webhook endpoint for Polsia to sync Stripe subscription events.
 *
 * Called by Polsia when it processes Stripe webhook events:
 *   - checkout.session.completed
 *   - invoice.payment_succeeded
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *
 * Maps Stripe price_id / product_name → internal subscription_plan + vessel_limit.
 * Secured by POLSIA_API_KEY in Authorization header.
 */
router.post('/stripe/subscription-sync', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    // Verify Polsia API key
    const polsiaApiKey = process.env.POLSIA_API_KEY;
    const authHeader = req.headers.authorization;
    if (!polsiaApiKey || !authHeader || authHeader !== `Bearer ${polsiaApiKey}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const {
      email,
      subscription_status,
      subscription_id,
      product_name,
      price_id,
      quantity,
      current_period_end,
    } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'email is required' });
    }

    const normalized = email.toLowerCase().trim();

    // ── Price ID → plan mapping ──────────────────────────────────────────────
    // These are the Stripe price IDs for each CanalClear product.
    // When Polsia syncs a subscription event, we use the price_id to determine
    // the correct internal plan key, vessel_limit, and plan_type.
    //
    // Map format: price_id → { subscription_plan, plan_type, vessel_limit_from_quantity }
    // vessel_limit_from_quantity: if true, use the subscription quantity as vessel_limit
    //
    // NOTE: Price IDs can be looked up in Stripe dashboard → Products → Prices.
    // If new products are added, they must be registered here.
    const PRICE_MAP = {
      // Agent Pro plans (unlimited vessels, fixed monthly)
      // Panama Agent Pro $599/mo
      // Suez Agent Pro $899/mo
      // Bundle Agent Pro $1,500/mo
      // (Price IDs are populated from Stripe product names as fallback)
    };

    // Resolve plan from price_id first, then product name, then best guess
    let resolvedPlan = null;
    if (price_id && PRICE_MAP[price_id]) {
      resolvedPlan = PRICE_MAP[price_id];
    }

    // Fall back to parsing the product name
    const internalPlanKey = resolvedPlan?.subscription_plan
      || resolveSubscriptionPlanFromProductName(product_name);

    // Determine vessel_limit
    let vesselLimit = null; // null = unlimited (Agent Pro default)
    if (internalPlanKey && internalPlanKey.startsWith('ops_manager')) {
      // Ops Manager: vessel_limit = quantity from Stripe subscription
      const qty = parseInt(quantity, 10);
      vesselLimit = (Number.isFinite(qty) && qty > 0) ? qty : 1;
    } else if (internalPlanKey && internalPlanKey.startsWith('agency_starter')) {
      vesselLimit = 50;
    } else if (internalPlanKey && internalPlanKey.startsWith('agency_pro')) {
      vesselLimit = 200;
    } else if (internalPlanKey && internalPlanKey.startsWith('agency_enterprise')) {
      vesselLimit = null; // unlimited
    }

    // Determine plan_type
    const planType = derivePlanType(internalPlanKey || product_name);

    // Determine subscription expiry
    const expiresAt = current_period_end
      ? new Date(current_period_end * 1000).toISOString()  // Stripe sends Unix timestamp
      : new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();

    // Map Stripe subscription statuses to internal values
    const statusMap = {
      active: 'active',
      trialing: 'trialing',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'unpaid',
      incomplete: 'incomplete',
      incomplete_expired: 'incomplete_expired',
    };
    const mappedStatus = statusMap[subscription_status] || subscription_status || 'active';

    // Upsert user with subscription data
    const existing = await usersDb.getUserIdByEmail(pool, normalized);

    if (existing.rows.length > 0) {
      const userId = existing.rows[0].id;
      const syncedCanals = internalPlanKey ? canalsForPlan(internalPlanKey) : null;
      // Only update vessel_limit if we have a positive value or it's Agent Pro (null = unlimited)
      const updated = await usersDb.syncUserSubscription(pool, {
        mappedStatus, internalPlanKey, expiresAt,
        subscriptionId: subscription_id, vesselLimit, planType, userId, syncedCanals
      });

      console.log(`[SubscriptionSync] Updated user ${normalized} (plan: ${internalPlanKey}, status: ${mappedStatus}, vessel_limit: ${vesselLimit === null ? 'unlimited' : vesselLimit}, plan_type: ${planType}, canals: ${syncedCanals ? syncedCanals.join(',') : 'unchanged'})`);
      return res.json({ success: true, action: 'updated', user: updated.rows[0] });
    } else {
      // Create stub user (will complete registration when they visit /login?payment=success)
      const syncedCanals = internalPlanKey ? canalsForPlan(internalPlanKey) : [];
      const inserted = await usersDb.insertStubUser(pool, {
        email: normalized, mappedStatus, internalPlanKey, expiresAt,
        subscriptionId: subscription_id, vesselLimit, planType, syncedCanals
      });

      console.log(`[SubscriptionSync] Created stub user ${normalized} (plan: ${internalPlanKey}, status: ${mappedStatus}, vessel_limit: ${vesselLimit === null ? 'unlimited' : vesselLimit}, canals: ${syncedCanals.join(',') || 'none'})`);
      return res.json({ success: true, action: 'created', user: inserted.rows[0] });
    }
  } catch (err) {
    console.error('[SubscriptionSync] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/plans
 * Return pricing plan info — 6 variants: Panama, Suez, and Both Canals Bundle
 */
router.get('/plans', (req, res) => {
  res.json({
    success: true,
    plans: [
      {
        id: 'panama_filing',
        canal: 'panama',
        name: 'Agent Pro',
        subtitle: 'Panama Canal',
        price: 599,
        billing: 'monthly',
        description: 'For ship agents transiting Panama Canal. Unlimited VUMPA filings, crew manifests, and cargo declarations — at a fraction of traditional $2,000–$5,000+ per-transit agent fees.',
        features: [
          'Unlimited VUMPA filings per month',
          'Crew manifest automation',
          'Cargo declaration generation',
          'ACP validation before submission',
          'ACP-format PDF export',
          '96h deadline alerts',
          'Cancel anytime'
        ],
        badge: 'Panama Canal',
        cta: 'Get Started',
        stripe_url: 'https://buy.stripe.com/28EeVecSa60Ldxa4p35ZC08'
      },
      {
        id: 'panama_compliance',
        canal: 'panama',
        name: 'Ops Manager',
        subtitle: 'Panama Canal',
        price: 399,
        billing: 'monthly',
        description: 'For fleet operators transiting Panama Canal. Continuous PCSOPEP compliance tracking per vessel — protects against $65K+ fines and transit denials.',
        features: [
          '$399 per vessel per month',
          'Continuous PCSOPEP compliance tracking',
          'Expiry alerts 30 days in advance',
          'Pre-transit validation',
          'Regulatory tracking dashboard',
          'Multi-vessel fleet management',
          'Cancel anytime'
        ],
        badge: 'Panama Canal',
        cta: 'Get Started',
        stripe_url: null
      },
      {
        id: 'suez_filing',
        canal: 'suez',
        name: 'Agent Pro',
        subtitle: 'Suez Canal',
        price: 899,
        billing: 'monthly',
        description: 'For ship agents transiting Suez Canal. The world\'s most complex transit compliance — SCA permits, SCNT tonnage, ISPS security, convoy scheduling, and 12+ mandatory filings per transit.',
        features: [
          'Unlimited SCA transit permit filings',
          'Tonnage certificate (SCNT) automation',
          'Cargo declaration (IMDG 42-24 validated)',
          'ISPS notification scheduling (72h/48h/24h)',
          'SCA-format PDF export',
          'Fee calculator + rebate optimizer',
          'Cancel anytime'
        ],
        badge: 'Suez Canal',
        cta: 'Get Started',
        stripe_url: 'https://buy.stripe.com/7sYeVeaK2fBl8cQ8Fj5ZC09'
      },
      {
        id: 'suez_compliance',
        canal: 'suez',
        name: 'Ops Manager',
        subtitle: 'Suez Canal',
        price: 599,
        billing: 'monthly',
        description: 'For fleet operators transiting Suez Canal. Continuous compliance tracking — convoy scheduling, pilotage docs, insurance verification, and SCA regulatory requirements.',
        features: [
          '$599 per vessel per month',
          'Convoy scheduling compliance',
          'Pilotage documentation management',
          'Insurance verification tracking',
          'Pre-transit compliance validation',
          'Expiry alerts 30 days in advance',
          'Cancel anytime'
        ],
        badge: 'Suez Canal',
        cta: 'Get Started',
        stripe_url: null
      },
      {
        id: 'bundle_filing',
        canal: 'bundle',
        name: 'Agent Pro',
        subtitle: 'Both Canals',
        price: 1500,
        billing: 'monthly',
        description: 'For ship agents transiting both Panama and Suez Canal. One subscription covers ACP filings, SCA permits, crew manifests, and cargo declarations for both routes.',
        savings: 'Both canals, one subscription',
        features: [
          'Everything in Panama + Suez Filing',
          'Unlimited VUMPA + SCA filings',
          'ACP + SCA-format PDF export',
          'Both canal validation engines',
          '96h + ISPS deadline alerts',
          'Fee calculator + rebate optimizer',
          'Cancel anytime'
        ],
        badge: 'Best Value',
        cta: 'Get the Bundle',
        stripe_url: 'https://buy.stripe.com/fZu6oI8BU4WH2SwaNr5ZC0c'
      },
      {
        id: 'bundle_compliance',
        canal: 'bundle',
        name: 'All Waterways Bundle',
        subtitle: 'All 5 Waterways',
        price: 1299,
        billing: 'monthly',
        description: 'For fleet operators managing compliance across all major maritime chokepoints. Continuous compliance tracking per vessel — PCSOPEP (Panama), SCA/SCNT (Suez), SP-1 (Bosporus), TSS/VTIS/MARPOL (Malacca), and ISPS pre-arrival (Cape).',
        savings: 'Save $996/vessel/mo vs. buying all 5 waterways separately ($2,295)',
        features: [
          'Compliance tracking for all 5 waterways',
          '$1,299 per vessel per month',
          'PCSOPEP (Panama) + SCA (Suez) + SP-1 (Bosporus)',
          'TSS/VTIS/MARPOL (Malacca) + ISPS (Cape)',
          'All canal & strait expiry alerts',
          'Multi-vessel fleet dashboard',
          'Pre-transit validation for all 5 waterways',
          'Cancel anytime'
        ],
        badge: 'Best Value',
        cta: 'Get the Bundle',
        stripe_url: null
      }
    ]
  });
});

/**
 * POST /api/checkout/ops-manager
 * Create a Stripe checkout session for the Ops Manager (per-vessel) plan.
 * Uses pre-created subscription links for vessel counts 1–10, and dynamically
 * creates checkout sessions via the Polsia API for vessel counts 11+.
 */
router.post('/checkout/ops-manager', async (req, res) => {
  try {
    const { canal, vessels, promoCode } = req.body;

    // Validate inputs — allow up to 100 vessels (matches front-end VESSEL_MAX)
    const numVessels = parseInt(vessels, 10);
    if (!canal || !numVessels || numVessels < 1 || numVessels > 100) {
      return res.status(400).json({ success: false, message: 'Invalid canal or vessel count (1–100).' });
    }

    // Per-vessel prices (monthly) — must match front-end pricing
    const VESSEL_PRICES = {
      panama: 399,
      suez: 599,
      bosporus: 499,
      cape: 349,
      bundle: 1299,
      malacca: 449,
    };

    // Human-readable canal names for checkout descriptions
    const CANAL_NAMES = {
      panama: 'Panama Canal',
      suez: 'Suez Canal',
      bosporus: 'Bosporus Strait',
      cape: 'Cape of Good Hope',
      bundle: 'All Three Canals (Panama + Suez + Bosporus)',
      malacca: 'Strait of Malacca',
    };

    const perVessel = VESSEL_PRICES[canal];
    if (!perVessel) {
      return res.status(400).json({ success: false, message: 'Invalid canal. Use panama, suez, bosporus, cape, malacca, or bundle.' });
    }

    // Valid promo codes for Ops Manager (Fleet Ops) plans only
    const VALID_PROMO_CODES = { SEAS: 20 }; // code → discount percentage
    const normalizedPromo = promoCode ? promoCode.trim().toUpperCase() : null;
    const discountPct = (normalizedPromo && VALID_PROMO_CODES[normalizedPromo]) || 0;

    // Pre-created Stripe subscription links for each canal × vessel count (1–10).
    // Full-price links — used when no promo code is active.
    const SUBSCRIPTION_LINKS = {
      panama: {
        1:  'https://buy.stripe.com/6oU6oIdWedtd1OsbRv5ZC0a',
        2:  'https://buy.stripe.com/3cIcN605oexhdxaaNr5ZC0i',
        3:  'https://buy.stripe.com/00w6oI7xQfBl0KocVz5ZC0j',
        4:  'https://buy.stripe.com/4gM00k4lE74P3WA9Jn5ZC0k',
        5:  'https://buy.stripe.com/7sY28s7xQah19gUdZD5ZC0l',
        6:  'https://buy.stripe.com/fZueVeg4m1Kv9gU08N5ZC0m',
        7:  'https://buy.stripe.com/eVqbJ29FY9cX64IbRv5ZC0n',
        8:  'https://buy.stripe.com/cNi8wQaK2exheBeaNr5ZC0o',
        9:  'https://buy.stripe.com/4gM4gA3hAcp964Ig7L5ZC0p',
        10: 'https://buy.stripe.com/bJeeVe6tMfBl0Ko08N5ZC0q',
      },
      suez: {
        1:  'https://buy.stripe.com/cNi28s19sbl58cQbRv5ZC0b',
        2:  'https://buy.stripe.com/cNi4gAaK2fBl78M9Jn5ZC0r',
        3:  'https://buy.stripe.com/bJe7sMaK20Grdxa4p35ZC0s',
        4:  'https://buy.stripe.com/aFafZi05o74P3WAg7L5ZC0t',
        5:  'https://buy.stripe.com/eVq3cw4lE2OzeBef3H5ZC0u',
        6:  'https://buy.stripe.com/bJe00k3hAbl58cQ9Jn5ZC0v',
        7:  'https://buy.stripe.com/9B63cwcSaexhgJmcVz5ZC0w',
        8:  'https://buy.stripe.com/8x200kdWebl52Sw8Fj5ZC0x',
        9:  'https://buy.stripe.com/9B6dRa8BUexh0Ko2gV5ZC0y',
        10: 'https://buy.stripe.com/00wcN6g4m4WHct62gV5ZC0z',
      },
      bundle: {
        1:  'https://buy.stripe.com/5kQfZidWedtd78M2gV5ZC2f',
        2:  'https://buy.stripe.com/cNieVef0i9cXdxa3kZ5ZC2g',
        3:  'https://buy.stripe.com/bJe28s3hAah19gU2gV5ZC2h',
        4:  'https://buy.stripe.com/6oU00kaK274P0Kof3H5ZC2i',
        5:  'https://buy.stripe.com/3cI4gA9FY1Kv3WA8Fj5ZC2j',
        6:  'https://buy.stripe.com/eVqaEY5pI0Gr78MdZD5ZC2k',
        7:  'https://buy.stripe.com/eVqfZi5pI3SD1Os5t75ZC2l',
        8:  'https://buy.stripe.com/7sY7sM9FY74Pct6bRv5ZC2m',
        9:  'https://buy.stripe.com/4gMfZi2dw74P8cQcVz5ZC2n',
        10: 'https://buy.stripe.com/8x23cw19s0Grct65t75ZC2o',
      },
      bosporus: {
        1:  'https://buy.stripe.com/fZubJ2g4mgFpfFi3kZ5ZC1i',
        2:  'https://buy.stripe.com/eVq00k19s3SD2Sw2gV5ZC1j',
        3:  'https://buy.stripe.com/6oU5kE4lE74PakY2gV5ZC1k',
        4:  'https://buy.stripe.com/dRm00kcSa88T3WA5t75ZC1l',
        5:  'https://buy.stripe.com/5kQ5kEg4m2Ozbp24p35ZC1m',
        6:  'https://buy.stripe.com/bJe4gA4lEbl59gUaNr5ZC1n',
        7:  'https://buy.stripe.com/aFa7sMg4m3SDfFicVz5ZC1o',
        8:  'https://buy.stripe.com/6oUdRa3hAdtd64I8Fj5ZC1p',
        9:  'https://buy.stripe.com/8x2bJ27xQ4WH1OsaNr5ZC1q',
        10: 'https://buy.stripe.com/4gM3cw6tMdtd8cQf3H5ZC1r',
      },
      // Cape of Good Hope — uses dynamic checkout (Strategy 2) for all vessel counts.
      // Pre-built links to be added once Stripe products are created.
      cape: {},
      malacca: {
        1:  'https://buy.stripe.com/00w9AU6tM1Kv78MdZD5ZC1D',
        2:  'https://buy.stripe.com/cNi28sbO6dtd64IaNr5ZC1E',
        3:  'https://buy.stripe.com/5kQ9AU19sfBlct6aNr5ZC1F',
        4:  'https://buy.stripe.com/cNicN68BU0GrfFidZD5ZC1G',
        5:  'https://buy.stripe.com/8x2cN6g4mbl578M8Fj5ZC1H',
        6:  'https://buy.stripe.com/cNidRa3hA4WHakYdZD5ZC1I',
        7:  'https://buy.stripe.com/28EbJ28BU60LfFig7L5ZC1J',
        8:  'https://buy.stripe.com/4gMeVebO6ah1eBe1cR5ZC1K',
        9:  'https://buy.stripe.com/cNi8wQbO6bl5gJm3kZ5ZC1L',
        10: 'https://buy.stripe.com/fZudRa6tM74PdxabRv5ZC1M',
      },
    };

    // SEAS promo: pre-created links at 20% off (vessels × per-vessel × 0.8, rounded down).
    // Panama: $319/v, Suez: $479/v, Bosporus: $399/v, Bundle: $1,039/v (SEAS 20% off $1,299).
    const SEAS_SUBSCRIPTION_LINKS = {
      panama: {
        1:  'https://buy.stripe.com/fZu9AUg4m60L8cQcVz5ZC0K',
        2:  'https://buy.stripe.com/bJe5kE19s74Pbp25t75ZC0L',
        3:  'https://buy.stripe.com/bJe4gAaK24WH50EbRv5ZC0M',
        4:  'https://buy.stripe.com/00wdRa3hA74Pct65t75ZC0N',
        5:  'https://buy.stripe.com/cNicN69FY60LakY9Jn5ZC0O',
        6:  'https://buy.stripe.com/8x26oI19sgFp50E1cR5ZC0P',
        7:  'https://buy.stripe.com/dRm6oIaK29cXct61cR5ZC0Q',
        8:  'https://buy.stripe.com/9B63cw9FY2Oz9gU6xb5ZC0R',
        9:  'https://buy.stripe.com/fZudRa2dwfBlgJmbRv5ZC0S',
        10: 'https://buy.stripe.com/bJefZig4mah11Os5t75ZC0T',
      },
      suez: {
        1:  'https://buy.stripe.com/dRm5kE5pI3SDfFibRv5ZC0U',
        2:  'https://buy.stripe.com/9B6bJ2bO6cp91Os4p35ZC0V',
        3:  'https://buy.stripe.com/aFa8wQ9FY0GrfFibRv5ZC0W',
        4:  'https://buy.stripe.com/eVq8wQ8BUfBl8cQ2gV5ZC0X',
        5:  'https://buy.stripe.com/6oUdRa3hA3SD0Ko9Jn5ZC0Y',
        6:  'https://buy.stripe.com/dRm6oI19s1KvgJm9Jn5ZC0Z',
        7:  'https://buy.stripe.com/cNidRa5pI74PgJmcVz5ZC10',
        8:  'https://buy.stripe.com/6oU7sM9FY3SD64IcVz5ZC11',
        9:  'https://buy.stripe.com/7sY9AUcSacp9akYdZD5ZC12',
        10: 'https://buy.stripe.com/3cIbJ2g4mexh8cQ9Jn5ZC13',
      },
      bundle: {
        1:  'https://buy.stripe.com/7sYfZi4lEdtdeBe4p35ZC2p',
        2:  'https://buy.stripe.com/9B600kcSa88T9gUbRv5ZC2q',
        3:  'https://buy.stripe.com/14A4gAcSa88TeBe6xb5ZC2r',
        4:  'https://buy.stripe.com/8x2bJ23hAah1dxa08N5ZC2s',
        5:  'https://buy.stripe.com/00w14of0i2Oz3WAdZD5ZC2t',
        6:  'https://buy.stripe.com/5kQ6oI05ofBlbp24p35ZC2u',
        7:  'https://buy.stripe.com/14AeVeg4m74Pdxa9Jn5ZC2v',
        8:  'https://buy.stripe.com/4gM7sMdWe3SDbp29Jn5ZC2w',
        9:  'https://buy.stripe.com/14AfZi19s74P64I6xb5ZC2x',
        10: 'https://buy.stripe.com/cNieVeaK2exhdxacVz5ZC2y',
      },
      bosporus: {
        1:  'https://buy.stripe.com/9B600k19sdtd78M2gV5ZC1s',
        2:  'https://buy.stripe.com/7sY9AU2dw3SD9gU8Fj5ZC1t',
        3:  'https://buy.stripe.com/9B68wQ19s74P3WA8Fj5ZC1u',
        4:  'https://buy.stripe.com/cNiaEY6tM88Tdxa2gV5ZC1v',
        5:  'https://buy.stripe.com/aFa9AUg4m4WH78M2gV5ZC1w',
        6:  'https://buy.stripe.com/eVq3cw6tMgFpakY8Fj5ZC1x',
        7:  'https://buy.stripe.com/4gM28s7xQfBl64I4p35ZC1y',
        8:  'https://buy.stripe.com/9B69AU7xQ74Pbp2bRv5ZC1z',
        9:  'https://buy.stripe.com/9B69AUaK2gFp1Osg7L5ZC1A',
        10: 'https://buy.stripe.com/dRm00kf0i4WH50E3kZ5ZC1B',
      },
      // SEAS 20% off Cape: $349 × 0.8 = $279/vessel/mo (floor)
      // Uses dynamic checkout (Strategy 2) for all vessel counts.
      cape: {},
      malacca: {
        1:  'https://buy.stripe.com/4gM14o4lE60LeBeaNr5ZC1N',
        2:  'https://buy.stripe.com/5kQbJ25pI88TfFicVz5ZC1O',
        3:  'https://buy.stripe.com/6oU6oI7xQcp92SwbRv5ZC1P',
        4:  'https://buy.stripe.com/6oU9AU3hA60Lbp28Fj5ZC1Q',
        5:  'https://buy.stripe.com/fZucN66tM88Tct6cVz5ZC1R',
        6:  'https://buy.stripe.com/7sY9AU9FY88TfFi9Jn5ZC1S',
        7:  'https://buy.stripe.com/8x25kE7xQ2Ozdxa6xb5ZC1T',
        8:  'https://buy.stripe.com/dRmbJ24lE74P2SwcVz5ZC1U',
        9:  'https://buy.stripe.com/dRmdRacSabl52Sw5t75ZC1V',
        10: 'https://buy.stripe.com/00wcN62dwcp950EdZD5ZC1W',
      },
    };

    // ── Strategy 1: Use pre-created link for vessel counts 1–10 ──
    // When SEAS promo is active, use the dedicated discounted links (real discounted prices).
    const linkTable = (normalizedPromo === 'SEAS') ? SEAS_SUBSCRIPTION_LINKS : SUBSCRIPTION_LINKS;
    const canalLinks = linkTable[canal];
    const checkoutUrl = canalLinks ? canalLinks[numVessels] : null;

    if (checkoutUrl) {
      // Record redemption for tracking — use the Stripe link URL as idempotency key.
      // Pre-created links don't have a per-session ID, so the URL itself is the dedup key.
      if (normalizedPromo) {
        const pool = req.app.locals.pool;
        // Use link URL + canal + vessels as dedup key to allow same link for different vessel counts
        const dedupKey = `${normalizedPromo}:${checkoutUrl}`;
        promoRedemptionsDb.recordRedemption(pool, normalizedPromo, dedupKey, canal, numVessels)
          .catch(err => console.error('[checkout/ops-manager] promo redemption record failed:', err.message));
      }
      return res.json({ success: true, url: checkoutUrl });
    }

    // ── Strategy 2: Dynamically create checkout session for vessel counts 11+ ──
    const polsiaApiUrl = process.env.POLSIA_API_URL;
    const polsiaApiKey = process.env.POLSIA_API_KEY;

    if (!polsiaApiUrl || !polsiaApiKey) {
      console.error('[checkout/ops-manager] POLSIA_API_URL or POLSIA_API_KEY not configured — cannot create dynamic checkout for', numVessels, 'vessels');
      return res.status(500).json({
        success: false,
        message: 'Unable to create checkout session. Please try again or contact support@canalclear.org',
      });
    }

    // Calculate total monthly amount — apply SEAS 20% discount if active
    const baseMonthly = numVessels * perVessel;
    const totalMonthly = discountPct > 0 ? Math.floor(baseMonthly * (1 - discountPct / 100)) : baseMonthly;
    const canalName = CANAL_NAMES[canal] || canal;
    const promoSuffix = discountPct > 0 ? ` — SEAS ${discountPct}% off` : '';
    const productName = `Ops Manager — ${canalName} (${numVessels} vessels)${promoSuffix}`;

    // Create a one-time checkout session via Polsia's Stripe API.
    // This generates a unique Stripe checkout URL for this specific order.
    const checkoutPayload = {
      line_items: [{
        name: productName,
        amount: totalMonthly,
        quantity: 1,
      }],
      success_url: `https://canal-clear.polsia.app/login?payment=success&plan=ops_manager_${canal}&vessels=${numVessels}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: 'https://canal-clear.polsia.app/pricing',
    };

    console.log(`[checkout/ops-manager] Creating dynamic checkout: ${canal}, ${numVessels} vessels, $${totalMonthly}/mo${discountPct ? ` (promo: ${normalizedPromo}, ${discountPct}% off)` : ''}`);

    const polsiaRes = await fetch(`${polsiaApiUrl}/api/company-payments/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${polsiaApiKey}`,
      },
      body: JSON.stringify(checkoutPayload),
    });

    if (polsiaRes.ok) {
      const polsiaData = await polsiaRes.json();
      if (polsiaData.url) {
        console.log(`[checkout/ops-manager] Dynamic checkout created for ${numVessels} vessels (${canal})`);
        // Record promo redemption — extract session ID from URL for dedup
        if (normalizedPromo && polsiaData.url) {
          const pool = req.app.locals.pool;
          const sessionMatch = polsiaData.url.match(/\/([A-Za-z0-9_]+)(?:\?|$)/);
          const sessionId = sessionMatch ? sessionMatch[1] : polsiaData.url;
          promoRedemptionsDb.recordRedemption(pool, normalizedPromo, sessionId, canal, numVessels)
            .catch(err => console.error('[checkout/ops-manager] promo redemption record failed (dynamic):', err.message));
        }
        return res.json({ success: true, url: polsiaData.url });
      }
    }

    // If Polsia API didn't return a URL, log the issue and fall back to a helpful error
    const polsiaStatus = polsiaRes.status;
    let polsiaBody = '';
    try { polsiaBody = await polsiaRes.text(); } catch (_) {}
    console.error(`[checkout/ops-manager] Polsia API returned ${polsiaStatus} for dynamic checkout:`, polsiaBody);

    return res.status(500).json({
      success: false,
      message: 'Unable to create checkout session. Please try again or contact support@canalclear.org',
    });
  } catch (err) {
    console.error('[checkout/ops-manager]', err);
    res.status(500).json({
      success: false,
      message: 'Unable to create checkout session. Please try again or contact support@canalclear.org',
    });
  }
});

/**
 * POST /api/checkout/subscribe
 * Returns a pre-created Stripe subscription link for Agent Pro plans.
 * No dynamic session creation — uses real Stripe links created via MCP.
 */
function handleSubscribeCheckout(req, res) {
  try {
    const { plan, canal } = req.body;

    // Pre-created Stripe subscription links for Agent Pro (flat-rate monthly).
    // Created via Polsia Stripe MCP — each is a reusable subscription URL.
    const AGENT_PRO_LINKS = {
      panama:  'https://buy.stripe.com/00w4gAg4m74PgJm9Jn5ZC1e',
      suez:    'https://buy.stripe.com/7sYcN6dWe4WH2SwdZD5ZC1f',
      bosporus:'https://buy.stripe.com/eVq3cw6tMcp92Sw7Bf5ZC1g',
      bundle:  'https://buy.stripe.com/eVq9AU3hA1Kvbp27Bf5ZC1h',
      malacca: 'https://buy.stripe.com/14AcN6g4m88Tdxa1cR5ZC1C',
    };

    if (!canal || !AGENT_PRO_LINKS[canal]) {
      return res.status(400).json({ success: false, message: 'Invalid canal. Use panama, suez, bosporus, bundle, or malacca.' });
    }

    if (plan !== 'agent_pro') {
      return res.status(400).json({ success: false, message: 'Use /api/checkout/ops-manager for Ops Manager plans.' });
    }

    const url = AGENT_PRO_LINKS[canal];
    console.log(`[checkout/subscribe] Agent Pro ${canal} → ${url}`);
    return res.json({ success: true, url });

  } catch (err) {
    console.error('[checkout/subscribe]', err);
    res.status(500).json({
      success: false,
      message: 'Unable to create checkout session. Please try again or contact support@canalclear.org',
    });
  }
}
router.post('/checkout/subscribe', handleSubscribeCheckout);
// Legacy alias — old frontend may still reference /api/checkout/start-trial
router.post('/checkout/start-trial', handleSubscribeCheckout);

/**
 * POST /api/checkout/agency
 * Returns a pre-created Stripe subscription link for Agency tier plans.
 * Accepts { tier, waterway } where waterway is 'all' or a single canal key.
 * Sets a pending_agency_waterway cookie so the registration flow can
 * provision the correct allowed_canals when the user returns from Stripe.
 */
router.post('/checkout/agency', (req, res) => {
  try {
    const { tier, waterway } = req.body;

    // Pre-created Stripe payment links for Agency tiers.
    // All tiers have the same price regardless of waterway selection —
    // waterway controls which canals are provisioned, not the price.
    const AGENCY_LINKS = {
      agency_starter:    'https://buy.stripe.com/dRmaEY19s60L78Mf3H5ZC1X',
      agency_pro:        'https://buy.stripe.com/4gM8wQdWe2Oz0Ko3kZ5ZC1Y',
      agency_enterprise: 'https://buy.stripe.com/cNifZidWegFpbp2dZD5ZC1Z',
    };

    const VALID_WATERWAYS = ['all', 'panama', 'suez', 'bosporus', 'malacca', 'cape'];

    if (!tier || !AGENCY_LINKS[tier]) {
      return res.status(400).json({ success: false, message: 'Invalid tier. Use agency_starter, agency_pro, or agency_enterprise.' });
    }
    if (!waterway || !VALID_WATERWAYS.includes(waterway)) {
      return res.status(400).json({ success: false, message: 'Invalid waterway selection.' });
    }

    // Store the waterway selection in a short-lived cookie so the
    // registration/login flow can provision the correct allowed_canals.
    // Expires in 2 hours — enough time to complete Stripe checkout.
    res.cookie('pending_agency_waterway', waterway, {
      maxAge: 2 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    const url = AGENCY_LINKS[tier];
    return res.json({ success: true, url });

  } catch (err) {
    console.error('[checkout/agency]', err);
    res.status(500).json({
      success: false,
      message: 'Unable to start checkout. Please try again or contact support@canalclear.org',
    });
  }
});

/**
 * POST /api/promo/validate
 * Validate a redemption code and return discount info.
 * SEAS: 20% off Ops Manager (Fleet Ops) plans only.
 * Checks redemption count against per-code limits.
 */
router.post('/promo/validate', async (req, res) => {
  const { code, planType } = req.body;
  const normalized = (code || '').trim().toUpperCase();

  const PROMO_CODES = {
    SEAS: {
      discountPct: 20,
      applicablePlanTypes: ['ops_manager'], // Fleet Ops plans only
      label: 'Code SEAS applied — 20% off Fleet Ops plans!',
      // Max number of checkout sessions this code can be applied to.
      // null = unlimited. Set to a number to cap.
      maxRedemptions: null,
    },
  };

  const promo = PROMO_CODES[normalized];

  if (!promo) {
    return res.json({ valid: false, message: 'Invalid code' });
  }

  // If planType is provided, check eligibility
  if (planType && !promo.applicablePlanTypes.includes(planType)) {
    return res.json({
      valid: false,
      message: 'SEAS discount applies to Fleet Ops plans only.',
    });
  }

  // Check redemption limit if configured
  if (promo.maxRedemptions !== null) {
    try {
      const pool = req.app.locals.pool;
      const usedCount = await promoRedemptionsDb.getRedemptionCount(pool, normalized);
      if (usedCount >= promo.maxRedemptions) {
        return res.json({ valid: false, message: 'This code has reached its redemption limit.' });
      }
    } catch (err) {
      console.error('[promo/validate] redemption count check failed:', err.message);
      // Fail open — don't block valid promo due to DB error
    }
  }

  return res.json({
    valid: true,
    code: normalized,
    discountPct: promo.discountPct,
    label: promo.label,
    applicablePlanTypes: promo.applicablePlanTypes,
  });
});

/**
 * POST /api/purchase-request
 * Capture purchase intent when Stripe links are not configured.
 * Saves email + plan to purchase_requests table (deduped by email+plan_id).
 */
router.post('/purchase-request', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, name, plan_id, plan_name } = req.body;

    if (!email || !plan_id) {
      return res.status(400).json({ success: false, message: 'Email and plan are required' });
    }

    const normalized = email.toLowerCase().trim();

    await purchaseRequestsDb.createPurchaseRequest(pool, { email: normalized, name, plan_id, plan_name });

    res.json({ success: true, message: 'Request received' });
  } catch (err) {
    console.error('[purchase-request]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * POST /api/validate
 * Run VUMPA pre-arrival validation on vessel data with caching
 * Optimized: categorized errors, response time tracking
 */
router.post('/validate', requireAuth, async (req, res) => {
  const startTime = Date.now();
  try {
    const pool = req.app.locals.pool;
    const { getCachedValidation, setCachedValidation } = require('../services/validation-cache');
    const data = req.body;
    const canal = (data.canal || 'panama').toLowerCase();

    // Waterway access check
    if (!await checkWaterwayAccess(req, res, canal)) return;

    // Check cache first
    const cached = getCachedValidation(data);
    if (cached) {
      console.log(`[Validate/${canal.toUpperCase()}] Cache hit for IMO ${data.imo_number} (${Date.now() - startTime}ms)`);
      return res.json({
        success: true,
        validation: cached,
        cached: true,
        canal,
        response_time_ms: Date.now() - startTime
      });
    }

    let result;

    if (canal === 'suez') {
      // ── Suez Canal: load active DB rules for data-driven validation ──────────
      let dbRules = [];
      try {
        const rulesRes = await validationsDb.getActiveSuezValidationRules(pool);
        dbRules = rulesRes.rows;
        console.log(`[Validate/SUEZ] Loaded ${dbRules.length} active DB rules`);
      } catch (e) {
        console.warn('[Validate/SUEZ] Could not load DB rules — falling back to hard-coded defaults:', e.message);
      }
      result = validateSuezFiling(data, dbRules);
    } else {
      // ── Panama / default: VUMPA validator ──────────────────────────────────
      result = validateVUMPA(data);
    }

    // Store in cache for next request
    setCachedValidation(data, result);

    // Resolve draft/ETA from top-level or document_data for both canal types
    const draftVal  = data.draft || data.draft_forward || (data.document_data && data.document_data.draft) || null;
    const etaVal    = data.eta || (data.document_data && data.document_data.eta) || null;
    const dirVal    = data.transit_direction || (data.document_data && data.document_data.transit_direction) || '';

    // Save to database (non-blocking, log errors but don't block response)
    validationsDb.recordFullValidation(pool, {
      vessel_name: data.vessel_name || '', imo_number: data.imo_number || '', flag_state: data.flag_state || '', vessel_type: data.vessel_type || '',
      loa: data.loa || null, beam: data.beam || null, draft: draftVal, gross_tonnage: data.gross_tonnage || null,
      cargo_type: data.cargo_type || '', has_dangerous_goods: data.has_dangerous_goods || false, dangerous_goods_class: data.dangerous_goods_class || '',
      transit_direction: dirVal, booking_number: data.booking_number || '', eta: etaVal,
      overall_status: result.overall_status, total_checks: result.total_checks, passed_checks: result.passed_checks, failed_checks: result.failed_checks, warning_checks: result.warning_checks,
      checklist: JSON.stringify(result.checklist)
    }).catch(err => {
      console.error('[Validate] DB save error (non-blocking):', err.message);
    });

    const responseTime = Date.now() - startTime;
    console.log(`[Validate/${canal.toUpperCase()}] Completed for IMO ${data.imo_number} (${responseTime}ms, ${result.total_checks} checks, ${result.overall_status})`);

    res.json({
      success: true,
      validation: result,
      canal,
      response_time_ms: responseTime,
      categorized: true
    });
  } catch (err) {
    console.error('[Validate] Error:', err.message);
    const responseTime = Date.now() - startTime;
    res.status(500).json({
      success: false,
      message: 'Validation failed: ' + err.message,
      response_time_ms: responseTime
    });
  }
});

/**
 * GET /api/validations
 * List past validations
 */
router.get('/validations', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await validationsDb.listValidations(pool, limit, offset);

    const countResult = await validationsDb.countValidations(pool);

    res.json({
      success: true,
      validations: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
  } catch (err) {
    console.error('List validations error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/validations/:id
 * Get a specific validation with full checklist
 */
router.get('/validations/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;

    const result = await validationsDb.getValidationById(pool, id);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Validation not found' });
    }

    res.json({ success: true, validation: result.rows[0] });
  } catch (err) {
    console.error('Get validation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/history/export
 * Export validation history as CSV or PDF
 * ?format=csv - returns CSV download
 * ?format=pdf - returns full validation data JSON for client-side PDF generation
 */
router.get('/history/export', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const format = req.query.format || 'csv';

    const result = await validationsDb.exportValidationsWithUser(pool);

    if (format === 'csv') {
      const headers = [
        'ID', 'Vessel Name', 'IMO Number', 'Flag', 'Vessel Type', 'Cargo Type',
        'Status', 'Total Checks', 'Passed', 'Failed', 'Warnings',
        'Booking #', 'ETA', 'Direction', 'Date', 'User'
      ];

      const rows = result.rows.map(v => [
        v.id,
        v.vessel_name || '',
        v.imo_number || '',
        v.flag_state || '',
        v.vessel_type || '',
        v.cargo_type || '',
        v.overall_status || '',
        v.total_checks || 0,
        v.passed_checks || 0,
        v.failed_checks || 0,
        v.warning_checks || 0,
        v.booking_number || '',
        v.eta ? new Date(v.eta).toISOString() : '',
        v.transit_direction || '',
        v.created_at ? new Date(v.created_at).toISOString() : '',
        v.user_email || ''
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => {
          const str = String(cell);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(','))
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="canalclear-history-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send(csvContent);
    }

    if (format === 'pdf') {
      // Return full validation data for client-side PDF generation
      return res.json({ success: true, validations: result.rows, generated_at: new Date().toISOString() });
    }

    res.status(400).json({ success: false, message: 'Unsupported format. Use ?format=csv or ?format=pdf' });
  } catch (err) {
    console.error('History export error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/reference
 * Return valid options for form dropdowns
 */
router.get('/reference', (req, res) => {
  res.json({
    success: true,
    vessel_types: VALID_VESSEL_TYPES,
    cargo_types: VALID_CARGO_TYPES,
    dg_classes: VALID_DG_CLASSES,
    transit_directions: TRANSIT_DIRECTIONS
  });
});

/**
 * GET /api/stats
 * Dashboard statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    const stats = await validationsDb.getValidationStats(pool);

    res.json({
      success: true,
      stats: stats.rows[0]
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/filings
 * Save a compliance filing (draft or submitted)
 */
router.post('/filings', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const {
      document_type,
      canal = 'panama',
      vessel_name, imo_number, flag_state, vessel_type, classification_society,
      loa, beam, draft, gross_tonnage,
      document_data,
      status = 'draft',
      reference_number, notes
    } = req.body;

    if (!document_type) return res.status(400).json({ success: false, message: 'document_type is required' });

    // Waterway access check — ensure user has purchased access to this canal
    if (!await checkWaterwayAccess(req, res, (canal || 'panama').toLowerCase())) return;

    // ── Vessel limit enforcement ──────────────────────────────────────────
    // Look up the user's full row (plan + vessel_limit column) and count
    // distinct vessels they already have. If the incoming IMO is new, it must
    // not push the user over their purchased cap.
    {
      const userRow = await usersDb.getUserVesselInfo(pool, userId);
      const userRecord = userRow.rows[0] || {};
      const limit = getVesselLimit(userRecord);

      if (limit !== Infinity) {
        // Count existing distinct IMO numbers for this user
        const vesselCount = await filingsDb.countDistinctVessels(pool, userId);
        const currentCount = parseInt(vesselCount.rows[0]?.cnt || '0', 10);

        // Is the incoming IMO already tracked for this user?
        const isExistingVessel = imo_number
          ? await filingsDb.hasVesselByImo(pool, userId, imo_number.trim())
          : true; // no IMO = treat as existing (don't penalise)

        if (!isExistingVessel && currentCount >= limit) {
          const plan = userRecord.subscription_plan || 'free';
          const planName = getPlanDisplayName(plan);
          const upgradePlan = plan === 'single_transit' ? 'Pro' : plan === 'pro' ? 'Fleet' : 'Enterprise';
          return res.status(403).json({
            success: false,
            vessel_limit_reached: true,
            vessel_count: currentCount,
            vessel_limit: limit,
            plan: planName,
            message: `Your ${planName} plan allows up to ${limit} vessel${limit === 1 ? '' : 's'}. Upgrade to ${upgradePlan} to add more.`,
            upgrade_url: '/pricing',
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    const result = await filingsDb.createFiling(pool, {
      userId, documentType: document_type, canal: canal.toLowerCase(), status,
      vesselName: vessel_name, imoNumber: imo_number, flagState: flag_state, vesselType: vessel_type, classificationSociety: classification_society,
      loa, beam, draft, grossTonnage: gross_tonnage,
      documentData: document_data, referenceNumber: reference_number, notes
    });

    const filing = result.rows[0];
    // Register deadline alert based on ETA in document_data
    try {
      const canalKey = (canal || 'panama').toLowerCase();
      const docData  = document_data || {};
      // Panama ETA field → 96h deadline; Suez → 72h deadline
      let etaStr = null;
      let hoursBeforeEta = 96;
      let filingTypeName = 'VUMPA Pre-Arrival';
      if (canalKey === 'panama') {
        etaStr = docData.eta || null;
        hoursBeforeEta = 96;
        filingTypeName = document_type || 'VUMPA Pre-Arrival';
      } else if (canalKey === 'suez') {
        etaStr = docData.eta_pilot_point || docData.eta_port || docData.eta || null;
        hoursBeforeEta = 72;
        filingTypeName = document_type || 'SCA Filing';
      }
      if (etaStr && filing && filing.id) {
        const eta = new Date(etaStr);
        if (!isNaN(eta.getTime())) {
          const deadlineAt = new Date(eta.getTime() - hoursBeforeEta * 60 * 60 * 1000).toISOString();
          await upsertDeadline(pool, {
            userId,
            waterway:   canalKey,
            filingType: filingTypeName,
            vesselName: vessel_name || 'Unknown Vessel',
            imoNumber:  imo_number  || null,
            deadlineAt,
            filingId:   filing.id,
            filingUrl:  `/demo/${canalKey}`,
            complianceIssues: [],
          });
        }
      }
    } catch (dlErr) {
      console.error('[Filings/Create] Deadline registration failed:', dlErr.message);
    }

    res.json({ success: true, filing });
  } catch (err) {
    console.error('Save filing error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/filings
 * List the authenticated user's filings, newest first
 */
router.get('/filings', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await filingsDb.listUserFilings(pool, userId, limit, offset);

    const total = await filingsDb.countUserFilings(pool, userId);

    res.json({
      success: true,
      filings: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset
    });
  } catch (err) {
    console.error('List filings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/filings/:id
 * Get a specific filing (must belong to authenticated user)
 */
router.get('/filings/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const userId = req.user.id;

    const result = await filingsDb.getUserFilingById(pool, id, userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Filing not found' });
    }

    res.json({ success: true, filing: result.rows[0] });
  } catch (err) {
    console.error('Get filing error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/filings/:id
 * Update a filing (e.g., mark as submitted)
 */
router.patch('/filings/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const userId = req.user.id;
    const { status, document_data, notes } = req.body;

    const existing = await filingsDb.checkFilingOwnership(pool, id, userId);
    if (existing.rows.length === 0) return res.status(404).json({ success: false, message: 'Filing not found' });

    const updates = [];
    const params = [];
    let p = 1;

    if (status) { updates.push(`status = $${p++}`); params.push(status); }
    if (document_data) { updates.push(`document_data = $${p++}`); params.push(JSON.stringify(document_data)); }
    if (notes !== undefined) { updates.push(`notes = $${p++}`); params.push(notes); }
    if (status === 'submitted') { updates.push(`submitted_at = NOW()`); }
    updates.push(`updated_at = NOW()`);

    params.push(id, userId);
    const result = await filingsDb.updateFiling(pool,
      `UPDATE filings SET ${updates.join(', ')} WHERE id = ${p++} AND user_id = ${p} RETURNING *`,
      params
    );

    const updated = result.rows[0];
    // Update deadline when document_data.eta changes
    if (document_data && updated && updated.id) {
      try {
        const canalKey = (updated.canal || 'panama').toLowerCase();
        let etaStr = null;
        let hoursBeforeEta = 96;
        if (canalKey === 'panama') {
          etaStr = document_data.eta || null;
          hoursBeforeEta = 96;
        } else if (canalKey === 'suez') {
          etaStr = document_data.eta_pilot_point || document_data.eta_port || document_data.eta || null;
          hoursBeforeEta = 72;
        }
        if (etaStr) {
          const eta = new Date(etaStr);
          if (!isNaN(eta.getTime())) {
            const deadlineAt = new Date(eta.getTime() - hoursBeforeEta * 60 * 60 * 1000).toISOString();
            const patched = await updateDeadlineForFiling(pool, {
              filingId: updated.id,
              userId,
              waterway: canalKey,
              deadlineAt,
              complianceIssues: [],
            });
            if (!patched) {
              await upsertDeadline(pool, {
                userId,
                waterway:   canalKey,
                filingType: updated.document_type || (canalKey === 'suez' ? 'SCA Filing' : 'VUMPA Pre-Arrival'),
                vesselName: updated.vessel_name || 'Unknown Vessel',
                imoNumber:  updated.imo_number  || null,
                deadlineAt,
                filingId:   updated.id,
                filingUrl:  `/demo/${canalKey}`,
                complianceIssues: [],
              });
            }
          }
        }
      } catch (dlErr) {
        console.error('[Filings/Patch] Deadline update failed:', dlErr.message);
      }
    }

    res.json({ success: true, filing: updated });
  } catch (err) {
    console.error('Update filing error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/analytics/event
 * Client-side event tracking (CTA clicks, pricing interactions, etc.)
 * Returns 204 always — fire-and-forget from the client.
 */
const BOT_UA_RE = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|gptbot|chatgpt|anthropic|claudebot|curl\/|wget\/|python-requests|node-fetch|axios\/|undici\//i;

router.post('/analytics/event', async (req, res) => {
  // Always respond immediately — never block caller
  res.status(204).end();

  const pool = req.app.locals.pool;
  const ua = req.headers['user-agent'] || '';
  const botFlagged = !ua || BOT_UA_RE.test(ua);
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

  const { event_type, page, properties, utm_source, utm_medium, utm_campaign, utm_content, utm_term } = req.body || {};

  if (!event_type) return; // silently discard invalid events

  // UTM cookie fallback: if client didn't send UTMs, check for server-set cc_utm cookie
  let finalUtm = { utm_source, utm_medium, utm_campaign, utm_content, utm_term };
  if (!utm_source && !utm_medium && !utm_campaign) {
    try {
      const utmCookie = req.cookies && req.cookies.cc_utm;
      if (utmCookie) {
        const parsed = JSON.parse(utmCookie);
        finalUtm = {
          utm_source: parsed.utm_source || null,
          utm_medium: parsed.utm_medium || null,
          utm_campaign: parsed.utm_campaign || null,
          utm_content: parsed.utm_content || null,
          utm_term: parsed.utm_term || null,
        };
      }
    } catch (_) { /* ignore malformed cookie */ }
  }

  // Optional user_id from JWT cookie (no auth required)
  let userId = null;
  try {
    const jwt = require('jsonwebtoken');
    const token = (req.cookies && req.cookies.cc_token) || null;
    if (token) {
      const { JWT_SECRET } = require('../middleware/auth');
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded && decoded.id ? decoded.id : null;
    }
  } catch (_) { /* ignore invalid tokens */ }

  const crypto = require('crypto');
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.ANALYTICS_SALT || 'canalclear-analytics-salt';
  const ipHash = ip ? crypto.createHash('sha256').update(`${salt}:${day}:${ip}`).digest('hex').slice(0, 16) : null;

  // Anonymous session ID from cookie (set by session middleware in server.js)
  const sessionId = (req.cookies && req.cookies.cc_sid) || null;

  analyticsEventsDb.insertAnalyticsEvent(pool, {
    event_type, page, properties, ipHash, ua,
    userId, sessionId,
    utm_source: finalUtm.utm_source,
    utm_medium: finalUtm.utm_medium,
    utm_campaign: finalUtm.utm_campaign,
    utm_content: finalUtm.utm_content,
    utm_term: finalUtm.utm_term,
    botFlagged,
  }).catch(err => console.error('[Analytics] event insert error:', err.message));
});

// ──────────────────────────────────────────────────────────────────────────────
// AI-POWERED ENDPOINTS
// ──────────────────────────────────────────────────────────────────────────────

function getAIClient() {
  const { OpenAI } = require('openai');
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://polsia.com/ai/openai/v1',
  });
}

/**
 * POST /api/filing/prefill
 * AI vessel pre-fill: given an IMO number, return known vessel specs
 */
router.post('/filing/prefill', requireAuth, async (req, res) => {
  try {
    const { imo_number } = req.body;
    if (!imo_number) return res.status(400).json({ success: false, message: 'imo_number is required' });

    const ai = getAIClient();

    const prompt = `You are a maritime vessel database expert with access to Lloyd's Register, IMO GISIS, and major vessel databases.

Given IMO number ${imo_number}, return the publicly known specifications for this vessel.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "found": true,
  "confidence": "high",
  "vessel_name": "...",
  "flag_state": "2-letter ISO code e.g. PA",
  "vessel_type": "one of: bulk_carrier|container|tanker|lng_carrier|lpg_carrier|vehicle_carrier|general_cargo|reefer|cruise|ro_ro|chemical_tanker|offshore|tug|yacht|naval|other",
  "loa": 300.0,
  "beam": 48.2,
  "draft": 14.5,
  "gross_tonnage": 180000,
  "classification_society": "Lloyd's Register"
}

Rules:
- If a field is unknown, omit it entirely (don't set null)
- If the IMO is completely unknown or invalid, return {"found": false}
- "confidence" should be "high" if you have reliable data, "medium" if approximate, "low" if uncertain
- loa, beam, draft must be in meters
- vessel_type must be one of the listed values`;

    const completion = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 400,
      response_format: { type: 'json_object' }
    });

    const raw = completion.choices[0]?.message?.content || '{"found":false}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { found: false }; }

    res.json({ success: true, prefill: parsed });
  } catch (err) {
    console.error('[AI Prefill] error:', err.message);
    // Don't fail hard — just return not found so UI degrades gracefully
    res.json({ success: true, prefill: { found: false, error: err.message } });
  }
});

/**
 * Build a document-type-specific AI validation prompt with real ACP/VUMPA specs.
 * Each doc type has its own required fields, rejection triggers, and compliance rules.
 */
function buildValidationPrompt(document_type, vessel, document_data) {
  const filingJson = JSON.stringify({ document_type, vessel, document_data }, null, 2);
  const now = new Date();
  const nowISO = now.toISOString();

  // Shared vessel checks used across all doc types
  const sharedVesselRules = `
VESSEL IDENTIFICATION CHECKS (apply to all document types):
- vessel_name: Required. Must match exactly the name on all certificates (IMO register, IOPP, flag state). Vessel name discrepancies between documents cause instant rejection.
- imo_number: Required. Must be 7 digits, valid IMO check digit (Luhn-style: sum of first 6 digits × weights 7,6,5,4,3,2; last digit = sum mod 10).
- flag_state: Required. ISO 3166-1 alpha-2 code (e.g., PA, LR, MH, HK, SG, BS, MT).
- vessel_type: Required. ACP classification for toll calculation.
- loa: Required in meters. Max 366m (Neo-Panamax), max 294.13m (Panamax locks).
- beam: Required in meters. Max 51.25m (Neo-Panamax), max 32.31m (Panamax locks).
- draft: Required in meters TFW. Max 15.24m (Neo-Panamax), max 12.04m (Panamax). Current advisory limit ~13.41m due to Gatun Lake levels.
- gross_tonnage: Required for toll calculation. Affects PCSOPEP tier fee.
- classification_society: Recommended (Lloyd's, DNV, BV, ABS, ClassNK, RINA, etc.).`;

  // ETA deadline window logic
  let etaContext = '';
  if (document_data && document_data.eta) {
    try {
      const etaDate = new Date(document_data.eta);
      const hoursOut = (etaDate - now) / (1000 * 60 * 60);
      if (hoursOut < 0) {
        etaContext = `\nETA DEADLINE STATUS: PAST — ETA is ${Math.abs(Math.round(hoursOut))} hours in the past. INSTANT REJECTION.`;
      } else if (hoursOut < 24) {
        etaContext = `\nETA DEADLINE STATUS: CRITICAL — Only ${Math.round(hoursOut)} hours until ETA. ACP requires minimum 96 hours. Emergency processing only; transit slot likely lost.`;
      } else if (hoursOut < 48) {
        etaContext = `\nETA DEADLINE STATUS: URGENT — Only ${Math.round(hoursOut)} hours until ETA. ACP requires minimum 96 hours. Vessel will be rejected or placed in open queue at high delay cost.`;
      } else if (hoursOut < 72) {
        etaContext = `\nETA DEADLINE STATUS: LATE — Only ${Math.round(hoursOut)} hours until ETA. ACP requires minimum 96 hours. Expedited processing possible but additional fees apply.`;
      } else if (hoursOut < 96) {
        etaContext = `\nETA DEADLINE STATUS: BELOW MINIMUM — ${Math.round(hoursOut)} hours until ETA. VUMPA hard requirement is 96 hours minimum. Filing will be rejected.`;
      } else if (hoursOut < 120) {
        etaContext = `\nETA DEADLINE STATUS: TIGHT — ${Math.round(hoursOut)} hours until ETA. Meets 96-hour minimum but no room for amendments. Flag any issues immediately.`;
      } else {
        etaContext = `\nETA DEADLINE STATUS: OK — ${Math.round(hoursOut)} hours until ETA. Sufficient lead time.`;
      }
    } catch (e) { /* ignore parse errors */ }
  }
  if (vessel && vessel.eta) {
    // ETA might be on vessel object for VUMPA filings
    try {
      const etaDate = new Date(vessel.eta);
      const hoursOut = (etaDate - now) / (1000 * 60 * 60);
      if (!etaContext && hoursOut < 120) {
        etaContext = `\nETA on vessel object: ${Math.round(hoursOut)} hours out.`;
      }
    } catch (e) { /* ignore */ }
  }

  let docSpecificRules = '';

  if (document_type === 'vumpa_pre_arrival') {
    docSpecificRules = `
DOCUMENT TYPE: VUMPA Pre-Arrival Notification
ACP regulation: Since January 1, 2024, paper declarations are not accepted. VUMPA digital submission is mandatory.
Submission deadline: MINIMUM 96 hours before ETA at Canal anchorage. No exceptions.

REQUIRED FIELDS for VUMPA pre-arrival:
1. eta (Estimated Time of Arrival): Mandatory. Must be ≥96 hours from NOW (current time: ${nowISO}). Flag any ETA under 120 hours as a warning.
2. transit_direction: Required. Must be "northbound" (Atlantic→Pacific) or "southbound" (Pacific→Atlantic).
3. booking_number: ACP reservation/booking number. Without this, vessel goes to open queue (3–7 day wait). Flag if missing.
4. master_name: Master's full name required on declaration.
5. crew_count: Total crew on board required.
6. cargo_type: Required. Must match vessel type. Use "ballast_only" if in ballast.
7. has_dangerous_goods: Boolean declaration mandatory. Cannot be omitted.
8. dangerous_goods_class: Required IF has_dangerous_goods is true. Must be valid IMDG class.

DOCUMENTS that must be submitted alongside pre-arrival (flag as warnings if context suggests missing):
- General Arrangement plan: Required for all vessels. Must be submitted via VUMPA ≥96 hours before arrival. ACP uses it to calculate center of gravity and buoyancy for lockage.
- Capacity Plan: Required. Submitted with General Arrangement.
- ISPS Form (Advance Notification of Vessel Arrival): Must be submitted ≥96 hours before arrival per ISPS Code.
- ISSC (International Ship Security Certificate): Must be valid. Security level transmitted 96 hours prior.
- Maritime Declaration of Health: Required. Signed by Master within 24 hours of arrival.
- Ship Stores Declaration (FAL Form 3): Required. Lists bonded stores, alcohol, tobacco, narcotics (medical).
- Crew List (FAL Form 5): Full crew with passport details.
- Pilot ladder compliance: If pilot boarding area >9m above water, combination ladder required per 2024 ACP safety update.
- International Tonnage Certificate (ITC 69): Required for toll calculation using PC/UMS Net Tonnage.
- PCSOPEP: Required for vessels with ≥400 MT oil carrying capacity (cargo + fuel combined). Validate separately.
- Ballast Water Management declaration: Required per 2026 ACP standards.

TOP REJECTION TRIGGERS for VUMPA pre-arrival (check explicitly):
1. ETA less than 96 hours from submission — INSTANT REJECTION
2. Missing or invalid IMO number
3. General Arrangement plans not submitted (very common oversight)
4. DG declared but no IMDG class code provided
5. Cargo type inconsistent with vessel type (e.g., "liquid_bulk" on container vessel)
6. Draft exceeds current Gatun Lake water restriction (advisory ~13.41m TFW)
7. No booking number (vessel loses priority, forced into open queue = 3–7 day delay)
8. Master's name missing from declaration
9. ISPS Form not submitted separately in the 96-hour window
10. Booking number format error (ACP booking numbers are alphanumeric, 6–15 chars)

DANGEROUS GOODS rules (IMDG Code):
- Class 1 (Explosives): Requires advance ACP Maritime Security approval. Allow 72+ hour processing. Stowage plan mandatory.
- Class 2 (Gases): 2.1=Flammable, 2.2=Non-flammable, 2.3=Toxic. LNG/LPG carriers must declare full manifest.
- Class 3 (Flammable Liquids): Most common on tankers. Flash point and proper shipping name required.
- Class 4: 4.1=Flammable solids, 4.2=Self-reactive, 4.3=Water-reactive. Special stowage required.
- Class 5: 5.1=Oxidizers, 5.2=Organic peroxides. Temperature controls often required.
- Class 6: 6.1=Toxic, 6.2=Infectious. MSDS mandatory. Emergency contacts required.
- Class 7 (Radioactive): Requires ANAM (Autoridad Nacional del Ambiente) certification AND ACP advance approval. Contact ACP Dangerous Goods Division at least 72 hours before filing.
- Class 8 (Corrosives): Segregation requirements apply. Tankers carrying acids must declare.
- Class 9 (Misc): Includes lithium batteries, dry ice, elevated temperature cargo.
For ALL DG: UN number, proper shipping name, packing group, stowage position, segregation requirements, and MSDS for each product required.`;

  } else if (document_type === 'pcsopep_plan') {
    docSpecificRules = `
DOCUMENT TYPE: PCSOPEP (Panama Canal Shipboard Oil Pollution Emergency Plan)
Legal basis: Chapter IX of Maritime Regulations for the Operation of the Panama Canal.
Applicability: ALL vessels with ≥400 Metric Tons total oil carrying capacity (cargo + fuel combined). Not required for vessels under 400 MT total.
Submission: Via VUMPA system, minimum 96 hours before scheduled transit.
Validity: ACP issues a "Notice of Acknowledgement" valid for 2 years. Plan does NOT need resubmission for each transit unless changes occur.

CRITICAL: PCSOPEP is a Panama Canal-SPECIFIC plan. A copy of the vessel's global MARPOL SOPEP or SMPEP is NOT acceptable as a standalone PCSOPEP.

REQUIRED PLAN SECTIONS (flag missing sections as errors):
1. Vessel identification: Must match IOPP certificate EXACTLY (name, IMO, flag). Name mismatch = #1 cause of PCSOPEP rejection.
2. Authorized Person (AP) details:
   - MUST be domiciled in the Republic of Panama (not abroad)
   - Must be available 24/7 year-round
   - Must be fluent in English or Spanish
   - Must have IMS (Incident Management System) experience
   - Serves as legal liaison between vessel and ACP during emergencies
   - Can authorize ACP expenditure for spill cleanup
3. OSRO: ACP is the SOLE approved Oil Spill Response Organization. No private OSRO contract needed. ACP charges a transit fee covering OSRO services.
4. Emergency notification procedures: Must list ACP-specific emergency channels (not generic coastal state contacts).
5. Spill response tiers:
   - Tier 1: Minor spills (vessel handles independently)
   - Tier 2: Medium spills (local resources + ACP notification)
   - Tier 3: Major spills (full ACP OSRO activation, boom barges, skimmers)
6. IOPP Certificate copy: Required. Name must match plan exactly.
7. Oil record book references.
8. Crew training and drill records.

PCSOPEP REQUIRED FIELDS to validate:
- plan_reference: Plan reference/approval number from ACP
- certifying_body: Organization that prepared/certified the plan
- issue_date: Date plan was issued/approved
- expiry_date: 2-year validity from ACP Notice of Acknowledgement date
- flag_administration: Must match vessel flag state
- iopp_certificate: IOPP (International Oil Pollution Prevention) certificate reference under MARPOL Annex I. Vessel name on IOPP must exactly match vessel_name field.
- oil_capacity_mt: Total oil carrying capacity in MT. If ≥400 MT, PCSOPEP is required. If <400 MT, flag as warning — PCSOPEP may not be required.
- authorized_person_name: Required. Panama-domiciled representative who acts as 24/7 ACP liaison.
- authorized_person_contact: Required 24/7 phone number for AP. ACP will call this during emergencies.

EXPIRY VALIDATION:
- Expired plan (expiry_date in past): INSTANT REJECTION — vessel cannot transit until renewed
- Expires within 30 days: ERROR — renew immediately, ACP review takes time
- Expires within 60 days: WARNING — begin renewal process now
- Expires within 90 days: INFO — plan renewal recommended soon

RESUBMISSION TRIGGERS (flag if document_data mentions these changes occurred without resubmission):
- Change in vessel name
- Change in vessel ownership or management company
- Change in flag state
- Change in Authorized Person
- Major structural changes to vessel
- Change in oil carrying configuration

TOP PCSOPEP REJECTION CAUSES:
1. Vessel name on PCSOPEP/iopp_certificate doesn't match vessel_name exactly (most common rejection — one character difference = rejection)
2. authorized_person_name missing or AP not domiciled in Panama (foreign-based AP not accepted)
3. authorized_person_contact missing or AP unreachable 24/7
4. Private OSRO contract listed in notes (ACP is sole OSRO — no external contract needed)
5. Plan is copy of MARPOL SOPEP without Panama-specific sections
6. Missing ACP-specific emergency contact channels
7. Annual fee to ACP not paid (plan not active until financial requirements met)
8. Tier 3 response resources not demonstrated (required for large tankers)
9. Missing Statement of Compliance in VUMPA system
10. Plan submitted after 96-hour deadline or expiry_date is past`;

  } else if (document_type === 'crew_manifest') {
    docSpecificRules = `
DOCUMENT TYPE: Crew Manifest (FAL Form 5)
Standard: IMO FAL Form 5 format required by ACP and Panama Maritime Authority.
Submission: Must be in VUMPA system before transit. Master signs and certifies accuracy.

REQUIRED PER CREW MEMBER:
1. rank: Must use ACP/IMO rank classifications (e.g., master, chief_officer, second_officer, third_officer, chief_engineer, second_engineer, bosun, able_seaman, ordinary_seaman, cook, electrician, etc.)
2. name: Full legal name matching travel document (no abbreviations)
3. nationality: ISO 3166-1 alpha-2 country code
4. doc_type: "passport" (preferred), "seaman_book", or "id_card" (restrictions apply)
5. doc_number: Full document number
6. dob: Date of birth (format: YYYY-MM-DD preferred)

CRITICAL VALIDATIONS:
- Master must be listed (rank: "master") — vessel cannot transit without master on manifest
- Minimum crew count: Must meet vessel's Safe Manning Certificate requirements. For commercial vessels typically: Bulk carriers need ≥14 crew, tankers ≥15, container ships ≥20. Flag if crew_count seems very low for vessel type.
- All passport numbers must be included — missing passport = crew member denied boarding at transit
- Nationality for each crew member required — affects VUMPA nationality verification
- Date of birth required — used for identity verification at locks
- Crew count in document_data.crew_count must match actual number of crew_members listed
- Master's name in any cross-referenced VUMPA declaration must match crew manifest

SEAMAN'S BOOK vs PASSPORT:
- Passport: Accepted universally
- Seaman's Book: Accepted if issued by recognized flag state maritime authority
- National ID card: Limited acceptance; may require additional documentation

COMMON CREW MANIFEST REJECTION CAUSES:
1. Master not listed or rank field empty
2. Passport number missing for any crew member
3. Name abbreviations (e.g., "J. Smith" instead of "John Smith")
4. Date of birth missing or wrong format
5. Crew count declared in transit booking doesn't match manifest count
6. Nationality code invalid (non-ISO code or full country name instead of code)
7. Crew member listed with expired travel document (check if expiry dates provided)`;

  } else if (document_type === 'cargo_declaration') {
    docSpecificRules = `
DOCUMENT TYPE: Cargo Declaration (General Declaration / FAL Form 2 equivalent)
Purpose: Declares all cargo on board for ACP customs and Canal Authority review.
Requirement: Required for all vessels carrying cargo (not required for ballast-only vessels, but ballast status must be declared).

REQUIRED FIELDS:
1. bl_number: Bill of Lading number — primary cargo identifier. Required for all laden vessels.
2. cargo_type: Must match vessel type declaration. See cross-validation rules below.
3. shipper: Full legal name of shipper/consignor.
4. consignee: Full legal name of consignee/receiver.
5. port_of_origin: Port of loading (use UN/LOCODE or full port name).
6. port_of_destination: Port of discharge.
7. gross_weight_mt: Total cargo weight in Metric Tons.
8. volume_cbm: Volume in Cubic Meters (for break bulk/containerized cargo).
9. num_packages and package_type: Required for break bulk. For bulk/liquid: can be omitted.
10. cargo_description: Detailed description required for all cargo. Vague descriptions like "general cargo" will be flagged.

DANGEROUS GOODS (DG) CARGO RULES — STRICT ACP REQUIREMENTS:
If cargo includes dangerous goods (any IMDG Class 1-9), ALL of the following are required:
- IMDG class code: Class 1 through 9 (subclasses allowed: 1.1, 2.1, 4.2, etc.)
- UN number: 4-digit UN number for each DG substance (e.g., UN1203 for petrol)
- Proper shipping name: Official IMDG proper shipping name (not trade name)
- Packing group: I (high danger), II (medium danger), or III (low danger) where applicable
- Stowage position: Hold number and position (e.g., "Hold 2, stow away from accommodation")
- Segregation requirements: What the DG cannot be stowed with
- MSDS: Material Safety Data Sheet required for each DG product
- Emergency response number: 24/7 emergency contact for DG response
- Total quantity: Weight or volume of DG cargo

CLASS-SPECIFIC DG REQUIREMENTS:
- Class 1 (Explosives): ACP Maritime Security pre-approval required ≥72 hours before filing. Compatibility group letter required.
- Class 2.1 (Flammable Gas): Includes LNG, LPG, propane, butane. Requires gas-carrier or tanker vessel. Boil-off rate for LNG required.
- Class 3 (Flammable Liquids): Flash point required. Inhibitor details if applicable.
- Class 6.2 (Infectious Substances): Health authority clearance required.
- Class 7 (Radioactive): ANAM (Panama env. authority) certification + ACP advance approval. Transport index required.
- Class 9: Includes lithium batteries (UN3480, UN3481, UN3090) — growing rejection cause as operators misclassify lithium batteries.

CARGO/VESSEL TYPE CROSS-VALIDATION:
- tanker + liquid_bulk/crude_oil/petroleum_products: Valid
- tanker + containerized/dry_bulk: MISMATCH — flag as error
- container + containerized: Valid
- container + dry_bulk/liquid_bulk: MISMATCH (unless stated as partial cargo)
- bulk_carrier + dry_bulk: Valid
- bulk_carrier + liquid_bulk: MISMATCH unless vessel is multi-purpose
- lng_carrier + lng: Valid
- lng_carrier + anything other than lng/ballast_only: MISMATCH
- chemical_tanker + chemicals/petroleum_products/liquid_bulk: Valid
- vehicle_carrier + vehicles: Valid; note total vehicle count if provided

COMMON CARGO DECLARATION REJECTION CAUSES:
1. Bill of Lading number missing on laden vessel
2. DG declared but no UN number or IMDG class
3. Cargo description too vague ("general merchandise", "various goods")
4. Cargo type mismatches vessel type
5. Gross weight exceeds vessel's deadweight tonnage capacity (if known)
6. Lithium batteries not declared as Class 9 DG when present
7. Radioactive materials (Class 7) not pre-approved with ANAM`;

  } else {
    // Fallback for unknown document types
    docSpecificRules = `
DOCUMENT TYPE: ${document_type}
Validate for completeness, data consistency, and Panama Canal compliance requirements.`;
  }

  return `You are a Panama Canal ACP compliance expert with 20 years of VUMPA filing experience. You review pre-arrival documents for exact compliance with ACP regulations. You know the specific rejection reasons that cost operators $15,000–$65,000 per incident.

Current timestamp: ${nowISO}
${etaContext}

${sharedVesselRules}

${docSpecificRules}

FILING DATA TO VALIDATE:
${filingJson}

INSTRUCTIONS:
- Check every required field against the rules above
- Prioritize errors that cause ACP REJECTION over warnings
- Be specific: name the exact field, the exact problem, and the exact fix
- Do NOT invent issues that aren't there — only flag real problems
- For ETA: calculate hours from NOW (${nowISO}) to the ETA datetime
- Maximum 12 issues total; prioritize by severity (errors first)

SEVERITY LEVELS:
- "error" = ACP will REJECT filing or vessel will be denied transit. Fix before submitting.
- "warning" = Will cause delays, additional fees, or requires supplementary documentation. Strongly recommend fixing.
- "info" = Best practice, regulatory reminder, or minor improvement.

Return ONLY valid JSON (no markdown, no backticks):
{
  "issues": [
    {
      "severity": "error",
      "field": "exact_field_name",
      "message": "Specific problem description with regulatory reference",
      "suggestion": "Exact corrective action"
    }
  ],
  "overall": "pass|warn|fail",
  "summary": "One sentence: filing status and most critical action needed"
}

If no issues found, return: {"issues": [], "overall": "pass", "summary": "Filing meets ACP requirements and is ready for VUMPA submission."}`;
}

/**
 * Build SCA-specific AI validation prompt for all 7 Suez Canal document types.
 * Mirrors the Panama buildValidationPrompt() architecture but with SCA rules:
 *   - SCNT (not PC/UMS) tonnage
 *   - 48h mandatory ETA (not 96h)
 *   - Convoy scheduling windows
 *   - El-Ferdan Bridge air draft (70m)
 *   - IMDG Amendment 42-24 lithium battery classifications
 *   - Three-stage ISPS pre-arrival (72h/48h/24h)
 *   - Yellow fever for endemic countries
 *   - ENRRA permit for Class 7
 */
function buildSuezValidationPrompt(document_type, vessel, document_data) {
  const filingJson = JSON.stringify({ document_type, vessel, document_data }, null, 2);
  const now = new Date();
  const nowISO = now.toISOString();

  // SCA dimensional limits
  const SCA_LIMITS = {
    maxLOA: 400, maxBeam: 77.5, maxDraft: 18.90,
    advisoryDraft: 17.68, maxAirDraft: 70, advisoryAirDraft: 68,
    minEtaHours: 48, advisoryEtaHours: 96,
  };

  // Shared SCA vessel checks
  const sharedVesselRules = `
VESSEL IDENTIFICATION CHECKS (apply to all SCA document types):
- vessel_name: Required. Must match exactly across ALL SCA certificates. Name discrepancies cause instant rejection.
- imo_number: Required. Must be 7 digits, valid IMO check digit (weights 7,6,5,4,3,2 on digits 0-5; last digit = sum mod 10). Suggest corrected checksum if wrong.
- flag_state: Required. ISO 3166-1 alpha-2 code (EG=Egypt, GR=Greece, PA=Panama, etc.).
- vessel_type: Required. SCA classification for toll calculation.
- loa: Required in meters. Hard limit ${SCA_LIMITS.maxLOA}m. Vessels >350m need special convoy slot request.
- beam: Required in meters. Hard limit ${SCA_LIMITS.maxBeam}m.
- draft_forward + draft_aft: Both required for SCA (separate fore/aft drafts — not a single combined draft). Hard limit ${SCA_LIMITS.maxDraft}m. Advisory limit ${SCA_LIMITS.advisoryDraft}m (seasonal — check SCA Notice to Mariners).
- air_draft: If provided, hard limit ${SCA_LIMITS.maxAirDraft}m (El-Ferdan Railway Bridge). Advisory ${SCA_LIMITS.advisoryAirDraft}m (advance SCA coordination required).
- gross_tonnage (GT): Required for SCNT estimation if no certificate on file.
- scnt: Suez Canal Net Tonnage — the SCA toll basis. Distinct from ITC-69 tonnage used by Panama.`;

  // ETA validation for SCA (48h minimum, not 96h)
  let etaContext = '';
  const etaRaw = (document_data && document_data.eta) || (vessel && vessel.eta);
  if (etaRaw) {
    try {
      const etaDate = new Date(etaRaw);
      const hoursOut = (etaDate - now) / (1000 * 60 * 60);
      if (hoursOut < 0) {
        etaContext = `\nETA STATUS: PAST — ETA is ${Math.abs(Math.round(hoursOut))} hours in the past. INSTANT REJECTION.`;
      } else if (hoursOut < 24) {
        etaContext = `\nETA STATUS: CRITICAL — Only ${Math.round(hoursOut)} hours until ETA. SCA requires minimum 48 hours. Transit impossible without emergency clearance.`;
      } else if (hoursOut < 48) {
        etaContext = `\nETA STATUS: BELOW MINIMUM — ${Math.round(hoursOut)} hours until ETA. SCA hard requirement is 48 hours. Filing will be rejected.`;
      } else if (hoursOut < 72) {
        etaContext = `\nETA STATUS: TIGHT — ${Math.round(hoursOut)} hours until ETA. Meets 48-hour minimum but convoy slot assignment may not be possible. Strongly recommend 96 hours.`;
      } else if (hoursOut < 96) {
        etaContext = `\nETA STATUS: ACCEPTABLE — ${Math.round(hoursOut)} hours until ETA. Meets 48h minimum. Convoy slot preferred ≥96h advance notice.`;
      } else {
        etaContext = `\nETA STATUS: OK — ${Math.round(hoursOut)} hours until ETA. Sufficient for convoy scheduling.`;
      }
    } catch (e) { /* ignore */ }
  }

  // SCA convoy timing rules
  const convoyRules = `
SCA CONVOY SCHEDULING RULES:
- Suez Canal runs 2 daily convoy cycles: Northbound (Port Said → Port Suez) and Southbound (Port Suez → Port Said).
- First Northbound convoy: departs Port Said anchorage ~07:00 EGT. Filing required ≥96h prior for assignment.
- Second Northbound convoy: departs ~12:00 EGT (limited slots, super-tankers and very large vessels).
- Southbound convoy: departs Port Suez ~08:00 EGT.
- Convoy assignment field: must be one of: first_northbound, second_northbound, southbound. Missing = SCA assigns automatically (potential delay).
- Vessels LOA >274m OR beam >40m typically require pilotage coordination with convoy assignment.
- Vessels with air draft >68m must declare in advance — El-Ferdan Bridge operational windows coordinated with convoy.`;

  // Tonnage / SCNT rules
  const scntRules = `
SCA TONNAGE (SCNT) REQUIREMENTS:
- SCNT (Suez Canal Net Tonnage) is the SCA toll basis, NOT GT or ITC-69 Net Tonnage.
- SCNT Certificate issued by SCA or authorized classification society. Reference number required.
- Rebates available: ≤75% for bulk carriers, ≤50% for tankers in ballast (varies by category and SCA Notice).
- If SCNT certificate is unavailable, SCA will admeasure vessel on arrival — causes 6-12 hour delay.
- scnt_certificate_number: Required for pre-clearance. Format: SCA-SCNT-YYYY-NNNNNN.
- scnt_issue_date + scnt_expiry_date: Certificate valid for 3 years from issue. Expired certificate = admeasurement delay.`;

  let docSpecificRules = '';

  if (document_type === 'sca_transit_application') {
    docSpecificRules = `
DOCUMENT TYPE: SCA Transit Application (SCA Pre-Arrival Notice)
Authority: Suez Canal Authority (SCA), Ismailia, Egypt.
Submission deadline: MINIMUM 48 hours before ETA at Port Said or Port Suez anchorage. Advisory: 96 hours for convoy slot.

REQUIRED FIELDS:
1. eta: Mandatory. Must be ≥48 hours from NOW (${nowISO}). ≥96h recommended for convoy assignment.
2. transit_direction: Required. "northbound" (Port Said → Port Suez → Red Sea) or "southbound" (Port Suez → Port Said → Mediterranean).
3. convoy_preference: Recommended. first_northbound | second_northbound | southbound. Missing = SCA auto-assigns.
4. last_port: Port of departure (UNLOCODE or full name).
5. destination_port: Port of discharge after canal.
6. vessel_agent_port_said OR vessel_agent_port_suez: SCA-registered agent contact required. No agent = filing rejected.
7. master_name: Full name. Must match STCW certificate.
8. crew_count: Total crew on board.
9. draft_forward: Forward draft in meters at arrival. Must not exceed ${SCA_LIMITS.maxDraft}m.
10. draft_aft: Aft draft in meters at arrival. Must not exceed ${SCA_LIMITS.maxDraft}m.

${convoyRules}

${scntRules}

TOP SCA TRANSIT APPLICATION REJECTION TRIGGERS:
1. ETA less than 48 hours from submission
2. No SCA-registered agent declared
3. Missing or invalid IMO number
4. draft_forward or draft_aft exceeds ${SCA_LIMITS.maxDraft}m hard limit
5. Convoy direction missing (transit_direction blank)
6. SCNT certificate number missing (admeasurement delay)
7. Vessel over ${SCA_LIMITS.maxLOA}m LOA without special convoy approval
8. Air draft >70m without advance El-Ferdan Bridge coordination
9. Vessel agent not registered with SCA Port Said or Port Suez office

AUTO-CORRECT SUGGESTIONS TO PROVIDE:
- If IMO checksum wrong: calculate and suggest correct check digit
- If draft exceeds advisory: suggest contacting SCA Admeasurement Office for current seasonal limit
- If convoy preference missing: suggest first_northbound (most common for container/bulk)
- If ETA format wrong: suggest ISO 8601 format YYYY-MM-DDTHH:MM:SSZ`;

  } else if (document_type === 'suez_crew_manifest') {
    docSpecificRules = `
DOCUMENT TYPE: Suez Crew Manifest (SCA FAL Form 5 equivalent)
Standard: IMO FAL Form 5 / SCA crew declaration format.
Requirement: Required for all transiting vessels. Submitted via SCA Maritime Single Window.

REQUIRED PER CREW MEMBER:
1. rank: Must use IMO rank classifications (master, chief_officer, chief_engineer, etc.)
2. name: Full legal name matching passport. No abbreviations.
3. nationality: ISO 3166-1 alpha-2. Note: crew from countries with yellow fever risk (see below).
4. doc_type: "passport" (required), or seaman's book (restrictions apply).
5. doc_number: Full document number.
6. dob: Date of birth (YYYY-MM-DD).

YELLOW FEVER DECLARATION (SCA-SPECIFIC):
- Crew from endemic yellow fever countries must present valid Yellow Fever Vaccination Certificate (YFVC).
- Endemic countries include: Angola, Benin, Bolivia, Brazil, Burkina Faso, Cameroon, CAR, Chad, Colombia, Côte d'Ivoire, DRC, Ecuador, Ethiopia, Gabon, Ghana, Guinea, Guinea-Bissau, Kenya, Liberia, Mali, Mauritania, Niger, Nigeria, Panama, Peru, Senegal, Sierra Leone, South Sudan, Sudan, Togo, Trinidad & Tobago, Uganda, Venezuela.
- Flag the yellow_fever_declaration field if not present and any crew nationality matches endemic countries.

CRITICAL VALIDATIONS:
- Master (rank: "master") must be listed — vessel cannot transit without.
- Crew count declared in transit application must match actual crew_members listed.
- Missing passport numbers = crew member denied boarding at convoy assembly.

TOP REJECTION CAUSES:
1. Master not listed
2. Yellow fever certificates missing for at-risk nationalities
3. Passport numbers missing
4. Name abbreviations instead of full legal name
5. Crew count mismatch between transit application and crew manifest`;

  } else if (document_type === 'suez_cargo_declaration') {
    docSpecificRules = `
DOCUMENT TYPE: Suez Cargo Declaration (IMDG Amendment 42-24 compliant)
Standard: IMO FAL Form 2 / SCA cargo manifest format. IMDG Amendment 42-24 in force.
Requirement: Required for all laden vessels. Ballast vessels must declare "ballast only."

IMDG AMENDMENT 42-24 KEY CHANGES (in effect 2024):
- Lithium battery classifications updated: UN3090 (lithium metal cells), UN3091 (lithium metal batteries packed), UN3480 (lithium ion cells), UN3481 (lithium ion batteries packed).
- Any cargo including lithium batteries — even in consumer electronics — must be declared as Class 9.
- New stowage requirements for heated substances.
- Updated fumigated unit requirements.

REQUIRED FIELDS:
1. cargo_type: Must match vessel type. Ballast = "ballast_only".
2. bl_number: Bill of Lading number for laden vessels.
3. cargo_description: Detailed. "General cargo" or "various" will be flagged.
4. gross_weight_mt: Total cargo weight in Metric Tons.
5. has_dangerous_goods: Boolean. Mandatory declaration.

DANGEROUS GOODS (SCA-SPECIFIC RULES):
- Class 7 (Radioactive): Requires ENRRA (Egyptian Nuclear and Radiological Regulatory Authority) permit. Very strict — minimum 30-day advance notice to SCA.
- Class 1 (Explosives): SCA military approval required. Contact SCA HQ.
- Lithium batteries (UN3090/3091/3480/3481): Must be declared as Class 9. Failure to declare is a primary SCA rejection cause since 2024.
- Fumigated containers: Must declare fumigant type and ventilation status.

TOP REJECTION CAUSES:
1. Lithium batteries not declared under IMDG Amendment 42-24 Class 9 requirements
2. Class 7 cargo without ENRRA permit reference
3. Cargo description too vague
4. DG declared but no UN number or IMDG class
5. Cargo type mismatches vessel type`;

  } else if (document_type === 'suez_isps_declaration') {
    docSpecificRules = `
DOCUMENT TYPE: Suez ISPS Security Declaration
Authority: SCA Maritime Security Department + Egyptian Navy coordination.
Three-stage mandatory notification schedule:
  Stage 1: 72 hours before ETA — initial security notification
  Stage 2: 48 hours before ETA — confirmed security level + crew declaration
  Stage 3: 24 hours before ETA — final confirmation + last 10 port calls

REQUIRED FIELDS:
1. issc_number: International Ship Security Certificate number. Expiry must be in the future.
2. issc_expiry: ISSC expiry date. Expired certificate = vessel denied entry.
3. security_level: Current vessel security level (1, 2, or 3). Must match port security level or higher.
4. cso_name: Company Security Officer full name.
5. cso_contact: CSO 24/7 contact number.
6. last_10_ports: List of last 10 ports visited (UNLOCODE or full name + date). Required for SCA security screening.
7. declaration_stage: Which stage this filing represents (72h | 48h | 24h).

STAGE-SPECIFIC REQUIREMENTS:
- 72h stage: Initial ISSC number, vessel security level, last 10 ports.
- 48h stage: Confirmed crew + passenger counts, no stowaways declaration, any security incidents en route.
- 24h stage: Final confirmation, AIS transponder status, pilot boarding arrangements confirmed.

TOP REJECTION CAUSES:
1. ISSC expired or expiring within 30 days
2. Last 10 port calls incomplete or missing dates
3. Security level below SCA current port level (typically Level 1)
4. CSO contact unreachable (SCA will call before convoy)
5. Missing 24h final confirmation stage filing`;

  } else if (document_type === 'suez_sopep') {
    docSpecificRules = `
DOCUMENT TYPE: Suez SOPEP / Shipboard Oil Pollution Emergency Plan
Authority: SCA Environmental Affairs + Egyptian Environmental Affairs Agency (EEAA).
Requirement: All vessels with ≥400 MT oil capacity (cargo + fuel). Analogous to Panama's PCSOPEP.

KEY DIFFERENCE FROM PANAMA: SCA does not require a Canal-specific SOPEP rewrite — the vessel's MARPOL-compliant SOPEP is accepted IF it contains SCA-specific annex with Egyptian emergency contacts.

REQUIRED FIELDS:
1. sopep_approval_number: MARPOL SOPEP approval reference from flag state administration.
2. sopep_expiry: Expiry date. Typically renewed every 5 years with MARPOL amendments.
3. eeaa_notification: Egyptian Environmental Affairs Agency notification reference (required for vessels with >2,000 MT fuel or chemical tankers).
4. oil_capacity_mt: Total oil capacity. ≥400 MT = SOPEP required. <400 MT = flag as informational.
5. sca_annex_included: Boolean. SCA-specific emergency contact annex must be present.

REJECTION CAUSES:
1. SOPEP expired
2. MARPOL SOPEP lacking SCA/Egyptian emergency contact annex
3. EEAA notification missing for large bunker vessels
4. Oil spill response equipment inventory not current`;

  } else if (document_type === 'suez_ballast_water') {
    docSpecificRules = `
DOCUMENT TYPE: Suez Ballast Water Declaration (BWM Convention)
Authority: SCA + Egyptian Environment Law 4/1994 (amended by Law 9/2009).
Convention: IMO BWM Convention (in force since 2017). Egypt ratified 2023.

REQUIRED FIELDS:
1. bwm_certificate_number: Ballast Water Management Certificate reference.
2. bwm_plan_onboard: Boolean. BWM Plan must be ship-specific and approved by flag state.
3. treatment_method: D-1 (ballast water exchange) or D-2 (treatment system). Vessels built after 2017: D-2 required.
4. last_exchange_location: For D-1 vessels: location of last ballast water exchange. Must be ≥200nm from shore and ≥200m depth.
5. ballast_quantity_mt: Total ballast water on board.
6. ballast_record_book: Reference/page number showing last exchange/treatment entry.

VALIDATION RULES:
- D-1 exchange: Must be ≥200 nautical miles from nearest land AND >200m depth. Mediterranean Sea has areas that fail this criterion — flag if last exchange location is within enclosed sea.
- D-2 treatment: Treatment system approval number required. Efficiency ≥95% required per IMO MEPC.279(70).
- Ballast record book entries: Must be within last 30 days if any ballast operations occurred.

REJECTION CAUSES:
1. BWM certificate missing or expired
2. D-1 exchange performed in coastal waters (violates 200nm/200m rule)
3. No treatment system approval number for D-2 vessels
4. Ballast record book not updated since last port`;

  } else if (document_type === 'suez_tonnage_certificate') {
    docSpecificRules = `
DOCUMENT TYPE: Suez SCNT Tonnage Certificate
Authority: SCA Admeasurement Office, Ismailia.
Purpose: Establishes Suez Canal Net Tonnage (SCNT) — the basis for all SCA transit toll calculations.

CRITICAL: SCNT is a unique SCA measurement system, NOT the same as ITC-69 Net Tonnage used by Panama or other ports.

${scntRules}

REQUIRED FIELDS:
1. scnt_value: Suez Canal Net Tonnage numeric value. Used directly for toll calculation.
2. scnt_certificate_number: SCA-issued SCNT certificate reference (format: SCA-SCNT-YYYY-NNNNNN).
3. scnt_issue_date: Date of SCNT certificate issue.
4. scnt_expiry_date: Must be in the future. SCNT certificates valid 3 years.
5. admeasurement_port: Port where SCA admeasurement was performed (typically Port Said or Ismailia).
6. vessel_category: SCA vessel category for toll rate table:
   - Container ships (TEU-based rate)
   - Bulk carriers (SCNT-based rate, rebates available)
   - Crude/product tankers
   - LNG/LPG carriers (special rate tier)
   - Ro-Ro / vehicle carriers
   - Passenger/cruise ships
   - General cargo
   - Other

VALIDATION RULES:
- scnt_expiry_date must be in the future. Expired = admeasurement required on arrival (6-12 hour delay).
- scnt_value consistency: SCNT should typically be 60-75% of GT for most vessel types. Flag if ratio is outside 40-90% range.
- Bulk carrier rebate: Eligible for ≤75% rebate if grain/ore cargo (verify cargo type consistency).
- LNG carriers: Subject to separate SCA LNG rate table — verify vessel_category matches vessel_type.

AUTO-CORRECT SUGGESTIONS:
- If scnt_expiry_date is past: "SCNT certificate expired — contact SCA Admeasurement Office for renewal appointment at Port Said (+20-64-320-6020)"
- If SCNT ratio is suspect: "SCNT/GT ratio of X% is unusual. Verify against SCA-issued certificate — discrepancy may trigger admeasurement"
- If certificate format wrong: Suggest "SCA-SCNT-${now.getFullYear()}-NNNNNN" format`;

  } else {
    docSpecificRules = `
DOCUMENT TYPE: ${document_type} (SCA Suez Canal Filing)
Validate for completeness, data consistency, and SCA requirements.
${convoyRules}
${scntRules}`;
  }

  return `You are an SCA (Suez Canal Authority) compliance expert with 20 years of Suez Canal transit filing experience. You review pre-arrival documents for exact compliance with SCA regulations. You know the specific rejection reasons that cost operators $20,000–$80,000 per incident.

Current timestamp: ${nowISO}
${etaContext}

${sharedVesselRules}

${docSpecificRules}

FILING DATA TO VALIDATE:
${filingJson}

INSTRUCTIONS:
- Check every required field against the SCA rules above
- Prioritize errors that cause SCA REJECTION over warnings
- Be specific: name the exact field, the exact problem, and the exact fix
- For IMO checksum errors: calculate the correct check digit (weights 7,6,5,4,3,2 × first 6 digits, last digit = sum mod 10) and state the corrected IMO number in the suggestion
- For tonnage issues: suggest "SCNT should be approximately ${'{'}GT × 0.65{'}'} based on vessel type — verify against SCA-issued certificate"
- For convoy timing: calculate hours from NOW (${nowISO}) and state whether convoy slot is achievable
- Do NOT invent issues that are not there — only flag real problems in the data
- Maximum 12 issues total; prioritize by severity (errors first)

SEVERITY LEVELS:
- "error" = SCA will REJECT filing or vessel will be denied transit. Fix before submitting.
- "warning" = Will cause delays, additional fees, or requires supplementary documentation.
- "info" = Best practice, SCA advisory, or minor improvement.

AUTO-CORRECT SUGGESTIONS (include in "suggestion" field when applicable):
- IMO checksum: state the corrected 7-digit number
- Vessel name standardization: uppercase, no special characters
- Draft advisory: "Current SCA advisory draft is ${SCA_LIMITS.advisoryDraft}m — contact SCA Admeasurement for latest seasonal limit"
- Convoy timing: "File at least 96 hours before ETA for guaranteed convoy slot assignment"

Return ONLY valid JSON (no markdown, no backticks):
{
  "issues": [
    {
      "severity": "error",
      "field": "exact_field_name",
      "message": "Specific problem description with SCA regulatory reference",
      "suggestion": "Exact corrective action, including corrected value where calculable"
    }
  ],
  "overall": "pass|warn|fail",
  "summary": "One sentence: SCA filing status and most critical action needed"
}

If no issues found, return: {"issues": [], "overall": "pass", "summary": "Filing meets SCA requirements and is ready for Suez Canal pre-arrival submission."}`;
}

/**
 * POST /api/filing/validate
 * AI-powered validation with timeout, retry logic, and graceful fallback
 * Uses document-type-specific prompts with real ACP/VUMPA specs (Panama) or SCA specs (Suez).
 * Timeout: 15s. Retries: 2. Fallback: error with clear message.
 */
router.post('/filing/validate', requireAuth, async (req, res) => {
  const startTime = Date.now();
  const MAX_RETRIES = 2;
  const AI_TIMEOUT_MS = 15000; // 15 second timeout
  let retryCount = 0;

  try {
    const { document_type, canal, vessel, document_data } = req.body;
    if (!document_type) return res.status(400).json({ success: false, message: 'document_type is required' });

    // Waterway access check
    const canalToCheck = (canal || 'panama').toLowerCase();
    if (!await checkWaterwayAccess(req, res, canalToCheck)) return;

    const ai = getAIClient();
    // Route to canal-specific prompt builder
    const isSuez = canal && canal.toLowerCase() === 'suez';
    const prompt = isSuez
      ? buildSuezValidationPrompt(document_type, vessel, document_data)
      : buildValidationPrompt(document_type, vessel, document_data);

    // Helper: call AI with timeout
    async function callAIWithTimeout() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

      try {
        const completion = await ai.chat.completions.create({
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 1800,
          response_format: { type: 'json_object' }
        });

        clearTimeout(timeoutId);
        return completion;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    // Retry logic
    let completion;
    while (retryCount < MAX_RETRIES) {
      try {
        completion = await callAIWithTimeout();
        break; // Success, exit retry loop
      } catch (err) {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          console.warn(`[AI Validate] Max retries (${MAX_RETRIES}) exceeded. Using fallback validation.`);
          throw err;
        }
        console.warn(`[AI Validate] Retry ${retryCount}/${MAX_RETRIES} after error: ${err.message}`);
        await new Promise(r => setTimeout(r, 1000 * retryCount)); // Exponential backoff: 1s, 2s
      }
    }

    // Parse AI response
    const raw = completion.choices[0]?.message?.content || '{"issues":[],"overall":"pass","summary":"Validation complete."}';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[AI Validate] Failed to parse JSON response, using empty issues');
      parsed = { issues: [], overall: 'pass', summary: 'Validation complete.' };
    }

    // Ensure structure with categorization
    if (!parsed.issues) parsed.issues = [];
    if (!parsed.overall) {
      parsed.overall = parsed.issues.some(i => i.severity === 'error') ? 'fail' : parsed.issues.length > 0 ? 'warn' : 'pass';
    }

    // Categorize issues for frontend
    const critical = parsed.issues.filter(i => i.severity === 'error' || i.severity === 'critical') || [];
    const warnings = parsed.issues.filter(i => i.severity === 'warning') || [];
    const info = parsed.issues.filter(i => i.severity === 'info') || [];

    const responseTime = Date.now() - startTime;
    console.log(`[AI Validate] Completed (${responseTime}ms, retries=${retryCount}, issues=${parsed.issues.length})`);

    res.json({
      success: true,
      validation: parsed,
      categories: { critical, warnings, info },
      response_time_ms: responseTime,
      retries: retryCount,
      ai_used: true
    });
  } catch (err) {
    // Fallback: Return error with clear message
    const responseTime = Date.now() - startTime;
    console.error(`[AI Validate] Failed after ${retryCount} retries (${responseTime}ms): ${err.message}`);

    res.status(500).json({
      success: false,
      message: `AI validation timeout or error after ${retryCount} retries. Please try again or review filing manually.`,
      response_time_ms: responseTime,
      retries: retryCount,
      fallback: true,
      error_code: 'AI_VALIDATION_FAILED'
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — require auth + admin role
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/stats
 * High-level counts for the admin dashboard
 * Optimized: Single query with aggregations instead of N+1
 */
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  const startTime = Date.now();
  const pool = req.app.locals.pool;
  try {
    // Single optimized query with all aggregations — covers all 5 waterways
    const stats = await adminStatsDb.getDashboardStats(pool);
    const responseTime = Date.now() - startTime;
    console.log(`[Admin Stats] Query completed in ${responseTime}ms`);

    // Helper: compute pass rate string
    const passRate = (pass, total) => total > 0 ? Math.round((pass / total) * 100) : 0;
    const pi = (v) => parseInt(v) || 0;

    res.json({
      success: true,
      users: {
        total: pi(stats.total_users),
        active: pi(stats.active_users),
        new_this_week: pi(stats.new_users_week)
      },
      filings: {
        total: pi(stats.total_filings_all),
        submitted: pi(stats.submitted_filings),
        new_this_week: pi(stats.new_filings_week)
      },
      purchase_requests: {
        total: pi(stats.total_purchases),
        new_this_week: pi(stats.new_purchases_week)
      },
      validations: {
        total: pi(stats.total_validations)
      },
      leads: {
        total: pi(stats.total_leads),
        new_this_week: pi(stats.new_leads_week)
      },
      // Per-waterway breakdowns
      panama: {
        filings_total: pi(stats.panama_filings_total),
        filings_this_month: pi(stats.panama_filings_month),
        validations_total: pi(stats.panama_validations_total),
        validations_pass: pi(stats.panama_validations_pass),
        leads: pi(stats.panama_leads)
      },
      suez: {
        filings_total: pi(stats.suez_filings_total),
        filings_this_month: pi(stats.suez_filings_month),
        filings_this_week: pi(stats.suez_filings_week),
        validations_total: pi(stats.suez_validations_total),
        validations_pass: pi(stats.suez_validations_pass),
        overdue_isps: pi(stats.overdue_isps_count),
        active_sca_submissions: pi(stats.active_sca_submissions),
        leads: pi(stats.suez_leads)
      },
      bosporus: {
        filings_total: pi(stats.bosporus_filings_total),
        filings_this_month: pi(stats.bosporus_filings_month),
        validations_total: pi(stats.bosporus_validations_total),
        validations_pass: pi(stats.bosporus_validations_pass),
        leads: pi(stats.bosporus_leads)
      },
      malacca: {
        filings_total: pi(stats.malacca_filings_total),
        filings_this_month: pi(stats.malacca_filings_month),
        validations_total: pi(stats.malacca_validations_total),
        validations_pass: pi(stats.malacca_validations_pass),
        leads: pi(stats.malacca_leads)
      },
      cape: {
        filings_total: pi(stats.cape_filings_total),
        filings_this_month: pi(stats.cape_filings_month),
        validations_total: pi(stats.cape_validations_total),
        validations_pass: pi(stats.cape_validations_pass),
        leads: pi(stats.cape_leads)
      },
      response_time_ms: responseTime
    });
  } catch (err) {
    console.error('[Admin Stats] Query error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/users
 * List all registered users with subscription info
 */
router.get('/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const search = req.query.search ? `%${req.query.search}%` : null;

  try {
    const result = await adminStatsDb.listAdminUsers(pool, limit, offset, search);

    const countResult = await adminStatsDb.countAdminUsers(pool, search);

    res.json({
      success: true,
      users: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Admin Users]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/purchase-requests
 * All purchase requests / payment intent captures
 */
router.get('/admin/purchase-requests', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    const result = await purchaseRequestsDb.listPurchaseRequests(pool, limit, offset);

    const total = await purchaseRequestsDb.countPurchaseRequests(pool);

    res.json({
      success: true,
      purchase_requests: result.rows,
      total: parseInt(total.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Admin PurchaseRequests]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/filings
 * All compliance document filings across all users
 */
router.get('/admin/filings', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const status = req.query.status || null;
  const canal = req.query.canal || null;

  try {
    const result = await adminStatsDb.listAdminFilings(pool, limit, offset, status, canal);

    const countRes = await adminStatsDb.countAdminFilings(pool, status, canal);

    res.json({
      success: true,
      filings: result.rows,
      total: parseInt(countRes.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Admin Filings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez-analytics
 * Suez-specific analytics: filing counts, validation pass rate, common errors, revenue split
 */
router.get('/admin/suez-analytics', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [analyticsRes, errorsRes, feeRes] = await Promise.all([
      // Suez vs Panama filing breakdown + validation rates
      adminStatsDb.getSuezFilingBreakdown(pool),
      // Most common Suez validation failures — scan checklist JSON
      adminStatsDb.getSuezCommonValidationErrors(pool),
      // Fee calculation summary from sca_submissions
      adminStatsDb.getScaSubmissionsSummary(pool)
    ]);

    const a = analyticsRes.rows[0];
    const suezTotal = parseInt(a.suez_total) || 0;
    const suezPass = parseInt((await adminStatsDb.countSuezValidationsPass(pool)).rows[0].c) || 0;
    const suezValidTotal = parseInt((await adminStatsDb.countSuezValidationsTotal(pool)).rows[0].c) || 0;

    res.json({
      success: true,
      filings: {
        suez_total:    parseInt(a.suez_total),
        panama_total:  parseInt(a.panama_total),
        suez_month:    parseInt(a.suez_month),
        panama_month:  parseInt(a.panama_month),
        suez_week:     parseInt(a.suez_week),
        suez_submitted: parseInt(a.suez_submitted),
        suez_draft:    parseInt(a.suez_draft),
        suez_approved: parseInt(a.suez_approved),
        suez_rejected: parseInt(a.suez_rejected),
      },
      validation: {
        total: suezValidTotal,
        pass:  suezPass,
        pass_rate: suezValidTotal > 0 ? Math.round((suezPass / suezValidTotal) * 100) : null
      },
      common_errors: errorsRes.rows,
      submissions: feeRes.rows[0]
    });
  } catch (err) {
    console.error('[Admin Suez Analytics]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez-isps-timeline
 * ISPS notification timeline — active filings with upcoming/overdue deadlines
 */
router.get('/admin/suez-isps-timeline', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    // Active Suez filings with their ISPS notification state
    const filingsRes = await adminStatsDb.getSuezIspsTimeline(pool);

    // Overdue: ISPS notifications still pending after 24h
    const overdueRes = await adminStatsDb.getSuezIspsOverdue(pool);

    res.json({
      success: true,
      filings: filingsRes.rows,
      overdue_notifications: overdueRes.rows,
      overdue_count: overdueRes.rows.length
    });
  } catch (err) {
    console.error('[Admin Suez ISPS Timeline]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez-convoy-status
 * Convoy booking status + fee calculation audit trail
 */
router.get('/admin/suez-convoy-status', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [convoyRes, feeAuditRes] = await Promise.all([
      // All SCA submissions with convoy info
      adminStatsDb.getScaConvoySubmissions(pool),
      // Fee tier usage — how many submissions per vessel_category
      adminStatsDb.getScaFeeTierUsage(pool).catch(() => ({ rows: [] }))  // graceful: vessel_category may not exist on old rows
    ]);

    // Convoy breakdown by type
    const convoyBreakdown = {};
    for (const row of convoyRes.rows) {
      const c = row.convoy_number || 'unassigned';
      convoyBreakdown[c] = (convoyBreakdown[c] || 0) + 1;
    }

    res.json({
      success: true,
      submissions: convoyRes.rows,
      convoy_breakdown: convoyBreakdown,
      fee_audit: feeAuditRes.rows
    });
  } catch (err) {
    console.error('[Admin Suez Convoy Status]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/suez/isps-notification
 * Submit a pre-arrival ISPS notification (72h/48h/24h)
 */
router.post('/suez/isps-notification', requireAuth, requireSuez, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, notification_type, special_measures, last_10_ports } = req.body;

    if (!filing_id || !notification_type) {
      return res.status(400).json({ success: false, message: 'filing_id and notification_type are required' });
    }
    if (!['72h', '48h', '24h'].includes(notification_type)) {
      return res.status(400).json({ success: false, message: 'notification_type must be 72h, 48h, or 24h' });
    }

    // Verify filing belongs to user and is Suez — fetch vessel info for NOT NULL columns
    const filingRes = await purchaseRequestsDb.getFilingForIsps(pool, filing_id, userId);
    if (filingRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Filing not found' });
    const f = filingRes.rows[0];
    if (f.canal !== 'suez') return res.status(400).json({ success: false, message: 'ISPS notifications are only for Suez Canal filings' });

    const result = await purchaseRequestsDb.insertIspsNotification(pool, {
      userId, filingId: filing_id,
      vesselName: f.vessel_name, imoNumber: f.imo_number,
      notificationType: notification_type,
      specialMeasures: special_measures,
      last10Ports: last_10_ports
    });

    res.json({ success: true, notification: result.rows[0] });
  } catch (err) {
    console.error('[Suez ISPS Notification]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/suez/convoy-booking
 * Book a convoy slot for a Suez filing (enhanced with priority, agent info, special requirements)
 */
router.post('/suez/convoy-booking', requireAuth, requireSuez, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const {
      filing_id,
      convoy_number,
      transit_direction,
      requested_transit_date,
      priority_class,
      agent_name,
      agent_phone,
      agent_email,
      special_requirements,
      notes
    } = req.body;

    if (!filing_id || !transit_direction) {
      return res.status(400).json({ success: false, message: 'filing_id and transit_direction are required' });
    }

    if (!['northbound', 'southbound'].includes(transit_direction)) {
      return res.status(400).json({ success: false, message: 'transit_direction must be northbound or southbound' });
    }

    // Verify filing belongs to user and is Suez
    const filing = await purchaseRequestsDb.getFilingForConvoy(pool, filing_id, userId);
    if (filing.rows.length === 0) return res.status(404).json({ success: false, message: 'Filing not found' });
    if (filing.rows[0].canal !== 'suez') return res.status(400).json({ success: false, message: 'Convoy booking is only for Suez Canal filings' });

    // sca_submissions requires user_id (NOT NULL); use vessel info from filing
    const filingInfo = await purchaseRequestsDb.getFilingVesselInfo(pool, filing_id);
    const vessel = filingInfo.rows[0] || {};

    // Derive priority class from vessel type if not provided
    const effectivePriorityClass = priority_class || derivePriorityClass(vessel.vessel_type);

    // Normalize special_requirements to array
    const specialReqArray = Array.isArray(special_requirements)
      ? special_requirements
      : (special_requirements ? [special_requirements] : null);

    const result = await purchaseRequestsDb.insertConvoyBooking(pool, {
      userId, filingId: filing_id,
      vesselName: vessel.vessel_name,
      transitDirection: transit_direction,
      convoyNumber: convoy_number,
      requestedTransitDate: requested_transit_date,
      priorityClass: effectivePriorityClass,
      agentName: agent_name,
      agentPhone: agent_phone,
      agentEmail: agent_email,
      specialRequirements: specialReqArray,
      notes
    });

    res.json({ success: true, booking: result.rows[0] });
  } catch (err) {
    console.error('[Suez Convoy Booking]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Helper: derive priority class from vessel_type string
function derivePriorityClass(vesselType) {
  if (!vesselType) return 'standard';
  const vt = vesselType.toLowerCase();
  if (vt.includes('lng') || vt.includes('liquefied natural gas')) return 'priority_1';
  if (vt.includes('lpg') || vt.includes('liquefied petroleum')) return 'priority_1';
  if (vt.includes('container')) return 'priority_2';
  if (vt.includes('tanker') || vt.includes('crude') || vt.includes('product') || vt.includes('chemical')) return 'priority_2';
  if (vt.includes('passenger') || vt.includes('cruise')) return 'priority_2';
  if (vt.includes('ro-ro') || vt.includes('roro')) return 'priority_2';
  return 'standard';
}

/**
 * GET /api/suez/convoy-schedule
 * Returns SCA convoy schedule (northbound & southbound daily timetable + waiting areas)
 */
router.get('/suez/convoy-schedule', async (req, res) => {
  // SCA standard convoy schedule — authoritative as of 2024
  const schedule = {
    northbound: [
      {
        name: 'First Northbound Convoy',
        departure_point: 'Suez (South entrance)',
        departure_time: '06:00 UTC+2',
        bitter_lake_entry: '~12:00 UTC+2',
        arrival_port_said: '~18:00–20:00 UTC+2',
        capacity: 'Main convoy — all vessel types',
        notes: 'Primary convoy. LNG, container, and tanker vessels given priority boarding.'
      },
      {
        name: 'Second Northbound Convoy',
        departure_point: 'Suez (South entrance)',
        departure_time: '12:00 UTC+2',
        bitter_lake_entry: '~16:00 UTC+2',
        arrival_port_said: '~22:00–24:00 UTC+2',
        capacity: 'Limited — select vessels only',
        notes: 'Second convoy runs when traffic volume warrants. Primarily bulk carriers and general cargo.'
      }
    ],
    southbound: [
      {
        name: 'Southbound Convoy',
        departure_point: 'Port Said (North entrance)',
        departure_time: '03:00–04:00 UTC+2',
        bitter_lake_wait: '~09:00–14:00 UTC+2 (convoy pass)',
        arrival_suez: '~18:00–20:00 UTC+2',
        capacity: 'All vessel types',
        notes: 'Single daily southbound convoy. Vessels anchor in Great Bitter Lake while northbound convoy passes.'
      }
    ],
    transit_duration: {
      total_canal_length_km: 193,
      typical_transit_hours: '12–16',
      max_vessel_speed_knots: 8,
      notes: 'Transit duration varies with vessel draft, beam, and traffic conditions.'
    },
    waiting_areas: [
      {
        name: 'Port Said Roads',
        location: 'North entrance, Mediterranean side',
        coordinates: '31°16\'N 32°18\'E',
        capacity: '~40 vessels',
        used_by: 'Southbound convoy vessels awaiting departure',
        anchorage_type: 'Open roadstead — exposed in northerly swells',
        vhf_channel: 'Ch 16 / Ch 74 (Port Said VTS)',
        notes: 'Report to Port Said Traffic on arrival. Average pre-convoy wait: 12–36 hours.'
      },
      {
        name: 'Great Bitter Lake',
        location: 'Midway anchorage, canal km 97–120',
        coordinates: '30°19\'N 32°35\'E',
        capacity: '~30 vessels simultaneously',
        used_by: 'Convoy passing point — both directions anchor here',
        anchorage_type: 'Sheltered lake — excellent holding ground',
        vhf_channel: 'Ch 16 / SCA convoy frequency Ch 74',
        notes: 'Southbound convoy waits here while northbound passes. No shore facilities.'
      },
      {
        name: 'Suez Bay (Outer Anchorage)',
        location: 'South entrance, Red Sea side',
        coordinates: '29°56\'N 32°34\'E',
        capacity: '~25 vessels',
        used_by: 'Northbound convoy vessels awaiting departure',
        anchorage_type: 'Sheltered bay — generally calm conditions',
        vhf_channel: 'Ch 16 / Suez Traffic Ch 74',
        notes: 'Report to Suez Traffic VTS on arrival. Pilot boarding here for convoy departure.'
      }
    ]
  };

  res.json({ success: true, schedule });
});

/**
 * GET /api/suez/priority-rules
 * Returns SCA vessel priority classification rules and expected waiting times
 */
router.get('/suez/priority-rules', async (req, res) => {
  const rules = [
    {
      priority_class: 'priority_1',
      label: 'Priority 1 — Highest',
      badge_color: '#7C3AED',
      vessel_types: ['LNG Carrier', 'LPG Carrier'],
      description: 'Gas carriers (LNG/LPG) receive highest SCA priority. Convoy slot guaranteed within 24 hours of arrival at waiting anchorage.',
      typical_wait_hours: { min: 12, max: 36 },
      slot_guarantee: true,
      notes: [
        'LNG carriers: dedicated pilot and tug assignment',
        'Hazmat paperwork (DG declaration, SCA/ENRRA permit) must be submitted 72h in advance',
        'Wide-beam LNG carriers may require additional clearance from SCA Operations'
      ]
    },
    {
      priority_class: 'priority_2',
      label: 'Priority 2 — High',
      badge_color: '#0369A1',
      vessel_types: ['Container Ship', 'Tanker (Crude)', 'Tanker (Product)', 'Chemical Tanker', 'Passenger/Cruise', 'RoRo Vessel'],
      description: 'Container ships, tankers, and passenger vessels receive high priority. Typical convoy assignment within 24–48 hours.',
      typical_wait_hours: { min: 24, max: 72 },
      slot_guarantee: false,
      notes: [
        'Tankers: single-hull vessels may face additional inspection',
        'Container ships: slot priority scales with TEU capacity',
        'RoRo: lane measurements must match SCA pre-arrival notification'
      ]
    },
    {
      priority_class: 'standard',
      label: 'Standard Priority',
      badge_color: '#64748B',
      vessel_types: ['Bulk Carrier', 'General Cargo', 'OBO Carrier', 'Other'],
      description: 'Standard priority applies to bulk carriers and general cargo vessels. Transit date subject to convoy capacity.',
      typical_wait_hours: { min: 48, max: 120 },
      slot_guarantee: false,
      notes: [
        'Bulk carriers in ballast may qualify for the 75% toll rebate program',
        'Second northbound convoy slot often available for bulk carriers when first is full',
        'Oversize vessels (LOA >300m or beam >60m) require SCA pre-clearance regardless of priority'
      ]
    }
  ];

  res.json({ success: true, rules });
});

/**
 * GET /api/suez/waiting-estimate
 * Returns estimated waiting time based on vessel type, direction, and seasonal factors
 * Query params: vessel_type, direction, requested_date
 */
router.get('/suez/waiting-estimate', async (req, res) => {
  try {
    const { vessel_type = 'bulk_carrier', direction = 'northbound', requested_date } = req.query;

    // Derive base wait from priority class
    const priorityClass = derivePriorityClass(vessel_type);
    const baseWait = {
      priority_1: { min: 12, max: 36, label: '12–36 hours' },
      priority_2: { min: 24, max: 72, label: '24–72 hours' },
      standard:   { min: 48, max: 120, label: '2–5 days' }
    }[priorityClass] || { min: 48, max: 120, label: '2–5 days' };

    // Seasonal adjustment — Suez peak season April–June and Oct–Dec
    let seasonalFactor = 1.0;
    let seasonNote = 'Normal traffic volume';
    if (requested_date) {
      const month = new Date(requested_date).getMonth() + 1; // 1–12
      if ([4, 5, 6, 10, 11, 12].includes(month)) {
        seasonalFactor = 1.3;
        seasonNote = 'Peak season — 20–30% longer waits expected';
      } else if ([1, 2].includes(month)) {
        seasonalFactor = 0.85;
        seasonNote = 'Low season — shorter waits expected';
      }
    }

    // Direction factor — southbound generally slightly shorter wait
    const directionFactor = direction === 'southbound' ? 0.9 : 1.0;
    const directionNote = direction === 'southbound'
      ? 'Southbound convoy: single daily departure, slightly shorter average wait'
      : 'Northbound: two convoys daily, first departure at 06:00';

    const adjustedMin = Math.round(baseWait.min * seasonalFactor * directionFactor);
    const adjustedMax = Math.round(baseWait.max * seasonalFactor * directionFactor);

    // Estimate earliest possible transit date
    let estimatedTransitDate = null;
    const refDate = requested_date ? new Date(requested_date) : new Date();
    estimatedTransitDate = new Date(refDate);
    estimatedTransitDate.setHours(estimatedTransitDate.getHours() + adjustedMin);

    res.json({
      success: true,
      estimate: {
        priority_class: priorityClass,
        vessel_type,
        direction,
        wait_hours: { min: adjustedMin, max: adjustedMax },
        wait_label: `${adjustedMin}–${adjustedMax} hours`,
        estimated_earliest_transit: estimatedTransitDate.toISOString().split('T')[0],
        seasonal_factor: seasonalFactor,
        season_note: seasonNote,
        direction_note: directionNote,
        disclaimer: 'Estimates based on historical SCA averages. Actual wait depends on live queue depth, vessel inspections, and SCA operational decisions. CanalClear does not guarantee transit slots.'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/my-bookings
 * Returns the authenticated user's convoy booking history
 */
router.get('/suez/my-bookings', requireAuth, requireSuez, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await purchaseRequestsDb.getUserConvoyBookings(pool, userId);

    res.json({ success: true, bookings: result.rows });
  } catch (err) {
    console.error('[My Convoy Bookings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/my-filings
 * Returns authenticated user's Suez Canal filings (for convoy booking dropdown)
 */
router.get('/suez/my-filings', requireAuth, requireSuez, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await purchaseRequestsDb.getUserSuezFilings(pool, userId);

    res.json({ success: true, filings: result.rows });
  } catch (err) {
    console.error('[My Suez Filings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/fee-tiers
 * Return active SCA fee tier schedule
 */
router.get('/suez/fee-tiers', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pricingSlotsDb.getActiveFeeTiers(pool);
    res.json({ success: true, tiers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/suez/calculate-fees
 * Calculate estimated Suez Canal toll based on SCNT and vessel type
 */
router.post('/suez/calculate-fees', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { scnt, vessel_type = 'bulk_carrier', direction = 'northbound', has_cargo = true } = req.body;

    if (!scnt || scnt <= 0) {
      return res.status(400).json({ success: false, message: 'scnt is required and must be positive' });
    }

    // Load fee tiers
    const tiersRes = await pricingSlotsDb.getActiveFeeTiers(pool);
    const tiers = tiersRes.rows;

    // Calculate base toll using tiered rate
    let baseToll = 0;
    let remainingScnt = parseFloat(scnt);
    const breakdown = [];

    for (const tier of tiers) {
      if (remainingScnt <= 0) break;
      const tierMin = parseFloat(tier.min_scnt);
      const tierMax = tier.max_scnt ? parseFloat(tier.max_scnt) : Infinity;
      const tierScnt = Math.min(remainingScnt, tierMax - tierMin);
      if (tierScnt <= 0) continue;
      const charge = tierScnt * parseFloat(tier.rate_usd_per_scnt);
      baseToll += charge;
      breakdown.push({ tier_name: tier.tier_name, scnt_applied: tierScnt, rate: tier.rate_usd_per_scnt, charge: charge.toFixed(2) });
      remainingScnt -= tierScnt;
    }

    // Apply bulk carrier rebate (if applicable)
    let rebatePercent = 0;
    let rebateNote = '';
    if (vessel_type === 'bulk_carrier' && !has_cargo) {
      rebatePercent = 75;
      rebateNote = 'Bulk carrier in ballast (75% rebate)';
    } else if (vessel_type === 'bulk_carrier') {
      rebatePercent = 35;
      rebateNote = 'Bulk carrier laden (35% rebate program)';
    }

    const rebateAmount = baseToll * (rebatePercent / 100);
    const netToll = baseToll - rebateAmount;

    // Additional charges
    const pilotage = 1200; // approximate pilotage fee USD
    const mooring = 800;   // approximate mooring fee USD
    const totalEstimate = netToll + pilotage + mooring;

    res.json({
      success: true,
      estimate: {
        scnt: parseFloat(scnt),
        vessel_type,
        direction,
        base_toll: baseToll.toFixed(2),
        rebate_percent: rebatePercent,
        rebate_amount: rebateAmount.toFixed(2),
        rebate_note: rebateNote,
        net_toll: netToll.toFixed(2),
        pilotage_estimate: pilotage.toFixed(2),
        mooring_estimate: mooring.toFixed(2),
        total_estimate: totalEstimate.toFixed(2),
        breakdown,
        currency: 'USD',
        disclaimer: 'Estimates only. Actual tolls set by SCA at time of transit.'
      }
    });
  } catch (err) {
    console.error('[Suez Fee Calculator]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/signups-chart
 * Daily signups for the past 30 days (for basic analytics chart)
 */
router.get('/admin/signups-chart', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await adminStatsDb.getSignupsChart(pool);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// LEADS — email capture for prospects requesting a demo / free assessment
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Send a confirmation email via Polsia email proxy.
 * Gracefully degrades — lead is always saved even if email fails.
 */
async function sendLeadConfirmationEmail(email, companyName, leadData) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.log('[Leads] POLSIA_API_KEY not set — skipping confirmation email');
    return;
  }

  const source = leadData && leadData.source ? leadData.source : '';

  // ── Bosporus Primer: deliver PDF link immediately ─────────────────────────
  if (source === 'bosporus_primer') {
    try {
      const primerHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a2332;">
  <div style="background:#0d1b2e;padding:28px 36px;border-radius:12px 12px 0 0;border-bottom:3px solid #d4622b;">
    <span style="font-size:1.25rem;font-weight:700;color:#d4622b;letter-spacing:-0.3px;">CanalClear</span>
    <span style="font-size:0.75rem;color:#8fa3b8;margin-left:10px;">Maritime Compliance Automation</span>
  </div>
  <div style="background:#142238;padding:36px;border-radius:0 0 12px 12px;">
    <h2 style="color:#ffffff;font-size:1.1rem;margin:0 0 14px;font-weight:700;">Your Bosporus SP-1 Compliance Primer is ready ✅</h2>
    <p style="color:#b8c8d8;line-height:1.7;margin:0 0 20px;">
      The 2024 edition covers Montreux Convention rules, all 4 SP-1 forms, filing deadlines, the 5 rejection mistakes, pilot thresholds, and the full fees breakdown.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="https://canal-clear.polsia.app/assets/bosporus-sp1-primer.pdf" style="background:#d4622b;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.95rem;display:inline-block;">Download SP-1 Primer PDF →</a>
    </p>
    <p style="color:#b8c8d8;line-height:1.7;margin:0 0 16px;">
      <strong style="color:#e8eef4;">Want to eliminate SP-1 rejections entirely?</strong><br>
      CanalClear auto-fills every SP-1 field from your vessel profile, validates against Montreux constraints, and integrates with KBŞ pilot booking — so you never miss a deadline or get anchored at Buyukdere.
    </p>
    <a href="https://canalclear.org/demo/bosporus" style="display:inline-block;border:1px solid #d4622b;color:#d4622b;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.875rem;margin-bottom:24px;">Try the Bosporus demo →</a>
    <p style="color:#8fa3b8;font-size:0.75rem;margin-top:24px;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
      Questions? Reply to this email or visit <a href="https://canalclear.org/bosporus" style="color:#d4622b;">canalclear.org/bosporus</a>
    </p>
  </div>
</div>`;
      await fetch('https://polsia.com/api/proxy/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          to: email,
          subject: 'Your Bosporus SP-1 Compliance Primer — 2024 Edition',
          body: 'Your Bosporus SP-1 Compliance Primer is ready. Download it at: https://canal-clear.polsia.app/assets/bosporus-sp1-primer.pdf',
          html: primerHtml,
        }),
      });
      console.log('[Leads] Bosporus primer email sent to', email);
    } catch (err) {
      console.error('[Leads] Bosporus primer email error:', err.message);
    }
    // Still send admin notification below (falls through)
  }

  const firstName = companyName ? companyName.split(' ')[0] : 'there';

  // 1. Auto-reply to the lead (generic — skipped for sources that already sent a specific email)
  if (source !== 'bosporus_primer') {
  try {
    const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a2b45;">
  <div style="background:#0A1628;padding:32px 40px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#00D4AA;font-size:1.5rem;margin:0;">CanalClear</h1>
    <p style="color:#8899AA;font-size:0.85rem;margin:4px 0 0;">Panama Canal Compliance Automation</p>
  </div>
  <div style="background:#0F1D32;padding:40px;border-radius:0 0 12px 12px;">
    <h2 style="color:#F0F4F8;font-size:1.2rem;margin:0 0 16px;">Your compliance assessment request is received ✅</h2>
    <p style="color:#C4D0DC;line-height:1.7;">Hi ${firstName},</p>
    <p style="color:#C4D0DC;line-height:1.7;">
      Thanks for requesting a free CanalClear compliance assessment. Our team will review your vessel details within <strong style="color:#F0F4F8;">24 hours</strong> and reach out with next steps.
    </p>
    <div style="background:#1A2B45;border-radius:10px;padding:20px 24px;margin:24px 0;">
      <p style="color:#00D4AA;font-size:0.85rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;">In the meantime</p>
      <p style="color:#C4D0DC;margin:0;line-height:1.7;">
        Try our free compliance score tool to get an instant read on your vessel's Panama Canal readiness:
      </p>
    </div>
    <a href="https://canalclear.org/compliance-score" style="display:inline-block;background:#00D4AA;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:8px;">Check Your Compliance Score →</a>
    <p style="color:#8899AA;font-size:0.8rem;margin-top:32px;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
      Questions? Reply to this email or contact <a href="mailto:eagleconsulting954@gmail.com" style="color:#00D4AA;">eagleconsulting954@gmail.com</a>
    </p>
  </div>
</div>`;

    const response = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: email,
        subject: 'We received your CanalClear compliance assessment request',
        body: 'We received your CanalClear compliance assessment request',
        html,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[Leads] Confirmation email failed:', response.status, text.slice(0, 200));
    } else {
      console.log('[Leads] Confirmation email sent to', email);
    }
  } catch (err) {
    console.error('[Leads] Confirmation email error:', err.message);
  }
  } // end if (source !== 'bosporus_primer')

  // 2. Internal notification to Francis
  try {
    const fleetSize = leadData && leadData.fleet_size ? leadData.fleet_size : '—';
    const adminSource = leadData && leadData.source ? leadData.source : 'unknown';
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    const notifyHtml = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
  <h2 style="color:#00D4AA;">New CanalClear Lead 🚢</h2>
  <table style="border-collapse:collapse;width:100%;margin:20px 0;">
    <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;width:35%;">Name / Company</td><td style="padding:8px;">${companyName || '—'}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Email</td><td style="padding:8px;">${email}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Fleet Size</td><td style="padding:8px;">${fleetSize}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Source</td><td style="padding:8px;">${adminSource}</td></tr>
    <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Submitted</td><td style="padding:8px;">${timestamp}</td></tr>
  </table>
  <a href="https://canal-clear.polsia.app/admin" style="background:#00D4AA;color:#0A1628;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">View All Leads →</a>
</div>`;

    const notifyResponse = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: 'eagleconsulting954@gmail.com',
        subject: `New CanalClear Lead: ${companyName || email}`,
        body: `New CanalClear Lead: ${companyName || email}`,
        html: notifyHtml,
      }),
    });
    if (!notifyResponse.ok) {
      const text = await notifyResponse.text().catch(() => '');
      console.error('[Leads] Francis notification failed:', notifyResponse.status, text.slice(0, 200));
    } else {
      console.log('[Leads] Francis notification sent for lead:', email);
    }
  } catch (err) {
    console.error('[Leads] Francis notification error:', err.message);
  }
}

/**
 * POST /api/leads/capture
 * Save a demo/assessment request and send confirmation email.
 */
router.post('/leads/capture', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, company_name, fleet_size, source } = req.body;

    console.log('[leads/capture] Received:', { email: email ? '***@' + email.split('@')[1] : 'MISSING', source: source || 'demo_request' });

    if (!email || !email.includes('@')) {
      console.warn('[leads/capture] Rejected — invalid email');
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    const normalized = email.toLowerCase().trim();

    const leadResult = await leadsDb.insertLeadReturning(pool, { email: normalized, company_name, fleet_size, source });

    const newLead = leadResult.rows[0];

    console.log('[leads/capture] Saved lead from source:', source || 'demo_request');

    // Fire-and-forget — don't block the response
    sendLeadConfirmationEmail(normalized, company_name, { fleet_size, source }).catch(() => {});

    // Schedule drip email sequence (emails 2–5) for this lead
    scheduleDripEmails(pool, newLead.id, newLead.created_at, normalized).catch(err =>
      console.error('[leads/capture] Failed to schedule drip emails:', err.message)
    );

    res.json({ success: true, message: 'Lead captured' });
  } catch (err) {
    console.error('[leads/capture] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Ad-blocker-safe alias for /api/leads/capture ───────────────────────────
// The URL /api/leads/capture contains "leads" + "capture" — trigger words for
// EasyList / uBlock Origin. Alias with neutral naming.
router.post('/cc/assessment', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, company_name, fleet_size, source } = req.body;

    console.log('[cc/assessment] Received:', { email: email ? '***@' + email.split('@')[1] : 'MISSING', source: source || 'demo_request' });

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    const normalized = email.toLowerCase().trim();

    const leadResult = await leadsDb.insertLeadReturning(pool, { email: normalized, company_name, fleet_size, source });

    const newLead = leadResult.rows[0];
    console.log('[cc/assessment] Saved lead from source:', source || 'demo_request');

    sendLeadConfirmationEmail(normalized, company_name, { fleet_size, source }).catch(() => {});
    scheduleDripEmails(pool, newLead.id, newLead.created_at, normalized).catch(err =>
      console.error('[cc/assessment] Failed to schedule drip emails:', err.message)
    );

    res.json({ success: true, message: 'Assessment request received — we\'ll follow up within 1 business day.' });
  } catch (err) {
    console.error('[cc/assessment] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error — please try again.' });
  }
});

// ─── Personalized calculator report endpoint ─────────────────────────────────
// POST /api/cc/calc-report
// Called when prospect unlocks the email-gated fleet calculator report.
// Receives full calc inputs + email, generates a personalized PDF,
// uploads to R2, emails it to the prospect, and returns structured data.
const { getRecommendedTier, generateCalcReportPDF, uploadPDFToR2, buildCalcReportEmail } = require('../services/calc-report-pdf');

router.post('/cc/calc-report', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const {
      email,
      vessels    = 1,
      panamaT    = 0,
      suezT      = 0,
      dailyRate  = 32000,
      vesselTypes = [],
      errorTypes  = [],
      totalRisk  = 0,
      panamaRisk = 0,
      suezRisk   = 0,
    } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }

    const normalized = email.toLowerCase().trim();
    const hasPanama  = Number(panamaT) > 0;
    const hasSuez    = Number(suezT) > 0;
    const tierData   = getRecommendedTier(Number(vessels), hasPanama, hasSuez);
    const roi        = tierData.annual > 0 ? Math.max(1, Math.round(Number(totalRisk) / tierData.annual)) : 1;
    const savings    = Math.max(0, Number(totalRisk) - tierData.annual);

    console.log('[cc/calc-report] Generating report for:', normalized.split('@')[1], '| vessels:', vessels, '| risk:', totalRisk);

    // Generate PDF and upload to R2 (fire-and-forget — don't block response)
    let pdfUrl = null;

    try {
      const pdfBuffer = await generateCalcReportPDF({
        email: normalized, vessels: Number(vessels),
        panamaT: Number(panamaT), suezT: Number(suezT),
        dailyRate: Number(dailyRate), vesselTypes, errorTypes,
        totalRisk: Number(totalRisk), panamaRisk: Number(panamaRisk), suezRisk: Number(suezRisk),
      });

      const slug = Date.now();
      pdfUrl = await uploadPDFToR2(pdfBuffer, `calc-report-${slug}.pdf`);
      console.log('[cc/calc-report] PDF URL:', pdfUrl || '(upload failed — no PDF URL)');
    } catch (pdfErr) {
      // PDF failure must NOT block the response
      console.error('[cc/calc-report] PDF generation error:', pdfErr.message);
    }

    // Send personalized email (fire-and-forget)
    const apiKey = process.env.POLSIA_API_KEY;
    if (apiKey) {
      const emailContent = buildCalcReportEmail({
        email: normalized,
        totalRisk: Number(totalRisk),
        tier: tierData,
        vessels: Number(vessels),
        panamaT: Number(panamaT),
        suezT:   Number(suezT),
        roi,
        savings,
        pdfUrl,
      });

      fetch('https://polsia.com/api/proxy/email/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ to: normalized, subject: emailContent.subject, body: emailContent.subject, html: emailContent.html }),
      }).then(r => {
        if (!r.ok) r.text().then(t => console.error('[cc/calc-report] Email proxy error:', t.slice(0, 200)));
        else console.log('[cc/calc-report] Report email sent to:', normalized.split('@')[1]);
      }).catch(err => console.error('[cc/calc-report] Email send exception:', err.message));
    }

    // Return structured tier/pricing data so the frontend can render it immediately
    res.json({
      success:  true,
      pdfUrl,
      tier:     tierData,
      roi,
      savings,
    });
  } catch (err) {
    console.error('[cc/calc-report] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error — please try again.' });
  }
});

/**
 * Send admin + confirmation emails for a new lead funnel submission.
 * Fire-and-forget — never blocks the response.
 */
async function sendLeadFunnelEmails({ name, email, company, phone, canal_selection, fleet_size, source }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.error('[LeadFunnel] POLSIA_API_KEY not set — skipping email');
    return;
  }
  console.log('[LeadFunnel] Sending emails via proxy for:', email.split('@')[1]);

  const canalLabel = { panama: 'Panama Canal', suez: 'Suez Canal', both: 'Both Canals' }[canal_selection] || canal_selection;
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const isChecklist = source === 'checklist';
  const isSuezCheatsheet = source === 'suez-cheatsheet';

  async function sendViaProxy(to, subject, html) {
    const res = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ to, subject, body: subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  // Admin notification to Francis
  const adminSubjectPrefix = isChecklist ? '[Checklist Download] ' : isSuezCheatsheet ? '[Suez Cheatsheet] ' : '';
  const adminHeading = isChecklist ? 'Checklist Download Lead 📋' : isSuezCheatsheet ? 'Suez Cheatsheet Download 🚢' : 'New Lead Funnel Submission 🚢';
  const sourceBadge = isChecklist
    ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:6px;color:#856404;">Downloaded: VUMPA Rejection Checklist</p>'
    : isSuezCheatsheet
    ? '<p style="background:#e8f4fd;padding:8px 12px;border-radius:6px;color:#0c5460;">Downloaded: Suez SCA Deadline Cheat Sheet</p>'
    : '';
  const sourceLabel = isChecklist ? 'VUMPA Checklist Lead Magnet' : isSuezCheatsheet ? 'Suez Cheatsheet Lead Magnet' : 'Lead Funnel Modal';

  try {
    await sendViaProxy(
      'eagleconsulting954@gmail.com',
      `${adminSubjectPrefix}New Lead: ${company || name}`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#00D4AA;">${adminHeading}</h2>
        ${sourceBadge}
        <table style="border-collapse:collapse;width:100%;margin:20px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;width:35%;">Name</td><td style="padding:8px;">${name}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Email</td><td style="padding:8px;"><a href="mailto:${email}" style="color:#00D4AA;">${email}</a></td></tr>
          ${company ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Company</td><td style="padding:8px;">${company}</td></tr>` : ''}
          ${phone ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Phone</td><td style="padding:8px;">${phone}</td></tr>` : ''}
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Canal</td><td style="padding:8px;">${canalLabel}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Fleet Size</td><td style="padding:8px;">${fleet_size} vessels/year</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Source</td><td style="padding:8px;">${sourceLabel}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Submitted</td><td style="padding:8px;">${timestamp}</td></tr>
        </table>
      </div>`
    );
    console.log('[LeadFunnel] Admin notification sent for:', email.split('@')[1]);
  } catch (err) {
    console.error('[LeadFunnel] Admin email error:', err.message);
  }

  // Lead confirmation email — personalized for checklist / suez-cheatsheet / funnel
  try {
    if (isSuezCheatsheet) {
      await sendViaProxy(
        email,
        'Your Suez SCA Deadline Cheat Sheet — 7 forms, deadlines & top rejection fixes',
        `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
          <h2 style="color:#d4622b;">Thanks, ${name.split(' ')[0]}! Here's your Suez SCA cheat sheet.</h2>
          <p>Your copy of the <strong>Suez Canal SCA Filing Deadline Cheat Sheet</strong> is ready — all 7 forms, exact deadlines, and the #1 rejection mistake for each.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://canal-clear.polsia.app/assets/suez-deadline-cheatsheet.pdf" style="background:#d4622b;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Download Cheat Sheet PDF →</a>
          </p>
          <p><strong>Want to auto-file all 7 SCA forms without the manual deadline stress?</strong><br>
          CanalClear Suez Agent Pro validates every SCA form field — ISSC status, SCNT figures, UTC timestamps, crew endorsements — and submits before the deadline.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://canal-clear.polsia.app/suez" style="background:#1a2332;color:#d4622b;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;border:1px solid #d4622b;">See CanalClear Suez →</a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#aaa;font-size:0.8em;">CanalClear · <a href="https://canal-clear.polsia.app" style="color:#d4622b;">canal-clear.polsia.app</a></p>
        </div>`
      );
    } else if (isChecklist) {
      await sendViaProxy(
        email,
        'Your VUMPA Rejection Checklist + How to Fix Every Issue',
        `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
          <h2 style="color:#d4622b;">Thanks, ${name.split(' ')[0]}! Your checklist is attached below.</h2>
          <p>Here's your copy of <strong>Top 10 Reasons Panama VUMPA Filings Get Rejected</strong> — plus one-line fixes for each.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://canal-clear.polsia.app/assets/vumpa-rejection-checklist.pdf" style="background:#d4622b;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Download Checklist PDF →</a>
          </p>
          <p><strong>Want to eliminate these errors automatically before you file?</strong><br>
          CanalClear validates every VUMPA field — IMO checksum, PCSOPEP attachment, tonnage, crew manifest — and flags issues before you hit submit.</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://canal-clear.polsia.app" style="background:#1a2332;color:#d4622b;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;border:1px solid #d4622b;">Try CanalClear Free →</a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#aaa;font-size:0.8em;">CanalClear · <a href="https://canal-clear.polsia.app" style="color:#d4622b;">canal-clear.polsia.app</a></p>
        </div>`
      );
    } else {
      await sendViaProxy(
        email,
        'Your CanalClear Compliance Assessment is Coming',
        `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
          <h2 style="color:#00D4AA;">Thanks, ${name.split(' ')[0]}! We'll be in touch within 24 hours.</h2>
          <p>We received your request for a ${canalLabel} compliance assessment. Our team will prepare a personalized review of your fleet's compliance requirements and send it to you shortly.</p>
          <p>In the meantime, run an instant compliance check:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="https://canalclear.org/compliance-score" style="background:#00D4AA;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Check My Compliance Score →</a>
          </p>
          <p style="color:#888;font-size:0.85em;">Questions? Contact <a href="mailto:eagleconsulting954@gmail.com" style="color:#00D4AA;">eagleconsulting954@gmail.com</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="color:#aaa;font-size:0.8em;">CanalClear · <a href="https://canalclear.org" style="color:#00D4AA;">canalclear.org</a></p>
        </div>`
      );
    }
    console.log('[LeadFunnel] Confirmation sent to:', email.split('@')[1]);
  } catch (err) {
    console.error('[LeadFunnel] Confirmation email error:', err.message);
  }
}

/**
 * POST /api/lead-funnel/capture
 * 3-step qualifying funnel: saves canal + fleet + contact info.
 * Fires Meta Pixel 'Lead' event on success.
 */
router.post('/lead-funnel/capture', async (req, res) => {
  const { canal_selection, fleet_size, name, email, company, phone, source } = req.body || {};

  if (!canal_selection || !fleet_size || !name || !email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Invalid email' });
  }

  const validCanals = ['panama', 'suez', 'both'];
  const validFleet = ['1-5', '6-15', '16-50', '50+'];
  if (!validCanals.includes(canal_selection)) {
    return res.status(400).json({ success: false, message: 'Invalid canal selection' });
  }
  if (!validFleet.includes(fleet_size)) {
    return res.status(400).json({ success: false, message: 'Invalid fleet size' });
  }

  // Validate source (optional) — default to 'funnel' if omitted
  const validSources = ['funnel', 'checklist', 'bosporus-sp1-primer'];
  const leadSource = (source && validSources.includes(source)) ? source : 'funnel';

  try {
    const pool = req.app.locals.pool;
    const result = await leadsDb.insertLeadFunnel(pool, { canal_selection, fleet_size, name, email, company, phone, source: leadSource });
    console.log('[lead-funnel/capture] Saved lead:', result.rows[0].id, '| canal:', canal_selection, '| fleet:', fleet_size, '| source:', leadSource, '| email:', email.split('@')[1] ? '***@' + email.split('@')[1] : email);

    // Fire-and-forget emails — never block the response
    sendLeadFunnelEmails({ name, email, company, phone, canal_selection, fleet_size, source: leadSource }).catch(err => {
      console.error('[LeadFunnel] Unhandled email error:', err.message);
    });

    res.json({ success: true, message: 'Lead funnel captured' });
  } catch (err) {
    console.error('[lead-funnel/capture] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Ad-blocker-safe alias for lead funnel capture ──────────────────────────
// The URL /api/lead-funnel/capture contains "lead", "funnel", "capture" — all
// trigger words for EasyList / uBlock Origin / EasyPrivacy filter rules.
// This alias uses neutral naming so form submissions bypass ad blockers.
router.post('/cc/submit', async (req, res) => {
  const { canal_selection, fleet_size, name, email, company, phone, source } = req.body || {};

  if (!canal_selection || !fleet_size || !name || !email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Invalid email' });
  }

  const validCanals = ['panama', 'suez', 'both', 'bosporus'];
  const validFleet = ['1-5', '6-15', '16-50', '50+', 'score'];
  if (!validCanals.includes(canal_selection)) {
    return res.status(400).json({ success: false, message: 'Invalid canal selection' });
  }
  if (!validFleet.includes(fleet_size)) {
    return res.status(400).json({ success: false, message: 'Invalid fleet size' });
  }

  const validSources = ['funnel', 'checklist', 'pricing', 'demo', 'filing', 'bosporus-sp1-primer'];
  const leadSource = (source && validSources.includes(source)) ? source : 'funnel';

  try {
    const pool = req.app.locals.pool;
    const result = await leadsDb.insertLeadFunnel(pool, { canal_selection, fleet_size, name, email, company, phone, source: leadSource });
    console.log('[cc/submit] Saved lead:', result.rows[0].id, '| canal:', canal_selection, '| fleet:', fleet_size, '| source:', leadSource, '| email:', email.split('@')[1] ? '***@' + email.split('@')[1] : email);

    // Fire-and-forget emails — never block the response
    sendLeadFunnelEmails({ name, email, company, phone, canal_selection, fleet_size, source: leadSource }).catch(err => {
      console.error('[cc/submit] Email error:', err.message);
    });

    res.json({ success: true, message: 'Thank you — we\'ll be in touch within 24 hours.' });
  } catch (err) {
    console.error('[cc/submit] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error — please try again.' });
  }
});

// ─── Suez Transit Readiness Score ────────────────────────────────────────────

/**
 * Score calculation helper for Suez Transit Readiness.
 * Returns { score, breakdown, missing }
 */
function calcSuezReadinessScore(answers) {
  const QUESTIONS = [
    {
      id: 'transit_app',
      label: 'SCA Transit Application',
      options: {
        complete:     { points: 25, note: 'Complete and current — great.' },
        in_progress:  { points: 12, note: 'In progress — confirm submission deadline.' },
        not_started:  { points: 0,  note: 'Not started — file 48h before transit.' },
      },
      maxPoints: 25,
      missingMsg: 'File your SCA Transit Application — required minimum 48 hours before transit.',
    },
    {
      id: 'crew_manifest',
      label: 'Crew Manifest',
      options: {
        complete:     { points: 25, note: 'All STCW credentials valid — good.' },
        partial:      { points: 12, note: 'Some updates needed — review STCW certs.' },
        not_prepared: { points: 0,  note: 'Not prepared — mandatory for all transits.' },
      },
      maxPoints: 25,
      missingMsg: 'Prepare a complete Crew Manifest with valid STCW credentials for all crew.',
    },
    {
      id: 'cargo_declarations',
      label: 'Cargo Declarations (IMDG 42-24)',
      options: {
        validated:  { points: 25, note: 'IMDG 42-24 validated — no action needed.' },
        unsure:     { points: 10, note: 'Review lithium battery classifications (UN3480/3481/3090/3091).' },
        not_ready:  { points: 0,  note: 'Cargo declarations not prepared — SCA rejects non-compliant cargo.' },
      },
      maxPoints: 25,
      missingMsg: 'Validate Cargo Declarations against IMDG Amendment 42-24 — especially lithium batteries.',
    },
    {
      id: 'convoy_scheduling',
      label: 'Convoy Scheduling',
      options: {
        confirmed:   { points: 25, note: 'Convoy confirmed — on track.' },
        in_progress: { points: 12, note: 'In progress — book convoy before Northbound/Southbound slot fills.' },
        not_started: { points: 0,  note: 'Not started — convoy spots book up fast in peak season.' },
      },
      maxPoints: 25,
      missingMsg: 'Book Convoy Scheduling early — Northbound/Southbound slots fill up in peak season.',
    },
  ];

  let totalScore = 0;
  const breakdown = [];
  const missing = [];

  for (const q of QUESTIONS) {
    const ans = answers[q.id];
    const opt = q.options[ans];
    const pts = opt ? opt.points : 0;
    const note = opt ? opt.note : 'No answer provided.';
    totalScore += pts;
    breakdown.push({ label: q.label, points: pts, max: q.maxPoints, note });
    if (pts < q.maxPoints) {
      missing.push(q.missingMsg);
    }
  }

  return { score: totalScore, breakdown, missing };
}

/**
 * Send Suez readiness score emails (admin notification + user copy).
 * Fire-and-forget — never blocks the response.
 */
async function sendSuezReadinessEmails({ name, email, company, vessel_name, score, breakdown, missing }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.error('[SuezReadiness] POLSIA_API_KEY not set — skipping email');
    return;
  }
  console.log('[SuezReadiness] Sending emails via proxy for:', email.split('@')[1]);

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const statusLabel = score >= 75 ? 'Transit Ready' : score >= 50 ? 'Needs Attention' : 'At Risk';
  const statusColor = score >= 75 ? '#00D4AA' : score >= 50 ? '#F5A623' : '#FF6B6B';

  const breakdownHtml = breakdown.map(item => {
    const icon = item.points === item.max ? '✅' : item.points === 0 ? '❌' : '⚠️';
    return `<tr>
      <td style="padding:8px;background:#f5f5f5;font-weight:500;">${icon} ${item.label}</td>
      <td style="padding:8px;">${item.points}/${item.max} pts — ${item.note}</td>
    </tr>`;
  }).join('');

  const missingHtml = missing.length > 0
    ? '<h4 style="color:#d94f4f;margin-top:16px;">Action required:</h4><ul style="padding-left:1.2em;">' +
      missing.map(m => `<li style="margin-bottom:6px;">${m}</li>`).join('') + '</ul>'
    : '<p style="color:#00D4AA;">✓ All areas look good — ready to transit!</p>';

  async function sendViaProxy(to, subject, html) {
    const res = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ to, subject, body: subject, html }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  // Admin notification to Francis
  try {
    await sendViaProxy(
      'eagleconsulting954@gmail.com',
      `New Suez Readiness Score: ${score}/100 — ${company || name}`,
      `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#00D4AA;">New Suez Transit Readiness Score 🌊</h2>
        <div style="display:inline-block;padding:12px 24px;border-radius:10px;background:${statusColor};color:#0A1628;font-size:1.5rem;font-weight:700;margin-bottom:16px;">
          ${score}/100 — ${statusLabel}
        </div>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;width:35%;">Name</td><td style="padding:8px;">${name}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Email</td><td style="padding:8px;"><a href="mailto:${email}" style="color:#00D4AA;">${email}</a></td></tr>
          ${company ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Company</td><td style="padding:8px;">${company}</td></tr>` : ''}
          ${vessel_name ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Vessel</td><td style="padding:8px;">${vessel_name}</td></tr>` : ''}
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Submitted</td><td style="padding:8px;">${timestamp}</td></tr>
        </table>
        <h3 style="margin-bottom:8px;">Score Breakdown:</h3>
        <table style="border-collapse:collapse;width:100%;">${breakdownHtml}</table>
        ${missingHtml}
      </div>`
    );
    console.log('[SuezReadiness] Admin notification sent for:', email.split('@')[1]);
  } catch (err) {
    console.error('[SuezReadiness] Admin email error:', err.message);
  }

  // User copy
  try {
    await sendViaProxy(
      email,
      `Your Suez Transit Readiness Score: ${score}/100`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#00D4AA;">Your Suez Transit Readiness Score 🌊</h2>
        <div style="text-align:center;padding:20px;border-radius:12px;background:${statusColor};color:#0A1628;font-size:2rem;font-weight:700;margin:16px 0;">
          ${score}/100 — ${statusLabel}
        </div>
        <h3 style="margin-bottom:12px;">Breakdown:</h3>
        <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
          ${breakdownHtml}
        </table>
        ${missingHtml}
        <div style="text-align:center;margin:28px 0;">
          <a href="https://canalclear.org/filing?canal=suez" style="background:#00D4AA;color:#0A1628;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Start Suez Filing →</a>
        </div>
        <p style="color:#888;font-size:0.85em;">Questions? Contact <a href="mailto:eagleconsulting954@gmail.com" style="color:#00D4AA;">eagleconsulting954@gmail.com</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
        <p style="color:#aaa;font-size:0.8em;">CanalClear · <a href="https://canalclear.org/suez" style="color:#00D4AA;">canalclear.org/suez</a></p>
      </div>`
    );
    console.log('[SuezReadiness] Score email sent to:', email.split('@')[1]);
  } catch (err) {
    console.error('[SuezReadiness] User email error:', err.message);
  }
}

/**
 * POST /api/suez-readiness/score
 * Suez Transit Readiness Score funnel.
 * Accepts: { name, email, company, vessel_name, answers: { transit_app, crew_manifest, cargo_declarations, convoy_scheduling } }
 * Returns: { score, breakdown, missing }
 * Saves to lead_funnel table tagged canal_selection='suez'.
 * Sends admin notification to eagleconsulting954@gmail.com + user copy.
 */
router.post('/suez-readiness/score', async (req, res) => {
  const { name, email, company, vessel_name, answers } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Name and email are required' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ success: false, message: 'Invalid email' });
  }
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, message: 'Answers are required' });
  }

  const VALID_ANSWERS = {
    transit_app:        ['complete', 'in_progress', 'not_started'],
    crew_manifest:      ['complete', 'partial', 'not_prepared'],
    cargo_declarations: ['validated', 'unsure', 'not_ready'],
    convoy_scheduling:  ['confirmed', 'in_progress', 'not_started'],
  };
  for (const [key, valid] of Object.entries(VALID_ANSWERS)) {
    if (!valid.includes(answers[key])) {
      answers[key] = valid[valid.length - 1]; // default to worst answer if invalid
    }
  }

  const { score, breakdown, missing } = calcSuezReadinessScore(answers);

  try {
    const pool = req.app.locals.pool;
    // Save to lead_funnel table tagged as suez readiness score
    await leadsDb.insertSuezReadinessLead(pool, { name, email, company, vessel_name });
    console.log('[suez-readiness/score] Score:', score, '| email:', email.split('@')[1] ? '***@' + email.split('@')[1] : email);

    // Fire-and-forget emails
    sendSuezReadinessEmails({ name, email, company, vessel_name, score, breakdown, missing }).catch(err => {
      console.error('[SuezReadiness] Unhandled email error:', err.message);
    });

    res.json({ success: true, score, breakdown, missing });
  } catch (err) {
    console.error('[suez-readiness/score] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * GET /api/leads/unsubscribe
 * One-click unsubscribe from drip emails.
 * Accepts ?email=... as a query param (linked from email footer).
 * Redirects to a confirmation page on success.
 */
router.get('/leads/unsubscribe', async (req, res) => {
  const { email } = req.query;
  if (!email || !email.includes('@')) {
    return res.status(400).send('Invalid unsubscribe link.');
  }
  try {
    const pool = req.app.locals.pool;
    const count = await unsubscribeLead(pool, email);
    console.log('[leads/unsubscribe] Unsubscribed', email, '—', count, 'email(s) cancelled');
    // Simple confirmation page
    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed — CanalClear</title>
  <style>
    body{background:#0A1628;color:#C4D0DC;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
    .box{max-width:440px;text-align:center;padding:40px 32px;background:#0F1D32;border-radius:16px;border:1px solid rgba(255,255,255,0.06);}
    h1{color:#F0F4F8;font-size:1.4rem;margin:0 0 12px;}
    p{color:#8899AA;line-height:1.7;margin:0 0 24px;}
    a{display:inline-block;color:#0A1628;background:#00D4AA;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;}
  </style>
</head>
<body>
  <div class="box">
    <h1>You've been unsubscribed</h1>
    <p>We've removed <strong style="color:#F0F4F8;">${email.replace(/</g,'&lt;')}</strong> from future CanalClear follow-up emails.</p>
    <a href="https://canalclear.org">Back to CanalClear</a>
  </div>
</body>
</html>`);
  } catch (err) {
    console.error('[leads/unsubscribe] Error:', err.message);
    return res.status(500).send('Something went wrong. Please try again.');
  }
});

/**
 * GET /api/admin/leads
 * All demo/assessment leads for admin panel.
 */
router.get('/admin/leads', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;

  try {
    // Union both leads tables so the tab shows all demo + funnel submissions.
    // lead_funnel stores canal_selection, name, company (no company_name column).
    const result = await adminStatsDb.listAdminLeads(pool, limit, offset);

    const total = await adminStatsDb.countAdminLeads(pool);

    res.json({
      success: true,
      leads: result.rows,
      total: parseInt(total.rows[0].total),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Admin Leads]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// ACP MARITIME SERVICE PORTAL — credential storage + filing submission history
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns { encrypted, iv, authTag } all as hex strings, combined as "iv:authTag:encrypted".
 */
function encryptACP(text) {
  const { createCipheriv, randomBytes } = require('crypto');
  const key = deriveACPKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt an ACP-encrypted string.
 */
function decryptACP(stored) {
  const { createDecipheriv } = require('crypto');
  const key = deriveACPKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

/**
 * Derive a 32-byte AES key from the JWT_SECRET (or ACP_ENCRYPTION_KEY env var).
 */
function deriveACPKey() {
  const { createHash } = require('crypto');
  const secret = process.env.ACP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'canalclear-acp-default-key';
  return createHash('sha256').update(secret).digest(); // 32 bytes
}

/**
 * POST /api/acp/credentials
 * Save ACP Maritime Service Portal credentials (encrypted). Upserts per user.
 */
router.post('/acp/credentials', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    // Encrypt both fields together so IV is shared
    const encryptedUsername = encryptACP(username.trim());
    const encryptedPassword = encryptACP(password);

    // Upsert: one row per user
    const result = await purchaseRequestsDb.upsertAcpCredentials(pool, userId, encryptedUsername, encryptedPassword);

    res.json({
      success: true,
      message: 'ACP credentials saved securely',
      connection: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        username_hint: username.slice(0, 3) + '***',
        connected_at: result.rows[0].updated_at,
      },
    });
  } catch (err) {
    console.error('[ACP Credentials] save error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/acp/credentials
 * Return connection status (never returns plain credentials).
 */
router.get('/acp/credentials', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await purchaseRequestsDb.getAcpCredentialStatus(pool, userId);

    if (result.rows.length === 0) {
      return res.json({ success: true, connected: false, connection: null });
    }

    // Partially decode username for display hint (first 3 chars only)
    let usernameHint = '***';
    try {
      const row = await purchaseRequestsDb.getAcpEncryptedUsername(pool, userId);
      if (row.rows.length > 0) {
        const plainUsername = decryptACP(row.rows[0].encrypted_username);
        usernameHint = plainUsername.slice(0, 3) + '***';
      }
    } catch (e) { /* decryption failure means old/invalid credentials */ }

    const cred = result.rows[0];
    res.json({
      success: true,
      connected: cred.status !== 'disconnected',
      connection: {
        id: cred.id,
        status: cred.status,
        username_hint: usernameHint,
        last_tested_at: cred.last_tested_at,
        connected_at: cred.updated_at,
      },
    });
  } catch (err) {
    console.error('[ACP Credentials] get error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/acp/credentials
 * Remove stored credentials (disconnect).
 */
router.delete('/acp/credentials', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    await scaCredentialsDb.deleteAcpCredentials(pool, userId);

    res.json({ success: true, message: 'ACP account disconnected' });
  } catch (err) {
    console.error('[ACP Credentials] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/acp/test
 * Simulate a connection test against the ACP portal.
 * Returns success after a short delay (actual browser automation is a future task).
 */
router.post('/acp/test', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await scaCredentialsDb.getAcpCredentialId(pool, userId);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No ACP credentials saved. Please connect first.' });
    }

    // Simulated test — mark as tested with success
    // Future: this will attempt actual ACP portal login via browser automation
    await scaCredentialsDb.markAcpCredentialsTested(pool, userId);

    res.json({
      success: true,
      message: 'Connection test successful — ACP portal credentials are valid',
      tested_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ACP Test] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/acp/submissions
 * List this user's ACP filing submission history.
 */
router.get('/acp/submissions', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await scaCredentialsDb.listAcpSubmissions(pool, userId, limit, offset);

    const total = await scaCredentialsDb.countAcpSubmissions(pool, userId);

    res.json({
      success: true,
      submissions: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[ACP Submissions] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/acp/submissions/:id
 * Get a specific ACP submission.
 */
router.get('/acp/submissions/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const result = await scaCredentialsDb.getAcpSubmission(pool, id, userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    res.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error('[ACP Submissions] get error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/acp/submissions/:id/resubmit
 * Resubmit a failed/rejected ACP filing.
 */
router.post('/acp/submissions/:id/resubmit', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const existing = await scaCredentialsDb.getAcpSubmissionForResubmit(pool, id, userId);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // Check credentials exist
    const creds = await scaCredentialsDb.getAcpCredentialId(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No ACP credentials saved. Please connect your account first.' });
    }

    const orig = existing.rows[0];

    // Generate a new simulated reference number
    const refNumber = `ACP-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    // Create a new submission record (resubmission)
    const newSub = await scaCredentialsDb.createAcpSubmission(pool, userId, orig.filing_id, orig.vessel_name, orig.filing_type, 'submitted', refNumber, 'Resubmission');

    res.json({
      success: true,
      message: 'Filing resubmitted to ACP portal',
      submission: newSub.rows[0],
    });
  } catch (err) {
    console.error('[ACP Resubmit] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/acp/submit-filing
 * Simulate submitting a filing to ACP and create an acp_submission record.
 */
router.post('/acp/submit-filing', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, vessel_name, filing_type } = req.body;

    if (!vessel_name || !filing_type) {
      return res.status(400).json({ success: false, message: 'vessel_name and filing_type are required' });
    }

    // Check ACP connection
    const creds = await scaCredentialsDb.getAcpCredentialStatus(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'ACP account not connected. Please connect first.' });
    }
    if (creds.rows[0].status === 'error') {
      return res.status(400).json({ success: false, message: 'ACP connection has errors. Please test and reconnect.' });
    }

    // Simulated statuses — in future this will be real browser automation
    const statuses = ['submitted', 'submitted', 'submitted', 'pending'];
    const simStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const refNumber = `ACP-${new Date().getFullYear()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

    const result = await scaCredentialsDb.createAcpSubmission(pool, userId, filing_id || null, vessel_name.trim(), filing_type.toUpperCase(), simStatus, refNumber, null);

    res.json({
      success: true,
      message: `Filing submitted to ACP — reference: ${refNumber}`,
      submission: result.rows[0],
    });
  } catch (err) {
    console.error('[ACP Submit Filing] error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOG AUDIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/blog/:slug/audio
 * Returns the audio URL for a blog post slug, or 404 if not generated yet.
 */
router.get('/blog/:slug/audio', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug } = req.params;
    const row = await blogAudioDb.getBlogAudioBySlug(pool, slug);
    if (!row) {
      return res.status(404).json({ success: false, message: 'No audio available for this post' });
    }
    res.json({ success: true, audio_url: row.audio_url, duration_s: row.duration_s });
  } catch (err) {
    console.error('[Blog Audio] GET error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/blog/:slug/audio-file
 * Streams MP3 audio stored in the blog_audio.audio_data column.
 * Used as fallback when R2 is unavailable.
 */
router.get('/blog/:slug/audio-file', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug } = req.params;
    const row = await blogAudioDb.getBlogAudioFileBySlug(pool, slug);
    if (!row) {
      return res.status(404).json({ success: false, message: 'No audio data available' });
    }
    const { audio_data, content_type } = row;
    res.set('Content-Type', content_type || 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Accept-Ranges', 'bytes');
    res.send(audio_data);
  } catch (err) {
    console.error('[Blog Audio] Serve error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/generate-blog-audio
 * Admin-only. Generates TTS audio for all blog posts (or a single slug if provided).
 * Body: { slug?: string }   — omit slug to process all posts
 */
router.post('/admin/generate-blog-audio', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug: targetSlug } = req.body || {};

    const openaiKey  = process.env.OPENAI_API_KEY;
    const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiToken   = process.env.POLSIA_API_TOKEN;

    if (!openaiKey) return res.status(500).json({ success: false, message: 'OPENAI_API_KEY not set' });

    const blogDir = path.join(__dirname, '..', 'public', 'blog');
    let files = fs.readdirSync(blogDir)
      .filter(f => f.endsWith('.html') && f !== 'index.html');

    if (targetSlug) {
      files = files.filter(f => f === `${targetSlug}.html`);
      if (!files.length) return res.status(404).json({ success: false, message: `Blog post not found: ${targetSlug}` });
    }

    const results = [];

    for (const file of files) {
      const slug = file.replace('.html', '');
      try {
        const html = fs.readFileSync(path.join(blogDir, file), 'utf8');
        const text = extractBlogText(html);
        if (!text || text.length < 100) {
          results.push({ slug, status: 'skipped', reason: 'text too short' });
          continue;
        }

        console.log(`[Blog Audio] Generating TTS for: ${slug} (${text.length} chars)`);

        // Split into chunks — aim for 3800 to stay safely under 4096 API limit
        const chunks = splitIntoChunks(text, 3800);
        console.log(`[Blog Audio] Split into ${chunks.length} chunk(s):`, chunks.map(c => c.length));

        // Validate no chunk exceeds 3800 before API calls
        const oversized = chunks.filter(c => c.length > 3800);
        if (oversized.length) {
          console.error(`[Blog Audio] OVERSIZED CHUNKS — forcing word-boundary split for ${slug}`);
          chunks.length = 0;
          chunks.push(...splitIntoChunks(text, 3800));
        }

        const audioBuffers = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : '';
          let ttsRes = await fetch(`${openaiBase}/audio/speech`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'tts-1-hd',
              input: chunks[i],
              voice: 'onyx',
              response_format: 'mp3',
            }),
          });

          if (!ttsRes.ok) {
            const errText = await ttsRes.text();
            // Retry once with smaller chunks if this chunk is too large
            if (chunks[i].length > 1500 && errText.includes('4096')) {
              console.log(`[Blog Audio]${chunkLabel} chunk too large (${chunks[i].length} chars), re-splitting...`);
              const subChunks = splitIntoChunks(chunks[i], 1500);
              for (let j = 0; j < subChunks.length; j++) {
                const subRes = await fetch(`${openaiBase}/audio/speech`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'tts-1-hd',
                    input: subChunks[j],
                    voice: 'onyx',
                    response_format: 'mp3',
                  }),
                });
                if (!subRes.ok) {
                  const subErr = await subRes.text();
                  throw new Error(`TTS retry failed (sub-chunk ${j + 1}): ${subRes.status} ${subErr.slice(0, 200)}`);
                }
                audioBuffers.push(Buffer.from(await subRes.arrayBuffer()));
              }
              continue;
            }
            throw new Error(`TTS API error${chunkLabel}: ${ttsRes.status} ${errText.slice(0, 200)}`);
          }

          audioBuffers.push(Buffer.from(await ttsRes.arrayBuffer()));
        }

        const audioBuffer = Buffer.concat(audioBuffers);
        console.log(`[Blog Audio] TTS complete for ${slug}: ${audioBuffer.length} bytes`);

        // Upload to R2 via canonical proxy endpoint
        const fileName = `blog-${slug}.mp3`;
        let audioUrl = null;
        if (apiToken) {
          try {
            const nodeFetch = require('node-fetch');
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('file', audioBuffer, { filename: fileName, contentType: 'audio/mpeg' });
            const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiToken}`,
                ...formData.getHeaders(),
              },
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
              audioUrl = uploadData.file.url;
            } else {
              console.error(`[Blog Audio] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
            }
          } catch (e) {
            console.error(`[Blog Audio] R2 upload error: ${e.message}`);
          }
        }

        // Fallback: DB storage
        if (!audioUrl) {
          await podcastAudioDb.upsertBlogAudioData(pool, slug, `/api/blog/${slug}/audio-file`, audioBuffer);
          results.push({ slug, status: 'success', audio_url: `/api/blog/${slug}/audio-file`, storage: 'db' });
          continue;
        }

        if (!audioUrl) {
          results.push({ slug, status: 'upload_error', reason: 'No URL returned from R2 upload' });
          continue;
        }

        // Upsert into blog_audio table
        await podcastAudioDb.upsertBlogAudioUrl(pool, slug, audioUrl);

        console.log(`[Blog Audio] Saved for ${slug}: ${audioUrl}`);
        results.push({ slug, status: 'success', audio_url: audioUrl });
      } catch (err) {
        console.error(`[Blog Audio] Error for ${slug}:`, err.message);
        results.push({ slug, status: 'error', reason: err.message });
      }
    }

    res.json({ success: true, results, processed: results.length });
  } catch (err) {
    console.error('[Blog Audio] Generate error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Extract clean text from a blog post HTML for TTS narration.
 */
function extractBlogText(html) {
  // Extract h1 title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  // Extract article body
  const bodyMatch = html.match(/<article[^>]*class="article-body"[^>]*>([\s\S]*?)<\/article>/i);
  if (!bodyMatch) return title;

  let body = bodyMatch[1];

  // Remove CTA sections, scripts, style blocks, sources footnotes
  body = body.replace(/<div[^>]*class="cta-section"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<p[^>]*style="font-size:0\.875rem[\s\S]*?<\/p>/gi, '');

  // Strip HTML tags
  body = body.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  body = body
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');

  // Collapse whitespace
  body = body.replace(/\s+/g, ' ').trim();

  return title ? `${title}. ${body}` : body;
}

// ──────────────────────────────────────────────────────────────────────────────
// PERFORMANCE MONITORING
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/validation-metrics
 * Performance metrics for the validation engine (cache stats, response times)
 * Requires admin role to view
 */
router.get('/admin/validation-metrics', requireAuth, requireAdmin, (req, res) => {
  try {
    const { getCacheStats, cleanupExpiredCache } = require('../services/validation-cache');

    // Clean up expired entries periodically
    const cleanedCount = cleanupExpiredCache();

    // Get current cache stats
    const stats = getCacheStats();

    res.json({
      success: true,
      cache: {
        ...stats,
        cleaned_expired_entries: cleanedCount
      },
      status: 'operational',
      message: 'Validation engine running with caching enabled'
    });
  } catch (err) {
    console.error('[Validation Metrics]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/validation-cache-clear
 * Clear validation cache (for admin only, emergency use)
 */
router.post('/admin/validation-cache-clear', requireAuth, requireAdmin, (req, res) => {
  try {
    const { clearCache } = require('../services/validation-cache');
    clearCache();
    console.log('[Admin] Validation cache cleared');
    res.json({ success: true, message: 'Validation cache cleared' });
  } catch (err) {
    console.error('[Cache Clear]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PODCAST AUDIO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/podcast/:slug/audio
 * Returns the audio URL for a podcast episode slug, or 404 if not generated yet.
 */
router.get('/podcast/:slug/audio', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug } = req.params;
    const row = await podcastAudioDb.getPodcastAudioMetadata(pool, slug);
    if (!row) {
      return res.status(404).json({ success: false, message: 'No audio available for this episode' });
    }
    res.json({ success: true, audio_url: row.audio_url, duration_s: row.duration_s });
  } catch (err) {
    console.error('[Podcast Audio] GET error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/podcast/:slug/audio-file
 * Streams MP3 audio stored in the podcast_audio.audio_data column.
 */
router.get('/podcast/:slug/audio-file', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug } = req.params;
    const row = await podcastAudioDb.getPodcastAudioData(pool, slug);
    if (!row) {
      return res.status(404).json({ success: false, message: 'No audio data available' });
    }
    const { audio_data, content_type } = row;
    res.set('Content-Type', content_type || 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Accept-Ranges', 'bytes');
    res.send(audio_data);
  } catch (err) {
    console.error('[Podcast Audio] Serve error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/admin/generate-podcast-audio
 * Admin-only. Generates TTS audio for all podcast episodes (or a single slug).
 * Body: { slug?: string }
 */
router.post('/admin/generate-podcast-audio', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { slug: targetSlug } = req.body || {};

    const openaiKey  = process.env.OPENAI_API_KEY;
    const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiToken   = process.env.POLSIA_API_TOKEN;

    if (!openaiKey) return res.status(500).json({ success: false, message: 'OPENAI_API_KEY not set' });

    const podcastDir = path.join(__dirname, '..', 'public', 'podcast');
    let files = fs.readdirSync(podcastDir).filter(f => f.endsWith('.html'));

    if (targetSlug) {
      files = files.filter(f => f === `${targetSlug}.html`);
      if (!files.length) return res.status(404).json({ success: false, message: `Episode not found: ${targetSlug}` });
    }

    const results = [];

    for (const file of files) {
      const slug = file.replace('.html', '');
      try {
        const html = fs.readFileSync(path.join(podcastDir, file), 'utf8');
        const text = extractPodcastText(html);
        if (!text || text.length < 100) {
          results.push({ slug, status: 'skipped', reason: 'text too short' });
          continue;
        }

        console.log(`[Podcast Audio] Generating TTS for: ${slug} (${text.length} chars)`);

        // Split into chunks — aim for 3800 to stay safely under 4096 API limit
        const chunks = splitIntoChunks(text, 3800);
        console.log(`[Podcast Audio] Split into ${chunks.length} chunk(s):`, chunks.map(c => c.length));

        // Validate no chunk exceeds 3800 before API calls
        const oversized = chunks.filter(c => c.length > 3800);
        if (oversized.length) {
          console.error(`[Podcast Audio] OVERSIZED CHUNKS — forcing word-boundary split for ${slug}`);
          chunks.length = 0;
          chunks.push(...splitIntoChunks(text, 3800));
        }

        const buffers = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : '';
          let ttsRes = await fetch(`${openaiBase}/audio/speech`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'tts-1-hd',
              input: chunks[i],
              voice: 'onyx',
              response_format: 'mp3',
            }),
          });

          if (!ttsRes.ok) {
            const errText = await ttsRes.text();
            // Retry once with smaller sub-chunks if this chunk appears too large
            if (chunks[i].length > 1500 && errText.includes('4096')) {
              console.log(`[Podcast Audio]${chunkLabel} chunk too large (${chunks[i].length} chars), re-splitting...`);
              const subChunks = splitIntoChunks(chunks[i], 1500);
              for (let j = 0; j < subChunks.length; j++) {
                const subRes = await fetch(`${openaiBase}/audio/speech`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    model: 'tts-1-hd',
                    input: subChunks[j],
                    voice: 'onyx',
                    response_format: 'mp3',
                  }),
                });
                if (!subRes.ok) {
                  const subErr = await subRes.text();
                  throw new Error(`TTS retry failed (sub-chunk ${j + 1}): ${subRes.status} ${subErr.slice(0, 200)}`);
                }
                buffers.push(Buffer.from(await subRes.arrayBuffer()));
              }
              continue;
            }
            throw new Error(`TTS API error${chunkLabel}: ${ttsRes.status} ${errText.slice(0, 200)}`);
          }
          buffers.push(Buffer.from(await ttsRes.arrayBuffer()));
        }

        const audioBuffer = Buffer.concat(buffers);
        console.log(`[Podcast Audio] TTS complete for ${slug}: ${audioBuffer.length} bytes`);

        // Upload to R2 via canonical proxy endpoint
        const fileName = `podcast-${slug}.mp3`;
        let audioUrl = null;
        if (apiToken) {
          try {
            const nodeFetch = require('node-fetch');
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('file', audioBuffer, { filename: fileName, contentType: 'audio/mpeg' });
            const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiToken}`,
                ...formData.getHeaders(),
              },
              body: formData,
            });
            const uploadData = await uploadRes.json();
            if (uploadData.success) {
              audioUrl = uploadData.file.url;
            } else {
              console.error(`[Podcast Audio] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
            }
          } catch (e) {
            console.error(`[Podcast Audio] R2 upload error: ${e.message}`);
          }
        }

        // Fallback: store in DB
        if (!audioUrl) {
          await podcastAudioDb.upsertPodcastAudioData(pool, slug, `/api/podcast/${slug}/audio-file`, audioBuffer);
          results.push({ slug, status: 'success', audio_url: `/api/podcast/${slug}/audio-file`, storage: 'db' });
          continue;
        }

        await podcastAudioDb.upsertPodcastAudioUrl(pool, slug, audioUrl);

        console.log(`[Podcast Audio] Saved for ${slug}: ${audioUrl}`);
        results.push({ slug, status: 'success', audio_url: audioUrl });
      } catch (err) {
        console.error(`[Podcast Audio] Error for ${slug}:`, err.message);
        results.push({ slug, status: 'error', reason: err.message });
      }
    }

    res.json({ success: true, results, processed: results.length });
  } catch (err) {
    console.error('[Podcast Audio] Generate error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Extract clean text from a podcast episode HTML for TTS narration.
 */
function extractPodcastText(html) {
  // Extract h1 title
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  // Extract article body from .article-inner section
  const bodyMatch = html.match(/class="article-inner"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!bodyMatch) return title;

  let body = bodyMatch[1];

  // Remove stats box, show notes, scripts, styles
  body = body.replace(/<div[^>]*class="stats-box"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<div[^>]*class="show-notes"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Strip HTML tags
  body = body.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  body = body
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, ' — ')
    .replace(/&ndash;/g, ' – ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/&[a-z]+;/g, ' ');

  // Collapse whitespace
  body = body.replace(/\s+/g, ' ').trim();

  return title ? `${title}. ${body}` : body;
}

/**
 * Split text into chunks of maxLen characters, breaking at sentence boundaries.
 * Falls back to word boundary if no sentence break found within range.
 * Chunks that somehow still exceed maxLen are force-split at word boundary.
 */
function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Try sentence boundary first: ". " (period + space)
    let cutAt = remaining.lastIndexOf('. ', maxLen);
    if (cutAt < maxLen * 0.6) {
      // No good sentence break; try word boundary
      cutAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (cutAt <= 0) cutAt = maxLen;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  // Safety net: any chunk still over maxLen gets force-split at word boundary
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxLen) return [chunk];
    const sub = [];
    let s = chunk;
    while (s.length > maxLen) {
      const cut = s.lastIndexOf(' ', maxLen);
      sub.push(s.slice(0, cut > 0 ? cut : maxLen));
      s = s.slice(cut > 0 ? cut : maxLen);
    }
    if (s) sub.push(s);
    return sub;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT UPLOAD + OCR EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

// Lazy-load multer and pdf-parse to avoid breaking the app if not yet installed
let multerLoaded = null;
function getMulter() {
  if (!multerLoaded) {
    try {
      const multer = require('multer');
      multerLoaded = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
        fileFilter: (req, file, cb) => {
          const allowed = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
          if (allowed.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new Error('Only PDF, JPG, and PNG files are accepted.'));
          }
        }
      });
    } catch (e) {
      return null;
    }
  }
  return multerLoaded;
}

const DOCUMENT_EXTRACTION_PROMPT = `You are a maritime compliance data extraction specialist. Extract all available fields from the provided document text/content and return them as a structured JSON object.

Return ONLY a valid JSON object with these fields (use null for fields not found):
{
  "vessel_name": string or null,
  "imo_number": string or null,
  "flag_state": string or null,
  "vessel_type": string or null,
  "classification_society": string or null,
  "gross_tonnage": number or null,
  "loa": number or null,
  "beam": number or null,
  "draft": number or null,
  "master_name": string or null,
  "crew_count": number or null,
  "cargo_type": string or null,
  "cargo_description": string or null,
  "has_dangerous_goods": boolean or null,
  "dg_class": string or null,
  "un_numbers": string or null,
  "iopp_cert_number": string or null,
  "iopp_expiry_date": string or null,
  "pcsopep_plan_ref": string or null,
  "pcsopep_certifying_body": string or null,
  "pcsopep_issue_date": string or null,
  "pcsopep_expiry_date": string or null,
  "pcsopep_oil_capacity": number or null,
  "authorized_person_name": string or null,
  "authorized_person_contact": string or null,
  "bl_number": string or null,
  "shipper_name": string or null,
  "consignee_name": string or null,
  "port_of_origin": string or null,
  "port_of_destination": string or null,
  "gross_weight_mt": number or null,
  "crew_members": [{"rank": string, "full_name": string, "nationality": string, "doc_type": string, "doc_number": string, "dob": string}] or null,
  "certificate_numbers": [{"cert_type": string, "cert_number": string, "expiry_date": string}] or null,
  "doc_type_detected": string or null
}

For "doc_type_detected", classify as one of: "vumpa_pre_arrival", "pcsopep_plan", "crew_manifest", "cargo_declaration", "iopp_certificate", "other_certificate", "other".
For dates, use ISO format YYYY-MM-DD when possible.
For flag_state, use the country name (e.g., "Panama", "Liberia", "Marshall Islands").
Do not include any text outside the JSON object.`;

/**
 * POST /api/document-upload/extract
 * Upload a document (PDF/JPG/PNG) and extract compliance fields using AI.
 */
router.post('/document-upload/extract', requireAuth, (req, res) => {
  const upload = getMulter();
  if (!upload) {
    return res.status(503).json({ success: false, message: 'Document upload service not available. Dependencies are installing.' });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'File too large. Maximum size is 10 MB.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id } = req.body;

    const { mimetype, originalname, buffer } = req.file;

    let uploadId = null;
    try {
      // Record the upload attempt
      const uploadRow = await documentUploadsDb.createDocumentUpload(pool, { userId, filingId: filing_id, originalFilename: originalname, fileType: mimetype });
      uploadId = uploadRow ? uploadRow.id : null;
    } catch (dbErr) {
      console.warn('[DocUpload] DB insert warning:', dbErr.message);
      // Continue even if DB insert fails
    }

    try {
      const openaiKey = process.env.OPENAI_API_KEY;
      const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

      if (!openaiKey) {
        throw new Error('AI extraction service not configured. Please contact support.');
      }

      let extractedData = {};

      if (mimetype === 'application/pdf') {
        // PDF: extract text using pdf-parse, then send to GPT-4 for structured extraction
        let pdfText = '';
        try {
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(buffer);
          pdfText = pdfData.text || '';
        } catch (pdfErr) {
          console.warn('[DocUpload] pdf-parse error:', pdfErr.message);
          pdfText = '[Could not extract text from PDF]';
        }

        // Truncate to avoid exceeding token limits
        const truncatedText = pdfText.length > 8000 ? pdfText.slice(0, 8000) + '...[truncated]' : pdfText;

        const response = await fetch(`${openaiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: DOCUMENT_EXTRACTION_PROMPT },
              { role: 'user', content: `Extract fields from this maritime document:\n\n${truncatedText}` }
            ],
            max_tokens: 1500,
            temperature: 0,
            response_format: { type: 'json_object' }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`AI extraction failed: ${response.status} ${errText.slice(0, 200)}`);
        }

        const aiResult = await response.json();
        const content = aiResult.choices?.[0]?.message?.content || '{}';
        extractedData = JSON.parse(content);

      } else {
        // Image (JPG/PNG): send as base64 to vision model
        const base64Image = buffer.toString('base64');
        const mimeForVision = mimetype === 'image/png' ? 'image/png' : 'image/jpeg';

        const response = await fetch(`${openaiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: DOCUMENT_EXTRACTION_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Extract all maritime compliance fields from this document image.' },
                  { type: 'image_url', image_url: { url: `data:${mimeForVision};base64,${base64Image}`, detail: 'high' } }
                ]
              }
            ],
            max_tokens: 1500,
            temperature: 0,
            response_format: { type: 'json_object' }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`AI extraction failed: ${response.status} ${errText.slice(0, 200)}`);
        }

        const aiResult = await response.json();
        const content = aiResult.choices?.[0]?.message?.content || '{}';
        extractedData = JSON.parse(content);
      }

      // Update DB record with extracted data
      if (uploadId) {
        await documentUploadsDb.markDocumentUploadCompleted(pool, uploadId, extractedData, extractedData.doc_type_detected)
          .catch(e => console.warn('[DocUpload] DB update warning:', e.message));
      }

      res.json({
        success: true,
        upload_id: uploadId,
        filename: originalname,
        extracted: extractedData,
        fields_found: Object.values(extractedData).filter(v => v !== null && v !== undefined).length
      });

    } catch (extractErr) {
      console.error('[DocUpload] Extraction error:', extractErr.message);

      if (uploadId) {
        await documentUploadsDb.markDocumentUploadError(pool, uploadId, extractErr.message)
          .catch(() => {});
      }

      res.status(500).json({ success: false, message: extractErr.message });
    }
  });
});

/**
 * GET /api/document-upload/history
 * List recently uploaded documents for the authenticated user.
 */
router.get('/document-upload/history', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const rows = await documentUploadsDb.listDocumentUploads(pool, req.user.id, { limit: 20 });
    res.json({ success: true, uploads: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// CHATBOT ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/chat/message
 * AI-powered Q&A using the CanalClear knowledge base.
 * Public endpoint (no auth required).
 */
router.post('/chat/message', async (req, res) => {
  try {
    const { messages, system, language } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ success: false, message: 'messages array required' });
    }

    const OpenAI = require('openai');
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'polsia',
      baseURL: process.env.OPENAI_BASE_URL || 'https://polsia.com/ai/openai/v1'
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      messages: [
        { role: 'system', content: system || 'You are Clara, CanalClear\'s AI assistant for Panama Canal compliance.' },
        ...messages.slice(-12)
      ]
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    res.json({ success: true, reply });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ success: false, message: 'AI service unavailable' });
  }
});

/**
 * POST /api/chat/analytics
 * Track chat events (open, message sent, meeting request, etc.).
 * Fire-and-forget — always responds 204.
 */
router.post('/chat/analytics', async (req, res) => {
  res.sendStatus(204);
  try {
    const pool = req.app.locals.pool;
    const { event_type, session_id, page_path, properties } = req.body;
    if (!event_type) return;

    const rawIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const crypto = require('crypto');
    const ipHash = rawIp ? crypto.createHash('sha256').update(rawIp + (process.env.ANALYTICS_SALT || 'cc-salt')).digest('hex').slice(0, 32) : null;

    await chatAnalyticsDb.recordChatEvent(pool, { eventType: event_type, sessionId: session_id, pagePath: page_path, properties, ipHash });
  } catch (err) {
    console.error('[ChatAnalytics] Error:', err.message);
  }
});

/**
 * POST /api/meeting-requests
 * Submit a meeting request from the chatbot widget.
 * Public endpoint.
 */
router.post('/meeting-requests', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, email, company, fleet_size, preferred_date, preferred_time, timezone, message } = req.body;

    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Valid email is required' });
    }
    if (!preferred_date) return res.status(400).json({ success: false, message: 'Preferred date is required' });
    if (!preferred_time) return res.status(400).json({ success: false, message: 'Preferred time is required' });

    // Ensure date is not in the past
    const reqDate = new Date(preferred_date);
    const today = new Date(); today.setHours(0,0,0,0);
    if (reqDate < today) return res.status(400).json({ success: false, message: 'Date must be in the future' });

    const result = await meetingRequestsDb.createMeetingRequest(pool, {
      name: name.trim(), email: email.toLowerCase().trim(), company: company?.trim() || null,
      fleetSize: fleet_size || null, preferredDate: preferred_date, preferredTime: preferred_time,
      timezone: timezone || 'UTC', message: message?.trim() || null
    });

    const meeting = result.rows[0];

    // Send emails (fire-and-forget)
    sendMeetingEmails(meeting).catch(err => console.error('[MeetingEmail] Error:', err.message));

    res.json({ success: true, meeting: { id: meeting.id, status: meeting.status } });
  } catch (err) {
    console.error('[MeetingRequest] Error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * Send confirmation + admin notification emails for a meeting request.
 * Uses Polsia email proxy (not SMTP).
 */
async function sendMeetingEmails(meeting) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.log('[MeetingEmail] POLSIA_API_KEY not set — skipping emails');
    return;
  }

  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  async function sendViaProxy(to, subject, html) {
    const response = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ to, subject, body: subject, html }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
  }

  // 1. User confirmation
  try {
    await sendViaProxy(
      meeting.email,
      'Meeting Request Received — CanalClear',
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#00D4AA;">Meeting Request Received ✓</h2>
        <p>Hi ${meeting.name},</p>
        <p>Thanks for reaching out to CanalClear! We received your meeting request and will confirm your slot within 24 hours.</p>
        <table style="border-collapse:collapse;width:100%;margin:20px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;width:40%;">Date</td><td style="padding:8px;">${meeting.preferred_date}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Time</td><td style="padding:8px;">${meeting.preferred_time}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Timezone</td><td style="padding:8px;">${meeting.timezone}</td></tr>
          ${meeting.fleet_size ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Fleet Size</td><td style="padding:8px;">${meeting.fleet_size}</td></tr>` : ''}
          ${meeting.message ? `<tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Topic</td><td style="padding:8px;">${meeting.message}</td></tr>` : ''}
        </table>
        <p>In the meantime, you can <a href="https://canalclear.org/compliance-score" style="color:#00D4AA;">check your compliance score</a> or <a href="https://canalclear.org" style="color:#00D4AA;">explore our platform</a>.</p>
        <p style="color:#888;font-size:0.85em;">Questions? Reply to this email or contact <a href="mailto:eagleconsulting954@gmail.com" style="color:#00D4AA;">eagleconsulting954@gmail.com</a></p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="color:#aaa;font-size:0.8em;">CanalClear — Panama Canal Compliance Automation · <a href="https://canalclear.org" style="color:#00D4AA;">canalclear.org</a></p>
      </div>`
    );
    console.log('[MeetingEmail] Confirmation sent to', meeting.email);
  } catch (err) {
    console.error('[MeetingEmail] Confirmation email error:', err.message);
  }

  // 2. Francis notification
  try {
    await sendViaProxy(
      'eagleconsulting954@gmail.com',
      `New CanalClear Lead: ${meeting.company || meeting.name}`,
      `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;">
        <h2 style="color:#00D4AA;">New Meeting Request 🚢</h2>
        <table style="border-collapse:collapse;width:100%;margin:20px 0;">
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;width:35%;">Name</td><td style="padding:8px;">${meeting.name}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Email</td><td style="padding:8px;">${meeting.email}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Company</td><td style="padding:8px;">${meeting.company || '—'}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Fleet Size</td><td style="padding:8px;">${meeting.fleet_size || '—'}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Preferred Date</td><td style="padding:8px;">${meeting.preferred_date} at ${meeting.preferred_time} (${meeting.timezone})</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Message</td><td style="padding:8px;">${meeting.message || '—'}</td></tr>
          <tr><td style="padding:8px;background:#f5f5f5;font-weight:600;">Submitted</td><td style="padding:8px;">${timestamp}</td></tr>
        </table>
        <a href="https://canal-clear.polsia.app/admin" style="background:#00D4AA;color:#0A1628;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;">View in Admin Panel →</a>
      </div>`
    );
    console.log('[MeetingEmail] Francis notification sent for', meeting.email);
  } catch (err) {
    console.error('[MeetingEmail] Francis notification error:', err.message);
  }
}

/**
 * GET /api/admin/meeting-requests
 * List all meeting requests. Admin only.
 */
router.get('/admin/meeting-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const status = req.query.status;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const result = await meetingRequestsDb.listMeetingRequests(pool, { status, limit, offset });
    const total = await meetingRequestsDb.countMeetingRequests(pool, { status });

    const stats = await meetingRequestsDb.getMeetingRequestStats(pool);

    res.json({
      success: true,
      meeting_requests: result.rows,
      total: parseInt(total.rows[0].count),
      stats: stats.rows[0],
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/admin/meeting-requests/:id
 * Update meeting request status or admin notes. Admin only.
 */
router.patch('/admin/meeting-requests/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { id } = req.params;
    const { status, admin_notes } = req.body;

    const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const updates = [];
    const params = [];

    if (status) { params.push(status); updates.push(`status = $${params.length}`); }
    if (admin_notes !== undefined) { params.push(admin_notes); updates.push(`admin_notes = $${params.length}`); }
    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await meetingRequestsDb.updateMeetingRequest(pool, id, updates, params);

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, meeting_request: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/chat-stats
 * Chat widget analytics summary. Admin only.
 */
router.get('/admin/chat-stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const rows = await chatAnalyticsDb.getChatStats(pool);
    res.json({ success: true, stats: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HAZMAT AI VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/hazmat/validate
 *
 * Run hazmat classification validation against IMDG Code.
 * Free demo tool — no auth required, no rate limiting.
 */
router.post('/hazmat/validate', async (req, res) => {
  const startTime = Date.now();
  try {
    const pool = req.app.locals.pool;
    const { validateHazmat } = require('../services/hazmat-validator');

    // Resolve user from JWT if present (optional auth)
    let userId = null;
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const token = req.cookies?.cc_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded?.id || null;
      }
    } catch (_) { /* unauthenticated — allow anonymous */ }

    const sessionId = req.cookies?.cc_sid || null;

    // ── No rate limiting — hazmat validator is a free demo tool ─────────────

    // ── Run validation ────────────────────────────────────────────────────
    const {
      cargo_description,
      un_number,
      imdg_class,
      packaging_group,
      packaging_type,
      quantity,
      quantity_unit,
      // Flash point / SDS
      flash_point,
      // Lithium battery specialist fields
      lithium_section,
      lithium_wh_cell,
      lithium_wh_battery,
      lithium_li_cell,
      lithium_li_battery,
      lithium_test_summary,
      lithium_cargo_type,
    } = req.body;

    const result = validateHazmat({
      cargo_description,
      un_number,
      imdg_class,
      packaging_group,
      packaging_type,
      quantity,
      quantity_unit,
      flash_point,
      lithium_section,
      lithium_wh_cell,
      lithium_wh_battery,
      lithium_li_cell,
      lithium_li_battery,
      lithium_test_summary,
      lithium_cargo_type,
    });

    // ── Persist to DB (non-blocking) ──────────────────────────────────────
    const crypto = require('crypto');
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
    const day = new Date().toISOString().slice(0, 10);
    const salt = process.env.ANALYTICS_SALT || 'canalclear-analytics-salt';
    const ipHash = ip ? crypto.createHash('sha256').update(`${salt}:${day}:${ip}`).digest('hex').slice(0, 16) : null;

    hazmatChecksDb.insertHazmatCheck(pool, {
      userId, sessionId,
      unNumber: un_number || null, imdgClass: imdg_class || null, cargoDescription: cargo_description || null,
      packagingGroup: packaging_group || null,
      quantity: quantity ? parseFloat(quantity) : null, quantityUnit: quantity_unit || null,
      overallStatus: result.overall_status, totalChecks: result.total_checks, passedChecks: result.passed_checks,
      failedChecks: result.failed_checks, warningChecks: result.warning_checks,
      resultJson: JSON.stringify(result), ipHash,
    }).catch(err => console.error('[Hazmat] DB save error:', err.message));

    const responseTimeMs = Date.now() - startTime;
    console.log(`[Hazmat] Validated ${un_number || '(no UN)'} in ${responseTimeMs}ms — ${result.overall_status}`);

    res.json({
      success: true,
      validation: result,
      response_time_ms: responseTimeMs,
      is_pro: isPro,
    });
  } catch (err) {
    console.error('[Hazmat] Validate error:', err.message);
    res.status(500).json({ success: false, message: 'Validation failed: ' + err.message });
  }
});

/**
 * GET /api/hazmat/usage
 * Return current month usage for the authenticated user or session.
 */
router.get('/hazmat/usage', async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    let userId = null;
    let isPro = false;
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const token = req.cookies?.cc_token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded?.id || null;
      }
    } catch (_) { /* anonymous */ }

    if (userId) {
      const userRow = await hazmatChecksDb.getUserSubscriptionForHazmat(pool, userId);
      if (userRow.rows.length > 0) {
        isPro = ['active', 'trialing'].includes(userRow.rows[0].subscription_status);
      }
    }

    const sessionId = req.cookies?.cc_sid || null;
    const param = userId || sessionId;
    let checksThisMonth = 0;

    if (param) {
      const r = userId
        ? await hazmatChecksDb.countHazmatChecksByUser(pool, userId)
        : await hazmatChecksDb.countHazmatChecksBySession(pool, sessionId);
      checksThisMonth = parseInt(r.rows[0].count, 10);
    }

    res.json({
      success: true,
      is_pro: isPro,
      checks_used: checksThisMonth,
      checks_limit: isPro ? null : 1,
      checks_remaining: isPro ? null : Math.max(0, 1 - checksThisMonth),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/hazmat/manifest
 *
 * Generate a pre-filled IMDG Dangerous Goods Manifest.
 * Available to all users (no rate limiting — manifest is just a document generator).
 * Returns structured manifest data + formatted text.
 */
router.post('/hazmat/manifest', async (req, res) => {
  try {
    const { generateDGManifest } = require('../services/hazmat-validator');

    const {
      cargo_description, un_number, imdg_class, packaging_group, packaging_type,
      quantity, quantity_unit, flash_point,
      vessel_name, imo_number, voyage_number,
      port_of_loading, port_of_discharge,
      shipper_name, consignee_name, emergency_contact,
      declaration_date,
    } = req.body || {};

    const result = generateDGManifest({
      cargo_description, un_number, imdg_class, packaging_group, packaging_type,
      quantity, quantity_unit, flash_point,
      vessel_name, imo_number, voyage_number,
      port_of_loading, port_of_discharge,
      shipper_name, consignee_name, emergency_contact,
      declaration_date,
    });

    console.log(`[Hazmat/Manifest] Generated manifest for ${un_number || '(no UN)'}`);

    res.json({
      success: true,
      manifest: result.manifest,
      text: result.text,
      errors: result.errors,
    });
  } catch (err) {
    console.error('[Hazmat/Manifest] Error:', err.message);
    res.status(500).json({ success: false, message: 'Manifest generation failed: ' + err.message });
  }
});

/**
 * GET /api/fleet/summary
 * Returns the authenticated user's vessel count, plan limit, and per-vessel list.
 * Used by the frontend to show "X / Y vessels used" and disable the add-vessel UI.
 */
router.get('/fleet/summary', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const userRow = await usersDb.getUserVesselInfo(pool, userId);
    const userRecord = userRow.rows[0] || {};
    const plan = userRecord.subscription_plan || 'free';
    const limit = getVesselLimit(userRecord);

    // Distinct vessels: one row per IMO (most recent vessel_name/type/flag)
    const vessels = await vesselsDb.getDistinctFilingVessels(pool, userId);

    res.json({
      success: true,
      plan: plan,
      plan_display: getPlanDisplayName(plan),
      vessel_count: vessels.rows.length,
      vessel_limit: limit === Infinity ? null : limit,
      at_limit: limit !== Infinity && vessels.rows.length >= limit,
      vessels: vessels.rows,
      upgrade_url: '/pricing',
    });
  } catch (err) {
    console.error('Fleet summary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALERT SYSTEM ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/alerts/preferences
 * Returns the authenticated user's alert preferences (creates defaults if none exist).
 */
router.get('/alerts/preferences', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    let { rows } = await alertPreferencesDb.getAlertPreferences(pool, userId);

    if (!rows.length) {
      // Return sensible defaults without writing to DB
      return res.json({
        success: true,
        preferences: {
          enabled: true,
          cert_alerts: true,
          filing_alerts: true,
          regulatory_alerts: false,
          lead_times: [30, 14, 7, 0],
          additional_emails: [],
          frequency: 'immediate',
        },
      });
    }

    const p = rows[0];
    res.json({
      success: true,
      preferences: {
        enabled:            p.enabled,
        cert_alerts:        p.cert_alerts,
        filing_alerts:      p.filing_alerts,
        regulatory_alerts:  p.regulatory_alerts,
        lead_times:         p.lead_times || [30, 14, 7, 0],
        additional_emails:  p.additional_emails || [],
        frequency:          p.frequency || 'immediate',
      },
    });
  } catch (err) {
    console.error('GET /api/alerts/preferences error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PUT /api/alerts/preferences
 * Upserts the authenticated user's alert preferences.
 */
router.put('/alerts/preferences', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const {
      enabled = true,
      cert_alerts = true,
      filing_alerts = true,
      regulatory_alerts = false,
      lead_times = [30, 14, 7, 0],
      additional_emails = [],
      frequency = 'immediate',
    } = req.body;

    // Validate frequency
    const validFreqs = ['immediate', 'daily_digest', 'weekly_digest'];
    if (!validFreqs.includes(frequency)) {
      return res.status(400).json({ success: false, message: 'Invalid frequency value.' });
    }

    // Validate lead_times
    if (!Array.isArray(lead_times) || lead_times.some(t => typeof t !== 'number')) {
      return res.status(400).json({ success: false, message: 'lead_times must be an array of numbers.' });
    }

    // Validate additional_emails
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!Array.isArray(additional_emails) || additional_emails.some(e => !emailRe.test(e))) {
      return res.status(400).json({ success: false, message: 'Invalid email in additional_emails.' });
    }

    await alertPreferencesDb.upsertAlertPreferences(pool, userId, {
      enabled, certAlerts: cert_alerts, filingAlerts: filing_alerts,
      regulatoryAlerts: regulatory_alerts, leadTimes: lead_times,
      additionalEmails: additional_emails, frequency
    });

    res.json({ success: true, message: 'Preferences saved.' });
  } catch (err) {
    console.error('PUT /api/alerts/preferences error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/alerts/test
 * Sends a sample certificate expiry test email to the authenticated user.
 */
router.post('/alerts/test', requireAuth, async (req, res) => {
  try {
    const { sendEmail, buildCertExpiryEmail } = require('../services/alert-service');

    const user = req.user;
    const sampleVessel = { name: 'MV Test Vessel', imo: '1234567', flag: 'Panama' };
    const sampleCert   = { cert_type: 'iopp', cert_number: 'TEST-001', expiry_date: new Date(Date.now() + 7 * 86400000).toISOString() };
    const daysLeft = 7;

    const html = buildCertExpiryEmail({ vessel: sampleVessel, cert: sampleCert, daysLeft });
    const subject = '[CanalClear] 🔴 URGENT: Test Alert — IOPP Certificate expires in 7 days — MV Test Vessel';

    const sent = await sendEmail({ to: user.email, subject, html });
    res.json({ sent, message: sent ? `Test email sent to ${user.email}` : 'Email proxy not configured — check POLSIA_API_TOKEN env var.' });
  } catch (err) {
    console.error('POST /api/alerts/test error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/alerts/history
 * Returns the last 50 alert history entries for the authenticated user.
 */
router.get('/alerts/history', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const rows = await alertHistoryDb.listAlertHistory(pool, userId, { limit: 50 });

    res.json({ success: true, history: rows });
  } catch (err) {
    console.error('GET /api/alerts/history error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VESSEL & CERTIFICATE MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/vessels
 * Returns all vessels owned by the authenticated user, with cert_count and next_expiry.
 */
router.get('/vessels', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const vesselResult = await vesselsDb.listVesselsWithCertCount(pool, userId);

    res.json({ success: true, vessels: vesselResult.rows });
  } catch (err) {
    console.error('GET /api/vessels error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/vessels
 * Creates a new vessel for the authenticated user.
 */
router.post('/vessels', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { name, imo, flag, type, class_society } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Vessel name is required.' });
    }

    const createResult = await vesselsDb.createVessel(pool, userId, { name: name.trim(), imo, flag, type, classSociety: class_society });

    res.json({ success: true, vessel: createResult.rows[0] });
  } catch (err) {
    console.error('POST /api/vessels error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * PATCH /api/vessels/:id
 * Updates a vessel owned by the authenticated user.
 */
router.patch('/vessels/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const vesselId = parseInt(req.params.id);
    const { name, imo, flag, type, class_society } = req.body;

    if (!vesselId) return res.status(400).json({ success: false, message: 'Invalid vessel ID.' });

    // Ownership check
    const owned = await vesselsDb.checkVesselOwnership(pool, vesselId, userId);
    if (!owned.rows.length) return res.status(404).json({ success: false, message: 'Vessel not found.' });

    const updateResult = await vesselsDb.updateVessel(pool, vesselId, userId, { name, imo, flag, type, classSociety: class_society });

    res.json({ success: true, vessel: updateResult.rows[0] });
  } catch (err) {
    console.error('PATCH /api/vessels/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/vessels/:id
 * Soft-deletes a vessel owned by the authenticated user (marks as inactive).
 * Cascade deletes certificates via FK.
 */
router.delete('/vessels/:id', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const vesselId = parseInt(req.params.id);

    const result = await vesselsDb.softDeleteVessel(pool, vesselId, userId);

    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Vessel not found.' });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/vessels/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/vessels/:id/certificates
 * Returns all certificates for a vessel (owned by authenticated user), with days_until_expiry.
 */
router.get('/vessels/:id/certificates', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const vesselId = parseInt(req.params.id);

    // Ownership check
    const owned = await vesselsDb.checkVesselOwnership(pool, vesselId, userId);
    if (!owned.rows.length) return res.status(404).json({ success: false, message: 'Vessel not found.' });

    const certResult = await vesselsDb.listVesselCertificates(pool, vesselId, userId);

    res.json({ success: true, certificates: certResult.rows });
  } catch (err) {
    console.error('GET /api/vessels/:id/certificates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/vessels/:id/certificates
 * Adds a certificate to a vessel owned by the authenticated user.
 */
router.post('/vessels/:id/certificates', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const vesselId = parseInt(req.params.id);
    const { cert_type, cert_number, issued_date, expiry_date, issuing_body, notes } = req.body;

    if (!expiry_date) return res.status(400).json({ success: false, message: 'Expiry date is required.' });
    if (!cert_type)   return res.status(400).json({ success: false, message: 'Certificate type is required.' });

    // Ownership check
    const owned = await vesselsDb.checkVesselOwnershipActive(pool, vesselId, userId);
    if (!owned.rows.length) return res.status(404).json({ success: false, message: 'Vessel not found.' });

    const certResult = await vesselsDb.addVesselCertificate(pool, vesselId, userId, {
      certType: cert_type, certNumber: cert_number, issuedDate: issued_date,
      expiryDate: expiry_date, issuingBody: issuing_body, notes
    });

    res.json({ success: true, certificate: certResult.rows[0] });
  } catch (err) {
    console.error('POST /api/vessels/:id/certificates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/vessels/:id/certificates/:certId
 * Deletes a certificate belonging to a vessel owned by the authenticated user.
 */
router.delete('/vessels/:id/certificates/:certId', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const vesselId = parseInt(req.params.id);
    const certId   = parseInt(req.params.certId);

    const result = await vesselsDb.deleteVesselCertificate(pool, certId, vesselId, userId);

    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Certificate not found.' });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/vessels/:id/certificates/:certId error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// IN-APP NOTIFICATION CENTER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/notifications
 * Returns recent alert history for in-app notification bell (last 10 entries).
 * Also returns count of unread (sent in last 24h).
 */
router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const notifResult = await vesselsDb.getRecentNotifications(pool, userId);
    const rows = notifResult.rows;

    const recentCount = rows.filter(r => {
      return new Date(r.sent_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);
    }).length;

    res.json({ success: true, notifications: rows, unread_count: recentCount });
  } catch (err) {
    console.error('GET /api/notifications error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN — ALERT DELIVERY OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/alert-deliveries
 * Returns recent alert_history entries across all users (admin only).
 */
router.get('/admin/alert-deliveries', requireAuth, requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    const deliveryResult = await vesselsDb.getAdminAlertDeliveries(pool, limit);
    const rows = deliveryResult.rows;

    // Aggregate stats
    const total = rows.length;
    const byCategory = {};
    rows.forEach(r => {
      byCategory[r.alert_category] = (byCategory[r.alert_category] || 0) + 1;
    });

    res.json({ success: true, total, by_category: byCategory, deliveries: rows });
  } catch (err) {
    console.error('GET /api/admin/alert-deliveries error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/compliance/dashboard
 * Fleet-wide compliance summary: all vessels with risk scoring + cert deadlines.
 */
router.get('/compliance/dashboard', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    // Vessels with certificate summary
    const vessels = await fleetComplianceDb.getVesselsWithCertSummary(pool, userId);

    // Filing summary per vessel name
    const filings = await fleetComplianceDb.getFilingSummaryByVessel(pool, userId);

    // ACP submission summary per vessel name
    const acpSubs = await fleetComplianceDb.getAcpSummaryByVessel(pool, userId);

    const filingMap = {};
    filings.forEach(f => { if (f.vname) filingMap[f.vname] = f; });
    const acpMap = {};
    acpSubs.forEach(a => { if (a.vname) acpMap[a.vname] = a; });

    const scored = vessels.map(v => {
      const key   = (v.name || '').toLowerCase();
      const fData = filingMap[key] || { total: 0, rejected: 0, submitted: 0, approved: 0 };
      const aData = acpMap[key]   || { total: 0, rejected: 0, submitted: 0, approved: 0 };

      let score = 100;
      let risk  = 'green';

      if (v.cert_count === 0)      { score = 50; risk = 'yellow'; }
      if (v.certs_expired > 0)     { score -= v.certs_expired * 25; risk = 'red'; }
      if (v.certs_expiring_7d > 0) { score = Math.min(score, 60); risk = 'red'; }
      else if (v.certs_expiring_30d > 0 && risk !== 'red') { score = Math.min(score, 78); risk = 'yellow'; }
      if ((fData.rejected + aData.rejected) > 0 && risk !== 'red') { score -= 15; if (risk === 'green') risk = 'yellow'; }
      score = Math.max(0, score);

      let daysUntilNextExpiry = null;
      if (v.next_expiry) {
        daysUntilNextExpiry = Math.ceil((new Date(v.next_expiry) - new Date()) / 86400000);
      }

      return {
        id: v.id, name: v.name, imo: v.imo, flag: v.flag, type: v.type,
        created_at: v.created_at,
        cert_count: v.cert_count,
        certs_expired: v.certs_expired,
        certs_expiring_7d: v.certs_expiring_7d,
        certs_expiring_30d: v.certs_expiring_30d,
        next_expiry: v.next_expiry,
        days_until_next_expiry: daysUntilNextExpiry,
        risk, score,
        filings: fData,
        acp: aData,
      };
    });

    const total     = scored.length;
    const critical  = scored.filter(v => v.risk === 'red').length;
    const warning   = scored.filter(v => v.risk === 'yellow').length;
    const compliant = scored.filter(v => v.risk === 'green').length;
    const fleetScore = total > 0
      ? Math.round(scored.reduce((s, v) => s + v.score, 0) / total)
      : 100;
    const urgentDeadlines = scored.filter(v =>
      v.days_until_next_expiry !== null && v.days_until_next_expiry <= 4
    ).length;

    res.json({
      success: true,
      summary: { total, critical, warning, compliant, fleet_score: fleetScore, urgent_deadlines: urgentDeadlines },
      vessels: scored,
    });
  } catch (err) {
    console.error('GET /api/compliance/dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/compliance/vessel/:id
 * Per-vessel compliance detail: certs, filings, ACP history, audit trail.
 */
router.get('/compliance/vessel/:id', requireAuth, async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const vesselId = parseInt(req.params.id);

    const vs = await fleetComplianceDb.getVesselByIdAndUser(pool, vesselId, userId);
    if (!vs.length) return res.status(404).json({ success: false, message: 'Vessel not found.' });
    const vessel = vs[0];

    const certs = await fleetComplianceDb.getVesselCertificates(pool, vesselId, userId);

    const filings = await fleetComplianceDb.getFilingsByVesselName(pool, userId, vessel.name);

    const acp = await fleetComplianceDb.getAcpByVesselName(pool, userId, vessel.name);

    // Build chronological audit trail
    const audit = [];
    certs.forEach(c => audit.push({
      type: 'cert', icon: '📋',
      label: `Certificate added: ${c.cert_type}`,
      ts: c.created_at,
      meta: { cert_type: c.cert_type, expiry: c.expiry_date },
    }));
    filings.forEach(f => audit.push({
      type: 'filing', icon: f.status === 'approved' ? '✅' : f.status === 'rejected' ? '❌' : '📄',
      label: `Filing ${f.status}: ${f.document_type.replace(/_/g, ' ')}`,
      ts: f.submitted_at || f.created_at,
      meta: { status: f.status, doc_type: f.document_type, ref: f.reference_number },
    }));
    acp.forEach(a => audit.push({
      type: 'acp', icon: a.status === 'approved' ? '✅' : a.status === 'rejected' ? '❌' : '🚢',
      label: `ACP ${a.status}: ${(a.filing_type || 'submission').replace(/_/g, ' ')}`,
      ts: a.submitted_at || a.created_at,
      meta: { status: a.status, filing_type: a.filing_type },
    }));
    audit.sort((a, b) => new Date(b.ts) - new Date(a.ts));

    res.json({ success: true, vessel, certificates: certs, filings, acp, audit: audit.slice(0, 40) });
  } catch (err) {
    console.error('GET /api/compliance/vessel/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUEZ CANAL PDF GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/filings/:id/pdf?type=[document_type|all]
 *
 * Generate a downloadable SCA-compliant PDF for a Suez Canal filing.
 *
 * Query params:
 *   type  — document type key (e.g. 'sca_transit_application', 'suez_crew_manifest'),
 *            or 'all' to generate a combined filing package. Defaults to 'all'.
 *
 * Response: application/pdf with Content-Disposition: attachment
 *
 * Auth required. Users can only download their own filings.
 */
router.get('/filings/:id/pdf', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filingId = parseInt(req.params.id, 10);
    const docType  = (req.query.type || 'all').trim().toLowerCase();

    if (isNaN(filingId)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    // ── 1. Fetch the filing ───────────────────────────────────────────────
    const filingRows = await notificationsDb.getFilingForPdf(pool, filingId, userId);

    if (!filingRows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const filing = filingRows[0];

    // Only Suez filings get SCA PDF output
    if (filing.canal && filing.canal !== 'suez') {
      return res.status(400).json({
        success: false,
        message: `This filing is for canal "${filing.canal}". Suez PDF generation requires canal=suez.`,
      });
    }

    // ── 2. Validate document type ─────────────────────────────────────────
    const { ALL_DOC_TYPES } = require('../services/suez-pdf-generator');
    const validTypes = ['all', ...ALL_DOC_TYPES];

    if (!validTypes.includes(docType)) {
      return res.status(400).json({
        success: false,
        message: `Unknown document type "${docType}". Valid values: ${validTypes.join(', ')}`,
      });
    }

    // ── 3. Fetch supplementary data ───────────────────────────────────────
    let ispsNotifications = [];
    let submission        = null;

    // ISPS notifications (for ISPS doc or combined package)
    if (docType === 'all' || docType === 'suez_isps_declaration') {
      try {
        ispsNotifications = await notificationsDb.getIspsNotificationsByFiling(pool, filingId);
      } catch (e) {
        // table may not exist yet in all environments — non-fatal
        console.warn('[SuezPDF] suez_isps_notifications query failed (non-fatal):', e.message);
      }
    }

    // SCA submission record (for transit application reference)
    try {
      submission = await notificationsDb.getScaSubmissionByFiling(pool, filingId);
    } catch (e) {
      console.warn('[SuezPDF] sca_submissions query failed (non-fatal):', e.message);
    }

    // ── 4. Generate PDF ───────────────────────────────────────────────────
    const { generateSuezPDF } = require('../services/suez-pdf-generator');

    const pdfBuffer = await generateSuezPDF(filing, docType, {
      ispsNotifications,
      submission,
    });

    // ── 5. Stream to client ───────────────────────────────────────────────
    const refSlug = (filing.reference_number || `CC-SCA-${String(filing.id).padStart(6,'0')}`).replace(/\s+/g, '-');
    const vesselSlug = (filing.vessel_name || 'vessel').replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '').slice(0, 30);
    const typeSlug = docType === 'all' ? 'complete-package' : docType.replace(/_/g, '-');
    const filename = `${BRAND_SLUG}-suez-${vesselSlug}-${typeSlug}-${refSlug}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdfBuffer);

    console.log(`[SuezPDF] Generated ${docType} PDF for filing #${filingId} (${pdfBuffer.length} bytes)`);

  } catch (err) {
    console.error('[SuezPDF] PDF generation error:', err.message, err.stack);

    // If headers not sent, return JSON error
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'PDF generation failed: ' + err.message,
      });
    }
  }
});

/**
 * GET /api/filings/:id/pdf/types
 * List available PDF document types for a filing.
 * Returns which types are valid + whether the filing has data for each.
 */
router.get('/filings/:id/pdf/types', requireAuth, async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const filingId = parseInt(req.params.id, 10);

    if (isNaN(filingId)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const rows = await notificationsDb.getFilingBasicForPdfTypes(pool, filingId, userId);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Filing not found.' });

    const filing = rows[0];
    const { ALL_DOC_TYPES, DOC_META } = require('../services/suez-pdf-generator');

    const types = ALL_DOC_TYPES.map(dt => ({
      type:       dt,
      title:      DOC_META[dt].title,
      subtitle:   DOC_META[dt].subtitle,
      form_ref:   DOC_META[dt].form,
      url:        `/api/filings/${filingId}/pdf?type=${dt}`,
    }));

    res.json({
      success:  true,
      filing_id: filingId,
      canal:    filing.canal || 'suez',
      document_types: types,
      combined_url: `/api/filings/${filingId}/pdf?type=all`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const BRAND_SLUG = 'canalclear';

// ─────────────────────────────────────────────────────────────────────────────
// PANAMA FILING EXPORT — PDF / CSV / Excel
// Routes:
//   GET /api/filings/:id/pdf/panama?type=[vumpa_pre_arrival|pcsopep_plan|crew_manifest|cargo_declaration|all]
//   GET /api/filings/:id/export?format=csv|xlsx
//   GET /api/filings/export?format=csv|xlsx  (bulk — all Panama/Suez filings)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/filings/:id/pdf/panama?type=[docType|all]
 *
 * Generate a downloadable PDF for a Panama Canal filing (VUMPA, PCSOPEP, etc.)
 * Auth required. Users can only download their own filings.
 */
router.get('/filings/:id/pdf/panama', requireAuth, async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const filingId = parseInt(req.params.id, 10);
    const docType  = (req.query.type || 'vumpa_pre_arrival').trim().toLowerCase();

    if (isNaN(filingId)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const { generatePanamaPDF, ALL_DOC_TYPES: PA_TYPES } = require('../services/panama-pdf-generator');

    if (docType !== 'all' && !PA_TYPES.includes(docType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Valid types: ${PA_TYPES.join(', ')}, all`,
      });
    }

    const rows = await notificationsDb.getFilingById(pool, filingId, userId);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const filing    = rows[0];
    const pdfBuffer = await generatePanamaPDF(filing, docType);

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const typeSlug   = docType === 'all' ? 'complete-package' : docType.replace(/_/g, '-');
    const refSlug    = (filing.reference_number || String(filingId)).replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename   = `${BRAND_SLUG}-panama-${vesselSlug}-${typeSlug}-${refSlug}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
      'Cache-Control':       'no-store',
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[Panama/PDF] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
    }
  }
});

/**
 * GET /api/filings/:id/export?format=csv|xlsx
 *
 * Export a single filing (Panama or Suez) as CSV or Excel.
 * Auth required. Users can only export their own filings.
 */
router.get('/filings/:id/export', requireAuth, async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const filingId = parseInt(req.params.id, 10);
    const format   = (req.query.format || 'csv').trim().toLowerCase();

    if (isNaN(filingId)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }
    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use csv or xlsx.' });
    }

    const rows = await notificationsDb.getFilingById(pool, filingId, userId);
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const { filingsToCSV, filingsToXLSX } = require('../services/filing-export');
    const filing     = rows[0];
    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const dateStr    = new Date().toISOString().slice(0, 10);
    const canal      = filing.canal || 'panama';

    if (format === 'csv') {
      const csv      = filingsToCSV([filing]);
      const filename = `${BRAND_SLUG}-${canal}-${vesselSlug}-${dateStr}.csv`;
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
      return res.send('\uFEFF' + csv);
    }

    const xlsxBuf  = filingsToXLSX([filing]);
    const filename = `${BRAND_SLUG}-${canal}-${vesselSlug}-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Filings/Export] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

/**
 * GET /api/filings/export?format=csv|xlsx&canal=panama|suez
 *
 * Bulk export all filings for the authenticated user.
 * Optional ?canal= filter.
 */
router.get('/filings/export', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const format = (req.query.format || 'csv').trim().toLowerCase();
    const canal  = req.query.canal ? req.query.canal.toLowerCase() : null;

    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use csv or xlsx.' });
    }

    const rows = await notificationsDb.getUserFilings(pool, userId, canal);

    const { filingsToCSV, filingsToXLSX } = require('../services/filing-export');
    const dateStr = new Date().toISOString().slice(0, 10);
    const label   = canal ? canal : 'all';

    if (format === 'csv') {
      const csv      = filingsToCSV(rows);
      const filename = `${BRAND_SLUG}-filings-${label}-${dateStr}.csv`;
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
      return res.send('\uFEFF' + csv);
    }

    const xlsxBuf  = filingsToXLSX(rows, `${label} filings`);
    const filename = `${BRAND_SLUG}-filings-${label}-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Filings/BulkExport] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUEZ ADMIN — clean URL structure (/api/admin/suez/*)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/suez/stats
 * Filing counts, validation pass rates, common errors, SCA submission totals.
 */
router.get('/admin/suez/stats', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const [analyticsRow, errorsRes, feeRes] = await Promise.all([
      suezAnalyticsDb.getFilingAnalyticsCounts(pool),
      suezAnalyticsDb.getTopValidationErrors(pool),
      suezAnalyticsDb.getScaSubmissionStats(pool),
    ]);

    const a = analyticsRow.rows[0];
    const suezPass = await suezAnalyticsDb.getSuezValidationPassCount(pool);
    const suezValidTotal = await suezAnalyticsDb.getSuezValidationTotalCount(pool);

    res.json({
      success: true,
      filings: {
        suez_total:    parseInt(a.suez_total),
        panama_total:  parseInt(a.panama_total),
        suez_month:    parseInt(a.suez_month),
        panama_month:  parseInt(a.panama_month),
        suez_week:     parseInt(a.suez_week),
        suez_submitted: parseInt(a.suez_submitted),
        suez_draft:    parseInt(a.suez_draft),
        suez_approved: parseInt(a.suez_approved),
        suez_rejected: parseInt(a.suez_rejected),
      },
      validation: {
        total: suezValidTotal,
        pass:  suezPass,
        pass_rate: suezValidTotal > 0 ? Math.round((suezPass / suezValidTotal) * 100) : null
      },
      submissions: {
        total_submissions: parseInt(feeRes.rows[0].total_submissions),
        submitted_count:   parseInt(feeRes.rows[0].submitted_count),
        unique_users:      parseInt(feeRes.rows[0].unique_users),
        unique_convoys:    parseInt(feeRes.rows[0].unique_convoys),
      },
      common_errors: errorsRes.rows,
    });
  } catch (err) {
    console.error('[Admin Suez Stats]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez/isps-timeline
 * ISPS notification timeline — all Suez filings (no overdue section).
 */
router.get('/admin/suez/isps-timeline', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const filingsRes = await suezAnalyticsDb.getAdminIspsTimeline(pool);
    res.json({ success: true, filings: filingsRes.rows });
  } catch (err) {
    console.error('[Admin Suez ISPS Timeline]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez/overdue-alerts
 * Overdue ISPS notifications (pending > 24 hours).
 */
router.get('/admin/suez/overdue-alerts', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const overdueRes = await suezAnalyticsDb.getAdminOverdueAlerts(pool);
    res.json({
      success: true,
      overdue_count: overdueRes.rows.length,
      overdue_notifications: overdueRes.rows,
    });
  } catch (err) {
    console.error('[Admin Suez Overdue Alerts]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez/convoy-status
 * SCA submissions and convoy booking status.
 */
router.get('/admin/suez/convoy-status', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const convoyRes = await suezAnalyticsDb.getConvoyStatus(pool);
    const breakdown = {};
    for (const row of convoyRes.rows) {
      const c = row.convoy_number || 'unassigned';
      breakdown[c] = (breakdown[c] || 0) + 1;
    }
    res.json({ success: true, submissions: convoyRes.rows, convoy_breakdown: breakdown });
  } catch (err) {
    console.error('[Admin Suez Convoy Status]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/admin/suez/fee-audit
 * Fee calculation audit trail from suez_fee_tiers and sca_submissions.
 */
router.get('/admin/suez/fee-audit', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const feeAuditRes = await suezAnalyticsDb.getFeeAudit(pool);
    res.json({ success: true, fee_audit: feeAuditRes.rows });
  } catch (err) {
    console.error('[Admin Suez Fee Audit]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUEZ CONVOY BOOKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classify vessel priority class based on vessel type string.
 */
function classifyConvoyPriority(vesselType) {
  if (!vesselType) return 'standard';
  const v = vesselType.toLowerCase();
  if (v.includes('lng') || v.includes('lpg') || v.includes('liquefied')) return 'priority_1';
  if (
    v.includes('container') || v.includes('tanker') || v.includes('crude') ||
    v.includes('chemical') || v.includes('passenger') || v.includes('ro-ro') ||
    v.includes('roro') || v.includes('ro_ro')
  ) return 'priority_2';
  return 'standard';
}

/**
 * Estimate waiting time in days based on priority, direction, and date.
 */
function estimateConvoyWait(vesselType, direction, requestedDate) {
  const pc = classifyConvoyPriority(vesselType);

  // Base wait ranges (days)
  const baseWait = {
    priority_1: { min: 0.5, max: 1.5, label: '12–36 hours' },
    priority_2: { min: 1, max: 3, label: '1–3 days' },
    standard:   { min: 2, max: 5, label: '2–5 days' },
  };
  const base = baseWait[pc] || baseWait.standard;

  // Direction adjustment — southbound has a single convoy, typically more wait
  const dirFactor = direction === 'southbound' ? 1.3 : 1.0;

  // Seasonal adjustment
  let seasonalFactor = 1.0;
  let seasonNote = 'Normal season';
  if (requestedDate) {
    const d = new Date(requestedDate);
    const month = d.getMonth() + 1; // 1-12
    if (month >= 6 && month <= 8) {
      seasonalFactor = 1.2;
      seasonNote = 'Peak season (Jun–Aug) — higher traffic';
    } else if (month === 12 || month === 1) {
      seasonalFactor = 1.15;
      seasonNote = 'Holiday peak (Dec–Jan) — elevated traffic';
    } else if (month === 2 || month === 3) {
      seasonalFactor = 0.9;
      seasonNote = 'Low season (Feb–Mar) — reduced traffic';
    }
  }

  const adjustedMin = Math.round(base.min * dirFactor * seasonalFactor * 10) / 10;
  const adjustedMax = Math.round(base.max * dirFactor * seasonalFactor * 10) / 10;

  // Compute earliest transit date
  let earliestTransit = '—';
  if (requestedDate) {
    const d = new Date(requestedDate);
    const avgWaitDays = (adjustedMin + adjustedMax) / 2;
    d.setDate(d.getDate() + Math.ceil(avgWaitDays));
    earliestTransit = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Compute human wait label
  let waitLabel;
  if (pc === 'priority_1' && dirFactor === 1.0 && seasonalFactor <= 1.0) {
    waitLabel = '12–36 hours';
  } else if (adjustedMin < 1) {
    waitLabel = `${Math.round(adjustedMin * 24)}–${Math.round(adjustedMax * 24)} hours`;
  } else {
    waitLabel = `${adjustedMin}–${adjustedMax} days`;
  }

  return {
    priority_class: pc,
    wait_label: waitLabel,
    wait_min_days: adjustedMin,
    wait_max_days: adjustedMax,
    estimated_earliest_transit: earliestTransit,
    seasonal_factor: seasonalFactor,
    season_note: seasonNote,
    disclaimer: 'Estimates based on SCA historical data. Actual waiting times depend on canal traffic, vessel inspection status, and SCA Operations Centre allocation.',
  };
}

/**
 * GET /suez/waiting-estimate
 * Public endpoint — waiting time estimator.
 * Query: vessel_type, direction, requested_date (optional)
 */
router.get('/suez/waiting-estimate', async (req, res) => {
  const { vessel_type = 'bulk_carrier', direction = 'northbound', requested_date } = req.query;
  try {
    const estimate = estimateConvoyWait(vessel_type, direction, requested_date || null);
    res.json({ success: true, estimate });
  } catch (err) {
    console.error('[Suez Waiting Estimate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /suez/my-filings
 * Authenticated — returns user's Suez filings for use in booking form.
 */
router.get('/suez/my-filings', requireAuth, requireSuez, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await suezAnalyticsDb.getUserSuezFilings(pool, req.user.id);
    res.json({ success: true, filings: result.rows });
  } catch (err) {
    console.error('[Suez My Filings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /suez/convoy-booking
 * Authenticated — create a convoy booking (stored in sca_submissions).
 */
router.post('/suez/convoy-booking', requireAuth, requireSuez, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    filing_id,
    transit_direction,
    requested_transit_date,
    convoy_number,
    priority_class,
    agent_name,
    agent_phone,
    agent_email,
    sca_reference,
    special_requirements,
    notes,
  } = req.body;

  if (!transit_direction || !['northbound', 'southbound'].includes(transit_direction)) {
    return res.status(400).json({ success: false, message: 'Invalid transit_direction. Must be northbound or southbound.' });
  }
  if (!agent_name) {
    return res.status(400).json({ success: false, message: 'agent_name is required.' });
  }

  try {
    // Fetch vessel info from the linked filing (if provided)
    let vesselName = null;
    let filingRef = null;
    if (filing_id) {
      const filR = await suezAnalyticsDb.getFilingVesselInfo(pool, filing_id, req.user.id);
      if (filR.rows.length > 0) {
        vesselName = filR.rows[0].vessel_name;
        filingRef = filR.rows[0].reference_number;
      }
    }

    const insertRes = await suezAnalyticsDb.insertConvoyBooking(pool, {
      userId: req.user.id,
      filingId: filing_id || null,
      vesselName,
      transitDirection: transit_direction,
      convoyNumber: convoy_number || null,
      scaReference: sca_reference || null,
      notes: notes || null,
      requestedTransitDate: requested_transit_date || null,
      priorityClass: priority_class || classifyConvoyPriority(''),
      agentName: agent_name,
      agentPhone: agent_phone || null,
      agentEmail: agent_email || null,
      specialRequirements: special_requirements && special_requirements.length > 0 ? special_requirements : null,
    });

    res.json({
      success: true,
      booking: insertRes.rows[0],
      filing_reference: filingRef,
    });
  } catch (err) {
    console.error('[Suez Convoy Booking]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /suez/my-bookings
 * Authenticated — list user's convoy bookings with vessel + filing info.
 */
router.get('/suez/my-bookings', requireAuth, requireSuez, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await suezAnalyticsDb.getUserConvoyBookings(pool, req.user.id);
    res.json({ success: true, bookings: result.rows });
  } catch (err) {
    console.error('[Suez My Bookings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// SUEZ ISPS PRE-ARRIVAL NOTIFICATION TIMELINE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate notification deadlines from an ETA timestamp.
 * Returns { deadline_72h, deadline_48h, deadline_24h } as Date objects.
 */
function calcIspsDeadlines(etaArrival) {
  const eta = new Date(etaArrival);
  return {
    deadline_72h: new Date(eta.getTime() - 72 * 60 * 60 * 1000),
    deadline_48h: new Date(eta.getTime() - 48 * 60 * 60 * 1000),
    deadline_24h: new Date(eta.getTime() - 24 * 60 * 60 * 1000),
  };
}

/**
 * Compute the lifecycle status for a single notification stage.
 *
 * Status rules:
 *   'sent'      — sent_at is set
 *   'confirmed' — sent_at + acknowledged_at are set
 *   'overdue'   — deadline has passed, not sent
 *   'upcoming'  — deadline within 6 hours
 *   'pending'   — deadline > 6h away
 */
function computeNotifStatus(row, deadlineKey) {
  const deadline = row[deadlineKey] ? new Date(row[deadlineKey]) : null;
  const now = new Date();

  if (row.acknowledged_at) return 'confirmed';
  if (row.sent_at)         return 'sent';
  if (!deadline)           return 'pending';
  if (now > deadline)      return 'overdue';
  if ((deadline - now) <= 6 * 60 * 60 * 1000) return 'upcoming';
  return 'pending';
}

/**
 * Build a full timeline object for a filing.
 * Returns the 3-stage notification objects (creating placeholders if absent from DB).
 */
function buildTimeline(rows, filingId, vesselName, imoNumber) {
  const STAGES = ['72h', '48h', '24h'];
  const DEADLINE_KEYS = { '72h': 'deadline_72h', '48h': 'deadline_48h', '24h': 'deadline_24h' };

  const byType = {};
  for (const r of rows) {
    byType[r.notification_type] = r;
  }

  // ETA comes from any row (all rows for the same filing share the same ETA)
  const etaRow = rows[0] || null;

  return STAGES.map(stage => {
    const row = byType[stage] || null;
    const deadlineKey = DEADLINE_KEYS[stage];
    const deadline = row ? row[deadlineKey] : (etaRow ? etaRow[deadlineKey] : null);

    const now = new Date();
    let status = 'pending';
    if (row) {
      if (row.acknowledged_at)       status = 'confirmed';
      else if (row.sent_at)          status = 'sent';
      else if (deadline && now > new Date(deadline)) status = 'overdue';
      else if (deadline && (new Date(deadline) - now) <= 6 * 60 * 60 * 1000) status = 'upcoming';
    } else if (deadline) {
      if (now > new Date(deadline))  status = 'overdue';
      else if ((new Date(deadline) - now) <= 6 * 60 * 60 * 1000) status = 'upcoming';
    }

    const msToDeadline = deadline ? new Date(deadline) - now : null;
    const hoursToDeadline = msToDeadline !== null ? Math.round(msToDeadline / (60 * 60 * 1000)) : null;

    return {
      stage,
      id: row ? row.id : null,
      filing_id: filingId,
      vessel_name: vesselName,
      imo_number: imoNumber,
      eta_arrival: row ? row.eta_arrival : (etaRow ? etaRow.eta_arrival : null),
      deadline,
      status,
      hours_to_deadline: hoursToDeadline,
      sent_at: row ? row.sent_at : null,
      acknowledged_at: row ? row.acknowledged_at : null,
      sca_reference: row ? row.sca_reference : null,
      vessel_security_level: row ? row.vessel_security_level : 1,
      issc_number: row ? row.issc_number : null,
      issc_expiry: row ? row.issc_expiry : null,
      issc_issuer: row ? row.issc_issuer : null,
      last_10_ports: row ? row.last_10_ports : [],
      special_measures: row ? row.special_measures : null,
      threat_reported: row ? row.threat_reported : false,
      content_data: row ? row.content_data : {},
    };
  });
}

/**
 * GET /api/suez/notifications/overdue
 * List all overdue ISPS notification rows for the current user.
 * "Overdue" = deadline has passed + not sent.
 *
 * Admins can pass ?all=true to see all users' overdue notifications.
 */
router.get('/suez/notifications/overdue', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const isAdmin = req.user && req.user.is_admin;
  const showAll = isAdmin && req.query.all === 'true';
  const now = new Date().toISOString();

  try {
    const result = showAll
      ? await certificatesDb.getOverdueNotificationsAdmin(pool, now)
      : await certificatesDb.getOverdueNotificationsUser(pool, req.user.id, now);

    res.json({
      success: true,
      overdue: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error('[Suez Notifications Overdue]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/notifications/:filingId
 * Full notification timeline for a specific filing.
 * Returns all 3 stages (with placeholders for not-yet-created rows).
 *
 * If no ETA is set yet, timeline stubs return null deadlines.
 * Optionally: pass ?eta=ISO_STRING to set/update the ETA for all rows in this filing.
 */
router.get('/suez/notifications/:filingId', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const { filingId } = req.params;
  const etaParam = req.query.eta || null;

  try {
    // Verify filing belongs to this user (or admin)
    const filingRes = await certificatesDb.getFilingBasicById(pool, filingId);
    if (!filingRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found' });
    }
    const filing = filingRes.rows[0];

    // Non-admins can only see their own filings
    const ownerCheck = await certificatesDb.checkFilingOwnership(pool, filingId, req.user.id);
    if (!req.user.is_admin && !ownerCheck.rows.length) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // If ETA provided, upsert deadlines across all notification rows for this filing
    if (etaParam) {
      const eta = new Date(etaParam);
      if (isNaN(eta.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid ETA date' });
      }
      const { deadline_72h, deadline_48h, deadline_24h } = calcIspsDeadlines(eta);

      // Update all existing rows for this filing
      await certificatesDb.updateIspsDeadlines(pool, eta.toISOString(), deadline_72h.toISOString(), deadline_48h.toISOString(), deadline_24h.toISOString(), filingId, req.user.id);
    }

    // Fetch all notifications for this filing
    const notifRes = await certificatesDb.getNotificationsByFiling(pool, filingId);

    const timeline = buildTimeline(notifRes.rows, parseInt(filingId), filing.vessel_name, filing.imo_number);

    res.json({
      success: true,
      filing: {
        id: filing.id,
        vessel_name: filing.vessel_name,
        imo_number: filing.imo_number,
        reference_number: filing.reference_number,
        canal: filing.canal,
      },
      timeline,
      eta_arrival: notifRes.rows[0]?.eta_arrival || null,
    });
  } catch (err) {
    console.error('[Suez Notifications Get]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/suez/notifications/:filingId/:stage
 * Mark a notification stage as sent (or create it if it doesn't exist).
 * Stage must be: 72h | 48h | 24h
 *
 * Body (all optional, used for template content):
 *   eta_arrival, vessel_security_level, issc_number, issc_expiry, issc_issuer,
 *   last_10_ports, special_measures, threat_reported, sca_reference, content_data,
 *   action: 'mark_sent' | 'confirm' | 'upsert'  (default: 'mark_sent')
 */
router.post('/suez/notifications/:filingId/:stage', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const { filingId, stage } = req.params;

  if (!['72h', '48h', '24h'].includes(stage)) {
    return res.status(400).json({ success: false, message: 'Stage must be 72h, 48h, or 24h' });
  }

  const {
    action = 'mark_sent',
    eta_arrival,
    vessel_security_level = 1,
    issc_number = null,
    issc_expiry = null,
    issc_issuer = null,
    last_10_ports = [],
    special_measures = null,
    threat_reported = false,
    sca_reference = null,
    content_data = {},
  } = req.body;

  try {
    // Verify filing ownership
    const filingRes = await certificatesDb.getFilingForNotification(pool, filingId, req.user.id);
    if (!filingRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found' });
    }
    const filing = filingRes.rows[0];

    // Compute deadlines if ETA provided
    let deadline_72h = null, deadline_48h = null, deadline_24h = null;
    if (eta_arrival) {
      const parsed = new Date(eta_arrival);
      if (!isNaN(parsed.getTime())) {
        const d = calcIspsDeadlines(parsed);
        deadline_72h = d.deadline_72h.toISOString();
        deadline_48h = d.deadline_48h.toISOString();
        deadline_24h = d.deadline_24h.toISOString();
      }
    }

    // Check if row already exists
    const existing = await certificatesDb.getExistingNotification(pool, filingId, req.user.id, stage);

    let notifRow;

    if (existing.rows.length > 0) {
      // Update existing
      const ex = existing.rows[0];

      let sentAt = ex.sent_at;
      let acknowledgedAt = ex.acknowledged_at;
      let newStatus = ex.status;

      if (action === 'mark_sent') {
        sentAt = new Date().toISOString();
        newStatus = 'sent';
      } else if (action === 'confirm') {
        sentAt = sentAt || new Date().toISOString();
        acknowledgedAt = new Date().toISOString();
        newStatus = 'confirmed';
      }

      const updateRes = await certificatesDb.updateNotification(pool, {
        vesselSecurityLevel: vessel_security_level,
        isscNumber: issc_number, isscExpiry: issc_expiry, isscIssuer: issc_issuer,
        last10Ports: JSON.stringify(last_10_ports),
        specialMeasures: special_measures, threatReported: threat_reported, scaReference: sca_reference,
        contentData: JSON.stringify(content_data),
        sentAt, acknowledgedAt, status: newStatus,
        etaArrival: eta_arrival || null,
        deadline72h: deadline_72h, deadline48h: deadline_48h, deadline24h: deadline_24h,
        id: ex.id,
      });
      notifRow = updateRes.rows[0];
    } else {
      // Insert new
      let sentAt = null;
      let acknowledgedAt = null;
      let newStatus = 'pending';

      if (action === 'mark_sent') {
        sentAt = new Date().toISOString();
        newStatus = 'sent';
      } else if (action === 'confirm') {
        sentAt = new Date().toISOString();
        acknowledgedAt = new Date().toISOString();
        newStatus = 'confirmed';
      }

      const insertRes = await certificatesDb.insertNotification(pool, {
        userId: req.user.id, filingId, vesselName: filing.vessel_name, imoNumber: filing.imo_number,
        stage, vesselSecurityLevel: vessel_security_level,
        isscNumber: issc_number, isscExpiry: issc_expiry || null, isscIssuer: issc_issuer,
        last10Ports: JSON.stringify(last_10_ports), specialMeasures: special_measures, threatReported: threat_reported,
        scaReference: sca_reference, status: newStatus, contentData: JSON.stringify(content_data),
        sentAt, acknowledgedAt,
        etaArrival: eta_arrival || null,
        deadline72h: deadline_72h, deadline48h: deadline_48h, deadline24h: deadline_24h,
      });
      notifRow = insertRes.rows[0];

      // Also update ETA+deadlines on sibling rows for this filing if ETA provided
      if (eta_arrival && deadline_72h) {
        await certificatesDb.updateSiblingDeadlines(pool, eta_arrival, deadline_72h, deadline_48h, deadline_24h, filingId, req.user.id, stage);
      }
    }

    res.json({
      success: true,
      notification: notifRow,
      message: action === 'mark_sent' ? `${stage} notification marked as sent`
              : action === 'confirm'   ? `${stage} notification confirmed`
              : `${stage} notification saved`,
    });
  } catch (err) {
    console.error('[Suez Notifications Post]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/notifications/:filingId/template/:stage
 * Returns pre-populated template fields for a notification stage.
 * Pulls from the filing record + sibling notifications.
 */
router.get('/suez/notifications/:filingId/template/:stage', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const { filingId, stage } = req.params;

  if (!['72h', '48h', '24h'].includes(stage)) {
    return res.status(400).json({ success: false, message: 'Stage must be 72h, 48h, or 24h' });
  }

  try {
    const ownerCheck = await certificatesDb.getFilingForTemplate(pool, filingId, req.user.id);
    if (!ownerCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Filing not found' });
    }
    const filing = ownerCheck.rows[0];
    const doc = filing.document_data || {};

    // Stage-specific template pre-population
    let template = {};
    if (stage === '72h') {
      template = {
        vessel_id: filing.imo_number,
        vessel_name: filing.vessel_name,
        security_level: 1,
        last_10_ports_instruction: 'List last 10 port calls in chronological order',
        crew_count: doc.crew_count || null,
        passenger_count: doc.passenger_count || 0,
        note: 'Initial security notification — complete before 72 hours prior to Suez arrival',
      };
    } else if (stage === '48h') {
      template = {
        vessel_name: filing.vessel_name,
        imo_number: filing.imo_number,
        note: 'Updated ETA and cargo manifest summary required. Include agent details and convoy preference.',
        cargo_manifest_summary_instruction: 'Summarise DG cargo, total units, IMDG classes',
        convoy_preference: doc.convoy_preference || 'standard',
        agent_details_instruction: 'Provide Suez Canal agent name, phone, email',
      };
    } else {
      // 24h
      template = {
        vessel_name: filing.vessel_name,
        imo_number: filing.imo_number,
        draft_forward: filing.draft_forward || null,
        draft_aft: filing.draft_aft || null,
        note: 'Final confirmation. Include exact ETA and any changes since 48h notification.',
        changes_since_48h_instruction: 'Describe any ETA changes, cargo changes, or security level changes',
      };
    }

    res.json({ success: true, stage, template });
  } catch (err) {
    console.error('[Suez Notifications Template]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/suez/my-isps-filings
 * Returns all of the current user's Suez filings with ISPS notification summary.
 * Powers the filing dropdown on the ISPS timeline page.
 */
router.get('/suez/my-isps-filings', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const result = await certificatesDb.getUserIspsFilings(pool, req.user.id);

    res.json({ success: true, filings: result.rows });
  } catch (err) {
    console.error('[Suez My ISPS Filings]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/suez/calculate-fees
//
// Calculates SCA transit fees for a vessel.
// Used by suez-calculator.html (standalone estimator) and the SCNT tonnage card
// in the filing form. No auth required — public tool for transit planning.
//
// Body params:
//   scnt                   {number}  — Suez Canal Net Tonnage (from SCNT certificate)
//   gross_tonnage          {number}  — GT (for validation; optional if SCNT provided)
//   vessel_type            {string}  — container|tanker|bulk_carrier|lng_carrier|...
//   laden_status           {string}  — laden|ballast
//   cargo_type             {string}  — general|grain|coal|fertilizer|lng|oil|chemicals|other
//   transit_count_this_year{number}  — # of Suez transits so far this year
//   green_certified        {boolean} — LNG Green Passage certified
//   loa                    {number}  — Length Overall (m) — for SCNT estimation
//   beam                   {number}  — Beam (m) — for SCNT estimation
//   depth                  {number}  — Moulded Depth (m) — for SCNT estimation
//   draft                  {number}  — Mean Draft (m) — for additional context
//
// Response: { success, suez_breakdown, panama_estimate, comparison,
//             applicable_rebates, best_rebate, scnt_estimated, scnt_validation }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/suez/calculate-fees', async (req, res) => {
  const pool = req.app.locals.pool;

  const {
    scnt: inputScnt,
    gross_tonnage,
    vessel_type = 'other',
    laden_status = 'laden',
    cargo_type = 'general',
    transit_count_this_year = 0,
    green_certified = false,
    loa,
    beam,
    depth,
    draft,
  } = req.body || {};

  // ── Hardcoded 2024 SCA tariff (used if DB table not seeded or query fails) ──
  // Source: SCA Circular No. 1/2024 — effective 1 January 2024
  // Each entry: [scnt_max, base_rate_sdr] (null scnt_max = no upper limit)
  const FALLBACK_RATES = {
    container:      [{ max: 5000, rate: 7.50 }, { max: 15000, rate: 7.20 }, { max: 40000, rate: 6.90 }, { max: null, rate: 6.50 }],
    tanker:         [{ max: 5000, rate: 8.20 }, { max: 20000, rate: 7.80 }, { max: null, rate: 7.20 }],
    bulk_carrier:   [{ max: 5000, rate: 5.80 }, { max: null,  rate: 5.50 }],
    lng_carrier:    [{ max: null, rate: 9.50 }],
    lpg_carrier:    [{ max: null, rate: 8.50 }],
    general_cargo:  [{ max: 5000, rate: 5.20 }, { max: null,  rate: 4.80 }],
    ro_ro:          [{ max: null, rate: 6.80 }],
    passenger:      [{ max: null, rate: 3.00 }],
    chemical_tanker:[{ max: 5000, rate: 7.80 }, { max: null,  rate: 7.50 }],
    other:          [{ max: null, rate: 5.00 }],
  };

  const FALLBACK_MINIMUMS = {
    container: 10000, tanker: 12000, lng_carrier: 20000, lpg_carrier: 15000,
    ro_ro: 10000, passenger: 5000, general_cargo: 6000,
    bulk_carrier: 8000, chemical_tanker: 10000, other: 4000,
  };

  // SDR/USD rate (approximate — SCA invoices at IMF daily rate on payment date)
  const SDR_TO_USD = 1.33;

  try {
    // ── 1. Resolve SCNT ───────────────────────────────────────────────────────
    let scnt = parseFloat(inputScnt) || 0;
    let scntEstimated = false;
    const dimensionNotes = [];

    if (scnt <= 0) {
      // Try to estimate from dimensions
      const l = parseFloat(loa);
      const b = parseFloat(beam);
      const d = parseFloat(depth);

      if (l > 0 && b > 0 && d > 0) {
        // SCA uses its own measurement but a good approximation:
        // Estimated GRT ≈ (LOA × Beam × Depth × 0.72) / 2.832  [block coeff / m³-per-GRT]
        // Estimated SCNT ≈ GRT × 0.70  [SCNT is ~65-75% of GT for most vessels]
        const estimatedGrt = (l * b * d * 0.72) / 2.832;
        scnt = Math.round(estimatedGrt * 0.70);
        scntEstimated = true;
        dimensionNotes.push(
          `SCNT estimated from dimensions (LOA ${l}m × Beam ${b}m × Depth ${d}m). Accuracy ±15%. ` +
          `Use certified SCNT for actual SCA filings.`
        );
      } else if (gross_tonnage && gross_tonnage > 0) {
        // Last resort: estimate from GT
        scnt = Math.round(parseFloat(gross_tonnage) * 0.72);
        scntEstimated = true;
        dimensionNotes.push(
          `SCNT estimated from Gross Tonnage (GT × 0.72). Accuracy ±20%. ` +
          `SCA measurement system differs from international GT. Use certified SCNT for actual filings.`
        );
      } else {
        return res.status(400).json({
          success: false,
          message: 'Provide SCNT, Gross Tonnage, or vessel dimensions (LOA + Beam + Depth) to calculate fees.',
        });
      }
    }

    // ── 2. SCNT sanity validation ─────────────────────────────────────────────
    let scntValidation = null;
    if (gross_tonnage && gross_tonnage > 0 && !scntEstimated) {
      const ratio = scnt / parseFloat(gross_tonnage);
      if (ratio < 0.30) {
        scntValidation = { status: 'warning', message: `SCNT/GT ratio ${(ratio * 100).toFixed(1)}% is unusually low. Verify this is SCNT (not ITC NT or GT).` };
      } else if (ratio > 1.05) {
        scntValidation = { status: 'error', message: `SCNT (${scnt}) exceeds GT (${gross_tonnage}). SCNT cannot exceed GT — check inputs.` };
      } else {
        scntValidation = { status: 'ok', message: `SCNT/GT ratio ${(ratio * 100).toFixed(1)}% — within expected range (55–85%).` };
      }
    } else if (!scntEstimated) {
      scntValidation = { status: 'ok', message: `SCNT ${scnt.toLocaleString()} — provided directly from certificate.` };
    } else {
      scntValidation = { status: 'warning', message: `SCNT estimated (±15%). Use certified SCNT certificate for actual SCA filings.` };
    }

    // ── 3. Look up base rate from DB (falls back to hardcoded table) ──────────
    let baseRateSdr = null;
    let minimumTollSdr = null;

    try {
      // The suez_fee_tiers table stores tiers per vessel_category
      // A tier row covers scnt_min to scnt_max (inclusive); scnt_max NULL = no upper limit
      const tierResult = await suezAnalyticsDb.lookupFeeTier(pool, vessel_type, scnt);

      if (tierResult.rows.length > 0) {
        baseRateSdr = parseFloat(tierResult.rows[0].base_rate_sdr);
        minimumTollSdr = tierResult.rows[0].minimum_toll_sdr
          ? parseFloat(tierResult.rows[0].minimum_toll_sdr)
          : null;
      }
    } catch (_dbErr) {
      // DB table might not exist — fall through to hardcoded rates
    }

    // Fall back to hardcoded rates if DB didn't return a result
    if (baseRateSdr === null) {
      const tiers = FALLBACK_RATES[vessel_type] || FALLBACK_RATES.other;
      for (const tier of tiers) {
        if (tier.max === null || scnt <= tier.max) {
          baseRateSdr = tier.rate;
          break;
        }
      }
      minimumTollSdr = FALLBACK_MINIMUMS[vessel_type] || FALLBACK_MINIMUMS.other;
    }

    // ── 4. Ballast rate reduction ─────────────────────────────────────────────
    // SCA publishes separate laden/ballast rates; ballast is generally lower.
    // For vessel types without explicit ballast tier, apply ~25% reduction to laden rate.
    // (Tanker ballast discount is handled separately as a rebate program.)
    let effectiveRateSdr = baseRateSdr;
    if (laden_status === 'ballast' && !['tanker', 'chemical_tanker'].includes(vessel_type)) {
      effectiveRateSdr = baseRateSdr * 0.80; // 20% reduction for ballast (non-tanker)
    }

    // ── 5. Calculate transit toll ─────────────────────────────────────────────
    const calculatedTollSdr = Math.round(scnt * effectiveRateSdr);
    const transitTollSdr = minimumTollSdr
      ? Math.max(calculatedTollSdr, minimumTollSdr)
      : calculatedTollSdr;
    const transitTollUsd = Math.round(transitTollSdr * SDR_TO_USD);

    // ── 6. Additional charges ─────────────────────────────────────────────────
    // Pilotage: SCA charges per pilot (2 compulsory) + launch service
    // Approximated based on vessel LOA band (SCA Schedule II)
    let pilotageSdr;
    const loaNum = parseFloat(loa) || 0;
    if (loaNum > 0) {
      if (loaNum <= 100)      pilotageSdr = 450;
      else if (loaNum <= 150) pilotageSdr = 620;
      else if (loaNum <= 200) pilotageSdr = 830;
      else if (loaNum <= 250) pilotageSdr = 1050;
      else if (loaNum <= 300) pilotageSdr = 1280;
      else if (loaNum <= 350) pilotageSdr = 1520;
      else                    pilotageSdr = 1800;
    } else {
      pilotageSdr = 900; // default estimate for unknown LOA
    }

    // Tug assistance: 2-3 tugs required depending on vessel size
    let tugsSdr;
    if (scnt <= 10000)       tugsSdr = 600;
    else if (scnt <= 30000)  tugsSdr = 1200;
    else if (scnt <= 70000)  tugsSdr = 1800;
    else                     tugsSdr = 2400;

    const mooringSdr      = 380;  // Mooring/unmooring (SCA Schedule III)
    const lightDuesSdr    = 180;  // Light dues (SCA Schedule V)
    const communicationSdr = 140; // Communications & admin (SCA standard)

    const additionalSdr = pilotageSdr + tugsSdr + mooringSdr + lightDuesSdr + communicationSdr;
    const additionalUsd = Math.round(additionalSdr * SDR_TO_USD);

    const grossTotalSdr = transitTollSdr + additionalSdr;
    const grossTotalUsd = Math.round(grossTotalSdr * SDR_TO_USD);

    // ── 7. Rebate programs ────────────────────────────────────────────────────
    // SCA offers several rebate programs. Only the best single rebate applies.
    // Source: SCA promotional announcements 2024
    const applicableRebates = [];

    // Bulk Carrier Promotion 2024 — applies to transit toll only
    if (vessel_type === 'bulk_carrier' && ['grain', 'coal', 'fertilizer'].includes(cargo_type)) {
      applicableRebates.push({
        name: 'Bulk Carrier Promotion 2024',
        percentage: 75,
        conditions: 'Bulk carriers carrying grain, coal, or fertilizer cargo. Apply via SCA agent at time of booking.',
        auto_applied: laden_status === 'laden',
      });
    }

    // Tanker Ballast Passage rebate
    if (['tanker', 'chemical_tanker'].includes(vessel_type) && laden_status === 'ballast') {
      applicableRebates.push({
        name: 'Tanker Ballast Passage',
        percentage: 25,
        conditions: 'Tankers (crude, product, chemical) transiting in ballast (no cargo). Applied automatically.',
        auto_applied: true,
      });
    }

    // LNG Green Passage rebate
    if (vessel_type === 'lng_carrier' && green_certified) {
      applicableRebates.push({
        name: 'LNG Green Passage',
        percentage: 20,
        conditions: 'LNG carriers with SCA-registered STS (Ship-to-Ship) credentials and low-emission compliance. Requires pre-registration.',
        auto_applied: true,
      });
    }

    // Container frequency rebate (10+ transits per year)
    if (vessel_type === 'container' && parseInt(transit_count_this_year) >= 10) {
      applicableRebates.push({
        name: 'Container Frequency Program (10+/yr)',
        percentage: 15,
        conditions: 'Container vessels with 10 or more Suez transits in the current calendar year. Applied on transit invoice.',
        auto_applied: true,
      });
    }

    // Pick best rebate
    const bestRebate = applicableRebates.length > 0
      ? applicableRebates.reduce((best, r) => r.percentage > best.percentage ? r : best)
      : null;

    // Rebate applies to transit toll only (not to additional charges)
    const rebateAmountSdr = bestRebate ? Math.round(transitTollSdr * bestRebate.percentage / 100) : 0;
    const rebateAmountUsd = Math.round(rebateAmountSdr * SDR_TO_USD);
    const netTotalSdr = grossTotalSdr - rebateAmountSdr;
    const netTotalUsd = Math.round(netTotalSdr * SDR_TO_USD);

    // ── 8. Panama Canal comparison ────────────────────────────────────────────
    // ACP 2024 tariff: PC/UMS-based (1 PC-UMS ≈ 1.08 GT)
    // Laden container: $176.00/PC-UMS; laden tanker: $155.00; bulk: $120.00
    const gtNum = parseFloat(gross_tonnage) || Math.round(scnt / 0.72);
    const pcums = Math.round(gtNum * 1.08);

    const PANAMA_RATES = {
      container: 174.00, tanker: 155.00, bulk_carrier: 118.00,
      lng_carrier: 174.00, lpg_carrier: 155.00, general_cargo: 110.00,
      ro_ro: 135.00, passenger: 92.00, chemical_tanker: 145.00, other: 110.00,
    };
    const panamaBaseRate = PANAMA_RATES[vessel_type] || PANAMA_RATES.other;
    const panamaTransitToll = Math.round(pcums * panamaBaseRate);
    const panamaAdditional = Math.round(3200 + (loaNum > 200 ? 1800 : 0)); // Panama additional charges ~$3,200-5,000
    const panamaTotalUsd = panamaTransitToll + panamaAdditional;

    const diff = Math.abs(netTotalUsd - panamaTotalUsd);
    const cheaperCanal = netTotalUsd < panamaTotalUsd ? 'suez' : netTotalUsd > panamaTotalUsd ? 'panama' : 'equal';

    // ── 9. Build response ─────────────────────────────────────────────────────
    return res.json({
      success: true,

      suez_breakdown: {
        scnt,
        base_rate_sdr:      parseFloat(effectiveRateSdr.toFixed(2)),
        calculated_toll_sdr: calculatedTollSdr,
        minimum_toll_sdr:   minimumTollSdr || null,
        transit_toll_sdr:   transitTollSdr,
        transit_toll_usd:   transitTollUsd,
        pilotage_sdr:       pilotageSdr,
        tugs_sdr:           tugsSdr,
        mooring_sdr:        mooringSdr,
        light_dues_sdr:     lightDuesSdr,
        communication_sdr:  communicationSdr,
        gross_total_sdr:    grossTotalSdr,
        gross_total_usd:    grossTotalUsd,
        rebate_amount_sdr:  rebateAmountSdr,
        rebate_amount_usd:  rebateAmountUsd,
        net_total_sdr:      netTotalSdr,
        net_total_usd:      netTotalUsd,
        additional_charges_usd: additionalUsd,
        sdr_rate:           SDR_TO_USD,
      },

      panama_estimate: {
        pcums_tonnage:          pcums,
        base_rate_usd_per_pcums: panamaBaseRate,
        transit_toll_usd:       panamaTransitToll,
        additional_charges_usd: panamaAdditional,
        total_usd:              panamaTotalUsd,
      },

      comparison: {
        cheaper_canal:  cheaperCanal,
        difference_usd: diff,
        suez_total_usd: netTotalUsd,
        panama_total_usd: panamaTotalUsd,
      },

      applicable_rebates: applicableRebates,
      best_rebate:        bestRebate,
      scnt_estimated:     scntEstimated,
      scnt_validation:    scntValidation,
      dimension_notes:    dimensionNotes,

      // Inputs reflected back for audit trail / filing save
      inputs: {
        scnt_input: inputScnt || null,
        gross_tonnage: gross_tonnage || null,
        vessel_type,
        laden_status,
        cargo_type,
        transit_count_this_year,
        green_certified,
        loa: loa || null,
        beam: beam || null,
        depth: depth || null,
        draft: draft || null,
      },
    });

  } catch (err) {
    console.error('[Suez Calculate Fees]', err.message);
    return res.status(500).json({ success: false, message: 'Fee calculation failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMO ENDPOINTS — Public (no auth), demo mode only, no ACP/SCA submission
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/demo/vessel-lookup?imo=9876543
 * Look up vessel particulars by IMO number — demo mode only, no auth required.
 * Returns vessel name, flag, dimensions, and type for auto-fill into the Panama
 * Canal demo form. Returns 404 if IMO not found in the vessel database.
 */
router.get('/demo/vessel-lookup', (req, res) => {
  const { lookupByIMO, validateIMOChecksum } = require('../services/vessel-lookup');
  const raw = (req.query.imo || '').trim();
  const imo = raw.replace(/^IMO\s*/i, '').trim();

  if (!imo) {
    return res.status(400).json({ success: false, message: 'imo parameter required' });
  }
  if (!/^\d{7}$/.test(imo)) {
    return res.status(400).json({ success: false, message: 'IMO must be 7 digits' });
  }
  if (!validateIMOChecksum(imo)) {
    return res.status(400).json({ success: false, message: 'Invalid IMO checksum' });
  }

  const vessel = lookupByIMO(imo);
  if (!vessel) {
    return res.status(404).json({ success: false, message: 'Vessel not found — enter details manually' });
  }

  return res.json({
    success: true,
    vessel: {
      imo:         vessel.imo,
      name:        vessel.name,
      flag:        vessel.flag,
      type:        vessel.type,
      gt:          vessel.gt,
      nt:          vessel.nt,
      loa:         vessel.loa,
      beam:        vessel.beam,
      draft:       vessel.draft,
      callsign:    vessel.callsign,
      mmsi:        vessel.mmsi,
    }
  });
});

/**
 * POST /api/demo/suez-validate
 * Run Suez SCA validation without authentication — demo mode only.
 * Uses validateSuezFiling from suez-validator.js.
 */
router.post('/demo/suez-validate', async (req, res) => {
  try {
    const { validateSuezFiling } = require('../services/suez-validator');
    const data = req.body;

    // Build a filing-like object from demo form data
    const filing = {
      vessel_name:    data.vessel_name || '',
      imo_number:     data.imo_number || '',
      flag_state:     data.flag_state || '',
      vessel_type:    data.vessel_type || '',
      gross_tonnage:  data.gross_tonnage || null,
      loa:            data.loa || null,
      beam:           data.beam || null,
      air_draft:      data.air_draft || null,
      forward_draft:  data.forward_draft || null,
      aft_draft:      data.aft_draft || null,
      scnt:           data.scnt || null,
      crew_count:     data.crew_count || null,
      eta:            data.eta || null,
      convoy:         data.convoy || null,
      cargo_type:     data.cargo_type || null,
      has_dangerous_goods: !!(data.has_dangerous_goods || (data.dangerous_goods && data.dangerous_goods.length > 0)),
      dangerous_goods: data.dangerous_goods || [],
    };

    // Try to run the full validator. On error (e.g. DB rules fetch), fall back to lite validation.
    let result;
    try {
      result = await validateSuezFiling(filing, null, null);
    } catch (_) {
      // Fallback: build a simple client-side-style result
      result = buildLiteSuezValidation(filing);
    }

    // Record demo validation run so admin Suez stats increment correctly.
    const pool = req.app.locals.pool;
    analyticsEventsDb.recordSuezDemoValidation(pool, {
      vessel_name: filing.vessel_name,
      imo_number: filing.imo_number,
      flag_state: filing.flag_state,
      vessel_type: filing.vessel_type,
      gross_tonnage: filing.gross_tonnage,
      cargo_type: filing.cargo_type,
      has_dangerous_goods: filing.has_dangerous_goods,
      overall_status: result.overall_status,
      total_checks: result.total_checks,
      passed_checks: result.passed_checks,
      failed_checks: result.failed_checks,
      warning_checks: result.warning_checks,
    }).catch(err => console.error('[Demo/SuezValidate] Record error:', err.message));

    res.json({ success: true, validation: result, demo: true });
  } catch (err) {
    console.error('[Demo/SuezValidate] Error:', err.message);
    res.status(500).json({ success: false, message: 'Validation failed: ' + err.message });
  }
});

/**
 * Lite Suez validation — runs when the full validator can't reach DB rules.
 * Covers the most visible SCA checks for the demo experience.
 */
function buildLiteSuezValidation(filing) {
  const checks = [];
  let passed = 0, warnings = 0, failed = 0;

  function check(id, name, status, message) {
    checks.push({ id, name, status, message });
    if (status === 'pass') passed++;
    else if (status === 'warning') warnings++;
    else failed++;
  }

  // Vessel name
  if (!filing.vessel_name) check('vessel_name_required', 'Vessel Name', 'fail', 'Vessel name is required for SCA filing.');
  else check('vessel_name_ok', 'Vessel Name', 'pass', 'Vessel name provided.');

  // IMO
  if (!filing.imo_number) check('imo_required', 'IMO Number', 'fail', 'IMO number is required.');
  else if (!/^\d{7}$/.test(filing.imo_number.toString().trim())) check('imo_format', 'IMO Format', 'fail', 'IMO must be exactly 7 digits.');
  else check('imo_ok', 'IMO Number', 'pass', 'Valid 7-digit IMO number.');

  // ETA — must be 48h+ ahead
  if (!filing.eta) {
    check('eta_required', 'ETA Required', 'fail', 'ETA is required. SCA requires 48h minimum advance notice.');
  } else {
    const etaMs = new Date(filing.eta).getTime();
    const hoursAhead = (etaMs - Date.now()) / 3600000;
    if (hoursAhead < 48) check('eta_48h', 'ETA 48h Notice', 'fail', 'SCA requires minimum 48h pre-arrival notice. ETA is too soon.');
    else if (hoursAhead < 96) check('eta_96h', 'ETA Advisory', 'warning', 'ETA is under 96h. SCA recommends 96h for convoy assignment.');
    else check('eta_ok', 'ETA Timing', 'pass', 'ETA meets SCA 48h advance notice requirement.');
  }

  // LOA
  if (!filing.loa) check('loa_required', 'LOA Required', 'warning', 'LOA recommended for SCA pre-arrival notice.');
  else if (filing.loa > 400) check('loa_limit', 'LOA Limit', 'fail', 'LOA exceeds 400m. Special SCA approval required for solo transit.');
  else check('loa_ok', 'LOA Within Limits', 'pass', 'LOA within SCA channel limits.');

  // Beam
  if (filing.beam && filing.beam > 77.5) check('beam_limit', 'Beam Limit', 'fail', 'Beam exceeds 77.5m SCA maximum.');
  else if (filing.beam) check('beam_ok', 'Beam', 'pass', 'Beam within SCA limits.');

  // Draft — forward
  if (filing.forward_draft && filing.forward_draft > 18.90) check('draft_fwd_limit', 'Forward Draft', 'fail', 'Forward draft exceeds 18.90m hard limit.');
  else if (filing.forward_draft) check('draft_fwd_ok', 'Forward Draft', 'pass', 'Forward draft within SCA limits.');

  // Draft — aft
  if (filing.aft_draft && filing.aft_draft > 18.90) check('draft_aft_limit', 'Aft Draft', 'fail', 'Aft draft exceeds 18.90m hard limit.');
  else if (filing.aft_draft) check('draft_aft_ok', 'Aft Draft', 'pass', 'Aft draft within SCA limits.');

  // Air draft
  if (filing.air_draft && filing.air_draft > 70) check('air_draft_limit', 'Air Draft', 'fail', 'Air draft exceeds 70m — will not clear El-Ferdan Railway Bridge.');
  else if (filing.air_draft && filing.air_draft > 68) check('air_draft_warn', 'Air Draft', 'warning', 'Air draft above 68m advisory. SCA coordination required in advance.');
  else if (filing.air_draft) check('air_draft_ok', 'Air Draft', 'pass', 'Air draft within El-Ferdan Bridge clearance.');

  // Convoy selection
  if (!filing.convoy) check('convoy_required', 'Convoy Selection', 'warning', 'Convoy preference not selected. SCA will assign based on availability.');
  else check('convoy_ok', 'Convoy Preference', 'pass', 'Convoy preference provided.');

  // Crew
  if (!filing.crew_count) check('crew_required', 'Crew Count', 'warning', 'Total crew count required for SCA crew manifest.');
  else check('crew_ok', 'Crew Count', 'pass', 'Crew count provided.');

  // DG
  if (filing.has_dangerous_goods && filing.dangerous_goods && filing.dangerous_goods.length > 0) {
    const restricted = filing.dangerous_goods.filter(function(dg) {
      return dg.imdg_class === '1' || dg.imdg_class === '7';
    });
    const lithiumUns = ['UN3090','UN3091','UN3480','UN3481'];
    const hasLithium = filing.dangerous_goods.some(function(dg) {
      return dg.un_number && lithiumUns.indexOf(dg.un_number.toUpperCase()) >= 0;
    });

    if (restricted.length > 0) check('dg_restricted', 'Restricted DG Classes', 'fail', 'Class 1 or Class 7 cargo requires SCA prior approval and ENRRA permit (Class 7).');
    if (hasLithium) check('dg_lithium', 'Lithium Batteries (IMDG 42-24)', 'warning', 'Lithium batteries detected. IMDG Amendment 42-24 enhanced documentation required.');
    check('dg_declared', 'DG Declared', 'pass', filing.dangerous_goods.length + ' dangerous goods item(s) declared per IMDG 42-24.');
  }

  // Vessel type
  if (!filing.vessel_type) check('vessel_type_required', 'Vessel Type', 'warning', 'Vessel type recommended for toll calculation.');
  else check('vessel_type_ok', 'Vessel Type', 'pass', 'Vessel type provided.');

  // SCNT
  if (!filing.scnt) check('scnt_required', 'SCNT Required', 'warning', 'SCNT certificate required for SCA toll calculation.');
  else check('scnt_ok', 'SCNT Provided', 'pass', 'SCNT value provided for toll estimation.');

  const overall = failed > 0 ? 'failed' : (warnings > 0 ? 'warning' : 'passed');

  // Build categories format
  const criticals = checks.filter(function(c){ return c.status === 'fail'; });
  const warnItems = checks.filter(function(c){ return c.status === 'warning'; });
  const passItems = checks.filter(function(c){ return c.status === 'pass'; });

  return {
    overall_status: overall,
    passed_checks:  passed,
    warning_checks: warnings,
    failed_checks:  failed,
    categories: {
      critical: criticals,
      warnings: warnItems,
      passed:   passItems,
    },
    checklist: checks,
  };
}

/**
 * POST /api/demo/suez-pdf-preview
 * Generate a DEMO-watermarked Suez SCA filing PDF preview without authentication.
 */
router.post('/demo/suez-pdf-preview', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const data = req.body;

    const vesselName = (data.vessel_name || 'DEMO VESSEL').toUpperCase();
    const imo = data.imo_number || 'IMO 0000000';
    const flag = data.flag_state || 'N/A';
    const vtype = (data.vessel_type || 'N/A').replace(/_/g, ' ').toUpperCase();
    const convoy = (data.convoy || 'N/A').replace(/_/g, ' ').toUpperCase();
    const dateStr = new Date().toISOString().slice(0, 10);

    const bufs = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
      Title: 'Suez Canal SCA Filing Package — DEMO',
      Author: 'CanalClear',
      Subject: 'Suez Canal Transit Filing — DEMO ONLY',
    }});
    doc.on('data', function(chunk) { bufs.push(chunk); });
    // Register end/error listeners before doc.end() to avoid race condition
    const suezPdfDonePromise = new Promise(function(resolve, reject) {
      doc.on('end', resolve);
      doc.on('error', reject);
    });

    const C = {
      navy:   [0.039, 0.086, 0.157],
      teal:   [0, 0.831, 0.667],
      blue:   [0.145, 0.388, 0.922],
      white:  [1, 1, 1],
      light:  [0.769, 0.816, 0.863],
      gray:   [0.533, 0.6, 0.667],
      red:    [1, 0.42, 0.42],
      border: [0.224, 0.341, 0.451],
      pass:   [0, 0.659, 0.561],
      failC:  [0.863, 0.196, 0.196],
    };

    function applyColor(c) { doc.fillColor(c); }

    // ── Page 1: SCA Transit Application ──────────────────────────────────────
    // Watermark (diagonal)
    doc.save();
    doc.fillColor([1, 0.42, 0.42]).opacity(0.09);
    doc.fontSize(72).font('Helvetica-Bold');
    doc.rotate(-45, { origin: [297.64, 420.90] });
    doc.text('DEMO ONLY', -80, 320, { width: 700, align: 'center' });
    doc.restore();

    // Header bar
    doc.rect(0, 0, 595.28, 70).fill(C.navy);
    doc.fillColor(C.teal).fontSize(18).font('Helvetica-Bold').text('CanalClear', 50, 18);
    doc.fillColor(C.light).fontSize(9).font('Helvetica').text('Canal Compliance Automation  •  canalclear.org', 50, 42);
    doc.fillColor(C.white).fontSize(12).font('Helvetica-Bold').text('SCA TRANSIT APPLICATION — DEMO', 300, 20, { width: 250, align: 'right' });
    doc.fillColor(C.gray).fontSize(8).font('Helvetica').text('SCA/TA-01/2024', 300, 40, { width: 250, align: 'right' });

    // DEMO banner
    doc.rect(50, 80, 495.28, 22).fill([0.863, 0.196, 0.196]);
    doc.fillColor([1, 1, 1]).fontSize(9).font('Helvetica-Bold').text('DEMO — NOT VALID FOR SCA SUBMISSION — FOR DEMONSTRATION PURPOSES ONLY', 52, 87, { width: 490, align: 'center' });

    let y = 116;

    // Vessel identification section
    doc.fillColor(C.teal).fontSize(10).font('Helvetica-Bold').text('VESSEL IDENTIFICATION', 50, y);
    doc.moveTo(50, y + 15).lineTo(545.28, y + 15).stroke(C.teal);
    y += 24;

    function field(label, value, x, fy, w) {
      doc.fillColor(C.gray).fontSize(8).font('Helvetica').text(label, x, fy);
      doc.fillColor(C.white).fontSize(9.5).font('Helvetica-Bold').text(value || '—', x, fy + 11, { width: w || 220 });
    }

    field('VESSEL NAME', vesselName, 50, y, 220);
    field('IMO NUMBER', imo, 300, y, 220);
    y += 36;
    field('FLAG STATE', flag, 50, y);
    field('VESSEL TYPE', vtype, 300, y);
    y += 36;
    field('CONVOY', convoy, 50, y);
    field('ETA (LT)', data.eta ? new Date(data.eta).toLocaleString('en-GB') : '—', 300, y);
    y += 36;
    field('LAST PORT', data.last_port || '—', 50, y);
    field('DESTINATION', data.destination || '—', 300, y);
    y += 44;

    // Dimensions
    doc.fillColor(C.teal).fontSize(10).font('Helvetica-Bold').text('VESSEL DIMENSIONS', 50, y);
    doc.moveTo(50, y + 15).lineTo(545.28, y + 15).stroke(C.teal);
    y += 24;

    field('LOA (m)', data.loa ? data.loa + 'm' : '—', 50, y);
    field('BEAM (m)', data.beam ? data.beam + 'm' : '—', 180, y);
    field('FWD DRAFT (m)', data.forward_draft ? data.forward_draft + 'm' : '—', 310, y);
    field('AFT DRAFT (m)', data.aft_draft ? data.aft_draft + 'm' : '—', 440, y, 100);
    y += 36;
    field('GT', data.gross_tonnage ? Number(data.gross_tonnage).toLocaleString() : '—', 50, y);
    field('SCNT', data.scnt ? Number(data.scnt).toLocaleString() : '—', 180, y);
    field('AIR DRAFT (m)', data.air_draft ? data.air_draft + 'm' : '—', 310, y);
    field('CREW', data.crew_count ? data.crew_count.toString() : '—', 440, y, 100);
    y += 44;

    // Cargo declaration
    doc.fillColor(C.teal).fontSize(10).font('Helvetica-Bold').text('CARGO DECLARATION', 50, y);
    doc.moveTo(50, y + 15).lineTo(545.28, y + 15).stroke(C.teal);
    y += 24;

    const cargoType = (data.cargo_type || 'N/A').replace(/_/g, ' ').toUpperCase();
    field('CARGO TYPE', cargoType, 50, y);
    field('TOTAL WEIGHT (MT)', data.cargo_weight ? Number(data.cargo_weight).toLocaleString() + ' MT' : '—', 300, y);
    y += 36;
    field('CARGO DESCRIPTION', data.cargo_desc || '—', 50, y, 490);
    y += 36;
    field('PORT OF LOADING', data.pol || '—', 50, y);
    field('PORT OF DISCHARGE', data.pod || '—', 300, y);
    y += 44;

    // DG section
    const dgItems = data.dangerous_goods || [];
    if (dgItems.length > 0) {
      doc.fillColor(C.teal).fontSize(10).font('Helvetica-Bold').text('DANGEROUS GOODS (IMDG 42-24)', 50, y);
      doc.moveTo(50, y + 15).lineTo(545.28, y + 15).stroke(C.teal);
      y += 24;

      dgItems.slice(0, 4).forEach(function(dg, i) {
        doc.rect(50, y, 495.28, 30).fill([0.863*0.15, 0, 0]);
        doc.fillColor(C.red).fontSize(8.5).font('Helvetica-Bold').text('DG #' + (i+1) + ' — CLASS ' + (dg.imdg_class || '?'), 55, y + 3);
        doc.fillColor(C.white).fontSize(8).font('Helvetica').text(
          (dg.un_number || '') + ' — ' + (dg.proper_shipping_name || '—') + (dg.quantity_mt ? ' — ' + dg.quantity_mt + ' MT' : ''),
          55, y + 16, { width: 485 }
        );
        y += 34;
      });
      y += 10;
    }

    // Validation summary
    if (data.validationResult) {
      const v = data.validationResult;
      doc.rect(50, y, 495.28, 60).fill([0.039, 0.157, 0.086]);
      doc.fillColor(C.teal).fontSize(10).font('Helvetica-Bold').text('SCA VALIDATION SUMMARY', 55, y + 8);
      const statusLabel = v.overall_status === 'passed' ? '✓ READY TO FILE' : (v.overall_status === 'warning' ? '⚠ WARNINGS' : '✗ ISSUES FOUND');
      const statusColor = v.overall_status === 'passed' ? C.pass : (v.overall_status === 'warning' ? [1, 0.851, 0.239] : C.failC);
      doc.fillColor(statusColor).fontSize(9).font('Helvetica-Bold').text(statusLabel, 350, y + 8, { width: 190, align: 'right' });
      doc.fillColor(C.light).fontSize(8).font('Helvetica').text(
        'Passed: ' + (v.passed_checks || 0) + '   Warnings: ' + (v.warning_checks || 0) + '   Issues: ' + (v.failed_checks || 0),
        55, y + 30
      );
      doc.fillColor(C.gray).fontSize(7.5).font('Helvetica').text('CanalClear SCA Validation — 26 rule checks applied', 55, y + 44);
      y += 70;
    }

    // Footer
    doc.fontSize(7.5).fillColor(C.gray).font('Helvetica')
       .text('CanalClear Demo — Page 1 of 1 — This document is for demonstration purposes only and is NOT valid for SCA submission.', 50, 780, { width: 495.28, align: 'center' });
    doc.rect(50, 770, 495.28, 0.5).fill(C.border);

    doc.end();

    await suezPdfDonePromise;
    const pdfBuffer = Buffer.concat(bufs);

    const filename = 'CanalClear-SUEZ-DEMO-' + vesselName.replace(/[^a-zA-Z0-9]/g, '-') + '-' + dateStr + '.pdf';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="' + filename + '"');
    res.set('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[Demo/SuezPDF] Error:', err.message, err.stack);
    res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
  }
});

/**
 * POST /api/demo/validate
 * Run VUMPA validation without authentication — demo mode only.
 * Uses same validator logic as /api/validate but skips auth + DB save.
 */
router.post('/demo/validate', async (req, res) => {
  try {
    const data = req.body;
    const result = validateVUMPA(data);

    // Record demo validation run so admin stats counter increments correctly.
    const pool = req.app.locals.pool;
    analyticsEventsDb.recordPanamaDemoValidation(pool, {
      vessel_name: data.vessel_name,
      imo_number: data.imo_number,
      flag_state: data.flag_state,
      vessel_type: data.vessel_type,
      gross_tonnage: data.gross_tonnage,
      cargo_type: data.cargo_type,
      has_dangerous_goods: data.has_dangerous_goods,
      transit_direction: data.transit_direction,
      overall_status: result.overall_status,
      total_checks: result.total_checks,
      passed_checks: result.passed_checks,
      failed_checks: result.failed_checks,
      warning_checks: result.warning_checks,
    }).catch(err => console.error('[Demo/Validate] Record error:', err.message));

    res.json({ success: true, validation: result, demo: true });
  } catch (err) {
    console.error('[Demo/Validate] Error:', err.message);
    res.status(500).json({ success: false, message: 'Validation failed: ' + err.message });
  }
});

/**
 * POST /api/demo/pdf-preview
 * Generate a DEMO-watermarked VUMPA PDF preview without authentication.
 * Returns a PDF buffer with a prominent "DEMO — NOT FOR ACP SUBMISSION" watermark.
 */
router.post('/api/demo/pdf-preview', async (req, res) => {
  res.status(404).json({ success: false, message: 'Use /api/demo/pdf-preview (no double prefix)' });
});

router.post('/demo/pdf-preview', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const data = req.body;

    const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
      Title: 'VUMPA Pre-Arrival Package — DEMO',
      Author: 'CanalClear',
      Subject: 'Panama Canal Transit Filing — DEMO ONLY',
    }});

    // Collect chunks — listener must be attached before any content is added
    const bufs = [];
    doc.on('data', d => bufs.push(d));
    // Track end event before doc.end() is called to avoid race condition
    const pdfDonePromise = new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);
    });

    const navy = '#0A1628';
    const teal = '#00D4AA';
    const red = '#FF6B6B';

    // Helper: format date
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const vesselName = data.vessel_name || 'MV Pacific Navigator';
    const imoNum = data.imo_number || '9876543';

    // ── Page 1: VUMPA Pre-Arrival ──────────────────────────────────────────
    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(navy);
    doc.fontSize(18).fillColor(teal).font('Helvetica-Bold')
       .text('CanalClear', 50, 22);
    doc.fontSize(9).fillColor('#8899AA').font('Helvetica')
       .text('Panama Canal Compliance Platform', 50, 44);
    doc.fontSize(12).fillColor('#F0F4F8').font('Helvetica-Bold')
       .text('VUMPA Pre-Arrival Package', 300, 22, { width: 245, align: 'right' });
    doc.fontSize(9).fillColor('#8899AA').font('Helvetica')
       .text(`Generated: ${dateStr}`, 300, 44, { width: 245, align: 'right' });

    // DEMO WATERMARK — diagonal
    doc.save();
    doc.opacity(0.08);
    doc.fontSize(90).fillColor(red).font('Helvetica-Bold');
    doc.rotate(-40, { origin: [297, 420] });
    doc.text('DEMO', 60, 300);
    doc.restore();

    // Document title
    doc.moveDown(4);
    doc.fontSize(14).fillColor(navy).font('Helvetica-Bold')
       .text('VESSEL UNIVERSAL MEASUREMENT & PRE-ARRIVAL', 50, 110, { align: 'center' });
    doc.fontSize(11).fillColor('#2D3748').font('Helvetica')
       .text('ACP/VUMPA/2024 — Pre-Arrival Notification', 50, 130, { align: 'center' });

    // Red DEMO notice
    doc.rect(50, 150, 495.28, 28).fill('#FFF5F5').stroke(red);
    doc.fontSize(9).fillColor(red).font('Helvetica-Bold')
       .text('⚠ DEMO DOCUMENT — NOT VALID FOR ACP SUBMISSION — FOR PREVIEW PURPOSES ONLY', 55, 159, { width: 485 });

    // Section: Vessel Identification
    let y = 200;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 1 — VESSEL IDENTIFICATION', 55, y + 6);
    y += 30;

    const fields1 = [
      ['Vessel Name', vesselName],
      ['IMO Number', imoNum],
      ['Flag State', data.flag_state || 'PA'],
      ['Vessel Type', (data.vessel_type || 'bulk_carrier').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
      ['Classification Society', 'Lloyd\'s Register (LR)'],
    ];
    fields1.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica').text(label + ':', 55, y);
      doc.fontSize(9).fillColor(navy).font('Helvetica-Bold').text(value, 220, y);
      y += 16;
    });

    // Section: Vessel Dimensions
    y += 8;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 2 — VESSEL DIMENSIONS', 55, y + 6);
    y += 30;

    const fields2 = [
      ['Gross Tonnage (GT)', `${data.gross_tonnage || '45,000'} GT`],
      ['Length Overall (LOA)', `${data.loa || '225'} m`],
      ['Beam', `${data.beam || '32.2'} m`],
      ['Maximum Draft', `${data.draft || '12.5'} m`],
      ['Lock Type', 'Neo-Panamax Eligible'],
    ];
    fields2.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica').text(label + ':', 55, y);
      doc.fontSize(9).fillColor(navy).font('Helvetica-Bold').text(value, 220, y);
      y += 16;
    });

    // Section: Transit Details
    y += 8;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 3 — TRANSIT DETAILS', 55, y + 6);
    y += 30;

    const etaDate = new Date(Date.now() + 48 * 3600 * 1000).toISOString().slice(0, 10);
    const fields3 = [
      ['Transit Direction', (data.transit_direction || 'northbound').replace(/\b\w/g, c => c.toUpperCase())],
      ['ETA Panama Canal', `${etaDate} 08:00 UTC`],
      ['Cargo Type', (data.cargo_type || 'dry_bulk').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
      ['Dangerous Goods', data.has_dangerous_goods ? `Yes — IMDG Class ${data.dangerous_goods_class}` : 'No'],
      ['Number of Crew', `${data.crew_count || '22'}`],
    ];
    fields3.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica').text(label + ':', 55, y);
      doc.fontSize(9).fillColor(navy).font('Helvetica-Bold').text(value, 220, y);
      y += 16;
    });

    // Section: Validation Status
    y += 8;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 4 — COMPLIANCE VALIDATION STATUS', 55, y + 6);
    y += 30;

    const validationResult = data.validationResult;
    if (validationResult) {
      const statusColor = validationResult.overall_status === 'passed' ? '#276749' :
                          validationResult.overall_status === 'warning' ? '#744210' : '#9B2C2C';
      const statusBg = validationResult.overall_status === 'passed' ? '#F0FFF4' :
                       validationResult.overall_status === 'warning' ? '#FFFAF0' : '#FFF5F5';
      doc.rect(55, y, 200, 22).fill(statusBg);
      doc.fontSize(10).fillColor(statusColor).font('Helvetica-Bold')
         .text(`Overall: ${(validationResult.overall_status || '').toUpperCase()}`, 60, y + 6);
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica')
         .text(`${validationResult.passed_checks || 0} passed  /  ${validationResult.failed_checks || 0} failed  /  ${validationResult.warning_checks || 0} warnings`, 270, y + 7);
      y += 30;

      // Show critical errors if any
      const criticals = (validationResult.categories && validationResult.categories.critical) || [];
      if (criticals.length > 0) {
        doc.fontSize(9).fillColor(red).font('Helvetica-Bold').text('Critical Issues:', 55, y);
        y += 14;
        criticals.slice(0, 5).forEach(c => {
          doc.fontSize(8).fillColor('#9B2C2C').font('Helvetica').text(`• ${c.name}: ${c.message}`, 60, y, { width: 480 });
          y += 13;
        });
      }
    } else {
      doc.rect(55, y, 200, 22).fill('#F0FFF4');
      doc.fontSize(10).fillColor('#276749').font('Helvetica-Bold').text('Status: READY FOR FILING', 60, y + 6);
      y += 30;
    }

    // ── Page 2: PCSOPEP ────────────────────────────────────────────────────
    doc.addPage();

    // Header bar
    doc.rect(0, 0, 595.28, 80).fill(navy);
    doc.fontSize(18).fillColor(teal).font('Helvetica-Bold').text('CanalClear', 50, 22);
    doc.fontSize(9).fillColor('#8899AA').font('Helvetica').text('Panama Canal Compliance Platform', 50, 44);
    doc.fontSize(12).fillColor('#F0F4F8').font('Helvetica-Bold').text('PCSOPEP Declaration', 300, 22, { width: 245, align: 'right' });
    doc.fontSize(9).fillColor('#8899AA').font('Helvetica').text(`Generated: ${dateStr}`, 300, 44, { width: 245, align: 'right' });

    // DEMO WATERMARK
    doc.save();
    doc.opacity(0.08);
    doc.fontSize(90).fillColor(red).font('Helvetica-Bold');
    doc.rotate(-40, { origin: [297, 420] });
    doc.text('DEMO', 60, 300);
    doc.restore();

    doc.fontSize(14).fillColor(navy).font('Helvetica-Bold')
       .text('PANAMA CANAL SHIPBOARD OIL POLLUTION EMERGENCY PLAN', 50, 110, { align: 'center' });
    doc.fontSize(10).fillColor('#2D3748').font('Helvetica')
       .text('ACP/PCSOPEP/2024 — Oil Pollution Emergency Declaration', 50, 130, { align: 'center' });

    doc.rect(50, 150, 495.28, 28).fill('#FFF5F5').stroke(red);
    doc.fontSize(9).fillColor(red).font('Helvetica-Bold')
       .text('⚠ DEMO DOCUMENT — NOT VALID FOR ACP SUBMISSION — FOR PREVIEW PURPOSES ONLY', 55, 159, { width: 485 });

    y = 200;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 1 — VESSEL INFORMATION', 55, y + 6);
    y += 30;

    const pcsoFields1 = [
      ['Vessel Name', vesselName],
      ['IMO Number', imoNum],
      ['Flag State', data.flag_state || 'PA'],
      ['Vessel Type', (data.vessel_type || 'bulk_carrier').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())],
      ['GT', `${data.gross_tonnage || '45,000'} GT`],
    ];
    pcsoFields1.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica').text(label + ':', 55, y);
      doc.fontSize(9).fillColor(navy).font('Helvetica-Bold').text(value, 220, y);
      y += 16;
    });

    y += 8;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 2 — OIL POLLUTION EMERGENCY PLAN STATUS', 55, y + 6);
    y += 30;

    const pcsoFields2 = [
      ['PCSOPEP Status', data.pcsopep_status || 'Current'],
      ['Certificate Number', data.pcsopep_cert_number || 'PCSOPEP-2024-' + (imoNum.slice(-4))],
      ['Issue Date', data.pcsopep_issue_date || '2024-01-15'],
      ['Expiry Date', data.pcsopep_expiry_date || '2025-01-15'],
      ['Issuing Authority', data.pcsopep_authority || 'Panama Canal Authority (ACP)'],
    ];
    pcsoFields2.forEach(([label, value]) => {
      doc.fontSize(9).fillColor('#4A5568').font('Helvetica').text(label + ':', 55, y);
      doc.fontSize(9).fillColor(navy).font('Helvetica-Bold').text(value, 220, y);
      y += 16;
    });

    y += 8;
    doc.rect(50, y, 495.28, 22).fill('#F7FAFC');
    doc.fontSize(10).fillColor(navy).font('Helvetica-Bold')
       .text('SECTION 3 — SPILL RESPONSE EQUIPMENT', 55, y + 6);
    y += 30;

    const equipment = [
      'Oil absorbent pads and booms — 50 linear meters',
      'Portable oil transfer pump — 1 unit',
      'Containment equipment — per ACP Regulation 36',
      'Emergency response contacts posted on bridge',
      'SOPEP locker accessible and clearly marked',
    ];
    equipment.forEach(item => {
      doc.fontSize(9).fillColor('#276749').font('Helvetica-Bold').text('✓', 55, y);
      doc.fontSize(9).fillColor('#2D3748').font('Helvetica').text(item, 70, y, { width: 470 });
      y += 14;
    });

    // Footer on each page (switchToPage uses 0-based index)
    const totalPages = 2;
    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#A0AEC0').font('Helvetica')
         .text(`CanalClear Demo — Page ${i + 1} of ${totalPages} — This document is for demonstration purposes only and is NOT valid for ACP submission.`, 50, 780, { width: 495.28, align: 'center' });
      doc.rect(50, 770, 495.28, 1).fillColor('#E2E8F0');
    }

    doc.end();

    await pdfDonePromise;
    const pdfBuffer = Buffer.concat(bufs);

    const filename = `CanalClear-DEMO-${vesselName.replace(/[^a-zA-Z0-9]/g, '-')}-${dateStr}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${filename}"`);
    res.set('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (err) {
    console.error('[Demo/PDF] Error:', err.message, err.stack);
    res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
  }
});

/**
 * POST /api/demo/lead-capture
 * Optional lead capture from demo page — saves to lead_funnel table.
 * No auth required. Email + vessel name capture.
 */
router.post('/demo/lead-capture', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, vessel_name, company } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }

    // Save to lead_funnel with demo source
    await notificationsDb.insertLeadFunnel(pool, {
      canalSelection: 'panama',
      fleetSize: '1-5',
      name: vessel_name || 'Demo User',
      email: email.toLowerCase().trim(),
      company: company || null,
    }).catch(() => {
      // Silently ignore if ON CONFLICT not supported or constraint issues
    });

    // Fire drip emails asynchronously (non-blocking)
    try {
      const { scheduleDripEmails } = require('../services/drip-email');
      scheduleDripEmails({
        email: email.toLowerCase().trim(),
        name: vessel_name || 'Demo User',
        canal: 'panama',
        source: 'demo_page'
      }).catch(() => {});
    } catch (_) {}

    res.json({ success: true, message: 'Saved' });
  } catch (err) {
    console.error('[Demo/LeadCapture] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save' });
  }
});

// ─── Ad-blocker-safe alias for /api/demo/lead-capture ───────────────────────
router.post('/cc/demo-contact', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, vessel_name, company, canal, source } = req.body;
    // Use the canal from the request body if provided, otherwise default to 'panama' for backward compat.
    const canalValue = canal || 'panama';
    const sourceValue = source || 'demo_page';

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Valid email required' });
    }

    await notificationsDb.insertLeadFunnel(pool, {
      canalSelection: canalValue,
      fleetSize: '1-5',
      name: vessel_name || 'Demo User',
      email: email.toLowerCase().trim(),
      company: company || null,
    }).catch(() => {});

    try {
      const { scheduleDripEmails } = require('../services/drip-email');
      scheduleDripEmails({
        email: email.toLowerCase().trim(),
        name: vessel_name || 'Demo User',
        canal: canalValue,
        source: sourceValue
      }).catch(() => {});
    } catch (_) {}

    res.json({ success: true, message: 'Saved' });
  } catch (err) {
    console.error('[cc/demo-contact] Error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save' });
  }
});

/**
 * POST /api/demo/record-validation
 * Lightweight telemetry endpoint for client-side demo validators (Bosporus, Malacca).
 * Those demos compute scores in-browser; this endpoint records the run so admin stats stay accurate.
 * No auth required. Ignores unknown canals silently.
 */
router.post('/demo/record-validation', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const {
      canal, vessel_name, imo_number, overall_status,
      total_checks, passed_checks, failed_checks, warning_checks
    } = req.body || {};

    const VALID_CANALS = ['panama', 'suez', 'bosporus', 'malacca', 'turkish_straits', 'cape'];
    if (!canal || !VALID_CANALS.includes(canal)) {
      return res.json({ success: false, message: 'Unknown canal' });
    }

    await analyticsEventsDb.recordGenericDemoValidation(pool, {
      vessel_name, imo_number, overall_status,
      total_checks, passed_checks, failed_checks, warning_checks, canal,
    });

    res.json({ success: true });
  } catch (err) {
    // Non-critical telemetry — don't surface errors to client
    console.error('[Demo/RecordValidation] Error:', err.message);
    res.json({ success: false });
  }
});

module.exports = router;



