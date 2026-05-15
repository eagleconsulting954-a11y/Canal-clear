/**
 * CanalClear — Express entry point (wiring only).
 * Owns: middleware setup, route mounting, app.listen.
 * Does NOT own: route handlers, business logic, background tasks.
 */
const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const apiRoutes              = require('./routes/api');
const adminRoutes            = require('./routes/admin');
const bosporusRoutes         = require('./routes/bosporus');
const malaccaRoutes          = require('./routes/malacca');
const capeRoutes             = require('./routes/cape');
const voyageRoutes           = require('./routes/voyage');
const pricingSlotsRoutes     = require('./routes/pricing-slots');
const deadlineAlertsRoutes   = require('./routes/deadline-alerts');
const directFilingRoutes     = require('./routes/direct-filing');
const integrationsRoutes     = require('./routes/integrations');
const tmsImportRoutes        = require('./routes/tms-import');
const geofenceRoutes         = require('./routes/geofence');
const aisRoutes              = require('./routes/ais');
const fleetRoutes            = require('./routes/fleet');
const fleetOpsRoutes         = require('./routes/fleet-ops');
const batchRoutes            = require('./routes/batch');
const statusRoutes           = require('./routes/status');
const ssoRoutes              = require('./routes/sso');
const rbacRoutes             = require('./routes/rbac');
const pageRoutes             = require('./routes/pages');
const contentRoutes          = require('./routes/content');
const assetRoutes            = require('./routes/assets');
const { trackPageView } = require('./middleware/analytics');
const { seedAdminFromEnv } = require('./middleware/auth');
const {
  ensurePasswordResetsTable,
  startAlertScheduler,
  startDripScheduler,
  startIspsAlertScheduler,
  startDeadlineAlertScheduler,
  startGeofenceScheduler,
  generateFounderPortrait,
  generateMissingBlogAudio,
  generateMissingPodcastAudio,
  pingIndexNow,
} = require('./services/startup');
const { startAisScheduler } = require('./services/ais-provider');
const approvalWorkflowRoutes = require('./routes/approval-workflow');
const agentDashboardRoutes   = require('./routes/agent-dashboard');
const onboardingRoutes       = require('./routes/onboarding');
const vesselLimitsRoutes     = require('./routes/vessel-limits');
const demoRoutes             = require('./routes/demo');
const demoRequestRoutes      = require('./routes/demo-request');
const calculatorRoutes       = require('./routes/calculator');
const vesselManagementRoutes = require('./routes/vessel-management');
const validatorRoutes        = require('./routes/validator');
const scaRoutes              = require('./routes/sca');
const vumpaRoutes            = require('./routes/vumpa');
const submissionsRoutes      = require('./routes/submissions');
const mpaRoutes              = require('./routes/mpa');
const portalsRoutes          = require('./routes/portals');

const app = express();
const port = process.env.PORT || 3000;

// Trust Render's reverse proxy — required for correct req.protocol, req.secure,
// and proper Secure cookie handling behind HTTPS load balancer.
app.set('trust proxy', 1);

// Fail fast if DATABASE_URL is missing
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

app.locals.pool = pool;

app.use(express.json());
app.use(cookieParser());

// ── Anonymous session ID middleware ───────────────────────────────────────────
app.use((req, res, next) => {
  if (!req.cookies || !req.cookies.cc_sid) {
    const sid = crypto.randomUUID();
    res.cookie('cc_sid', sid, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: false,
      sameSite: 'Lax',
      path: '/',
    });
    req.cookies = req.cookies || {};
    req.cookies.cc_sid = sid;
  }
  next();
});

// Redirect www → apex domain
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.startsWith('www.')) {
    const apex = host.slice(4);
    return res.redirect(301, `https://${apex}${req.originalUrl}`);
  }
  next();
});

// Page view tracking
app.use(trackPageView);

// Health check (required for Render)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ── SEO 301 redirects — keyword cannibalization consolidation ────────────────
const BLOG_REDIRECTS = {
  '/blog/how-to-file-vumpa-panama-canal': '/blog/vumpa-filing-requirements-step-by-step',
  '/blog/vumpa-digital-submission-guide-2026': '/blog/vumpa-filing-requirements-step-by-step',
  '/blog/panama-canal-vumpa-requirements-2026': '/blog/vumpa-filing-requirements-step-by-step',
  '/blog/lng-tanker-panama-canal-transit-documents': '/blog/panama-canal-transit-documents-lng-tankers',
  '/blog/panama-canal-non-compliance-costs-penalties': '/blog/panama-canal-non-compliance-cost',
  '/blog/pcsopep-requirements-2026': '/blog/pcsopep-documentation-complete-guide',
  '/blog/pcsopep-requirements-panama-canal': '/blog/pcsopep-documentation-complete-guide',
  '/blog/how-to-file-pcsopep-panama-canal': '/blog/pcsopep-documentation-complete-guide',
  '/blog/pcsopep-certificate-requirements-panama-canal-2026': '/blog/pcsopep-documentation-complete-guide',
  '/blog/panama-canal-compliance-checklist-2026': '/blog/panama-canal-compliance-complete-guide-2026',
  '/blog/panama-canal-compliance-checklist-fleet-operators': '/blog/panama-canal-compliance-complete-guide-2026',
};

app.use((req, res, next) => {
  const target = BLOG_REDIRECTS[req.path];
  if (target) return res.redirect(301, target);
  next();
});

// ── Route mounting ───────────────────────────────────────────────────────────
app.use(assetRoutes);                     // /images/*, /assets/*
app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));
app.use('/api', apiRoutes);                          // /api/*
app.use('/api', adminRoutes);                        // /api/admin/*, /api/compliance-score*
app.use('/api/bosporus', bosporusRoutes);            // /api/bosporus/* (SP-1 filing engine)
app.use('/api/malacca', malaccaRoutes);              // /api/malacca/* (STRAITREP filing engine)
app.use('/api/cape', capeRoutes);                    // /api/cape/* (Cape of Good Hope ISPS filing)
app.use('/api/voyage', voyageRoutes);                // /api/voyage/* (unified voyage planner)
app.use('/api/pricing-slots', pricingSlotsRoutes);   // /api/pricing-slots (founding counter)
app.use('/api', deadlineAlertsRoutes);               // /api/alerts/*, /api/admin/alerts/*
app.use('/api/direct-filing', directFilingRoutes);   // /api/direct-filing/waitlist
app.use('/api/integrations', integrationsRoutes);    // /api/integrations/waitlist, /request
app.use('/api/tms-import', tmsImportRoutes);         // /api/tms-import/* (TMS universal import layer)
app.use('/api/ais', aisRoutes);                      // /api/ais/* (AIS vessel tracking from DB)
app.use('/api/fleet', fleetRoutes);                 // /api/fleet/* (fleet tracking mock: positions, tracks, geofences)
app.use('/api/fleet-ops', fleetOpsRoutes);          // /api/fleet-ops/* (fleet ops dashboard: KPIs, heatmap, calendar)
app.use('/api/geofence', geofenceRoutes);            // /api/geofence/* (canal geofence zones + events)
app.use('/api/batch', batchRoutes);                 // /api/batch/* (multi-vessel batch filing)
app.use('/api/status', statusRoutes);                // /api/status (service health)
app.use('/api/sso', ssoRoutes);                      // /api/sso/* (SAML 2.0 + OIDC SSO)
app.use('/api/workflow', approvalWorkflowRoutes);    // /api/workflow/* (filing approval workflow + notifications)
app.use('/api/agent-dashboard', agentDashboardRoutes); // /api/agent-dashboard/* (agent KPIs, client portfolio)
app.use('/api/onboarding', onboardingRoutes);          // /api/onboarding/* (guided first-filing wizard state)
app.use('/api/vessel-limits', vesselLimitsRoutes);     // /api/vessel-limits/* (agency vessel tier enforcement)
app.use('/api/demo', demoRoutes);                      // /api/demo/* (demo access code system)
app.use('/api/demo-request', demoRequestRoutes);       // /api/demo-request/* (self-serve demo request flow)
app.use('/api/calculator', calculatorRoutes);          // /api/calculator/* (rejection exposure calculator lead capture)
app.use('/api/vessels', vesselManagementRoutes);       // /api/vessels/* (fleet vessel management + compliance)
app.use('/api/validate', validatorRoutes);             // /api/validate/:waterway (compliance validator for all 5 waterways)
app.use('/api/sca', scaRoutes);                       // /api/sca/* (SCA E-Services portal integration: credentials + submissions)
app.use('/api/vumpa', vumpaRoutes);                   // /api/vumpa/* (ACP VUMPA portal integration: credentials + submissions)
app.use('/api/submissions', submissionsRoutes);        // /api/submissions/* (submission attempt audit log + admin viewer)
app.use('/api/mpa', mpaRoutes);                       // /api/mpa/* (MPA digitalPORT@SG / OCEANS-X integration: credentials + enrichment + submissions)
app.use('/api/portals', portalsRoutes);               // /api/portals/reachability (server-side portal HEAD checks + 60s cache)
app.use(pageRoutes);                      // /, /pricing, /login, etc.
app.use(contentRoutes);                   // /podcast/*, /blog/*, /glossary, /compliance/*

// ── Server startup ──────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`CanalClear running on port ${port}`);
  ensurePasswordResetsTable(pool);
  seedAdminFromEnv(pool);
  generateMissingBlogAudio(pool).catch(err =>
    console.error('[Blog Audio] Auto-generation error:', err.message)
  );
  generateMissingPodcastAudio(pool).catch(err =>
    console.error('[Podcast Audio] Auto-generation error:', err.message)
  );
  startAlertScheduler(pool);
  startDripScheduler(pool);
  startIspsAlertScheduler(pool);
  startDeadlineAlertScheduler(pool);
  startGeofenceScheduler(pool);
  startAisScheduler(pool).catch(err =>
    console.error('[AIS] Scheduler startup error:', err.message)
  );
  generateFounderPortrait(pool).catch(err =>
    console.error('[Founder Portrait] Error:', err.message)
  );
  const { ensureVumpaChecklistPDF } = require('./services/vumpa-checklist-pdf');
  ensureVumpaChecklistPDF(pool).catch(err =>
    console.error('[VUMPA Checklist] Startup error:', err.message)
  );
  const { ensureSuezDeadlineCheatsheetPDF } = require('./services/suez-deadline-cheatsheet-pdf');
  ensureSuezDeadlineCheatsheetPDF(pool).catch(err =>
    console.error('[Suez Cheatsheet] Startup error:', err.message)
  );
  const { ensureSuezConvoyTimelinePDF } = require('./services/suez-convoy-timeline-pdf');
  ensureSuezConvoyTimelinePDF(pool).catch(err =>
    console.error('[Suez Timeline PDF] Startup error:', err.message)
  );
  const { ensureBosporusPrimerPDF } = require('./services/bosporus-primer-pdf');
  ensureBosporusPrimerPDF(pool).catch(err =>
    console.error('[Bosporus Primer] Startup error:', err.message)
  );
  const { ensurePanamaVumpaPrimerPDF } = require('./services/panama-primer-pdf');
  ensurePanamaVumpaPrimerPDF(pool).catch(err =>
    console.error('[Panama Primer] Startup error:', err.message)
  );
  const { ensureSuezScaPrimerPDF } = require('./services/suez-primer-pdf');
  ensureSuezScaPrimerPDF(pool).catch(err =>
    console.error('[Suez Primer] Startup error:', err.message)
  );
  setTimeout(() => pingIndexNow(), 5000);

  // Vessel limit notification job — runs hourly, sends day-1/day-5/day-7 emails
  // to agency users over their tier limit during the 7-day grace period.
  const { runLimitNotificationJob } = require('./services/vessel-limit-service');
  const VESSEL_LIMIT_JOB_INTERVAL = 60 * 60 * 1000; // every hour
  setTimeout(() => {
    runLimitNotificationJob(pool).catch(err =>
      console.error('[VesselLimit] Notification job error:', err.message)
    );
    setInterval(() => {
      runLimitNotificationJob(pool).catch(err =>
        console.error('[VesselLimit] Notification job error:', err.message)
      );
    }, VESSEL_LIMIT_JOB_INTERVAL);
  }, 2 * 60 * 1000); // first run 2 min after startup
});
