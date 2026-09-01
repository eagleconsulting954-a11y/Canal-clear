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
const stripeWebhookRoutes    = require('./routes/stripe-webhooks');
const complianceInfrastructureRoutes = require('./routes/compliance-infrastructure');
const complianceOperationsRoutes = require('./routes/compliance-operations');
const complianceInfrastructurePageRoutes = require('./routes/compliance-infrastructure-page');

const app = express();
const port = process.env.PORT || 3000;

const BASE_URL = process.env.BASE_URL || 'https://canalclear.org';
app.locals.BASE_URL = BASE_URL;
app.set('trust proxy', 1);

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});
app.locals.pool = pool;

app.use('/api/webhooks/stripe', stripeWebhookRoutes);
app.use(express.json());
app.use(cookieParser());

app.use((req, res, next) => {
  if (!req.cookies || !req.cookies.cc_sid) {
    const sid = crypto.randomUUID();
    res.cookie('cc_sid', sid, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false, sameSite: 'Lax', path: '/' });
    req.cookies = req.cookies || {};
    req.cookies.cc_sid = sid;
  }
  next();
});

app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (host.startsWith('www.')) return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  next();
});

app.use(trackPageView);
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

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

app.use(assetRoutes);
app.use(express.static(path.join(__dirname, 'public'), { redirect: false, index: 'index.html' }));
app.use('/api', apiRoutes);
app.use('/api', adminRoutes);
app.use('/api/bosporus', bosporusRoutes);
app.use('/api/malacca', malaccaRoutes);
app.use('/api/cape', capeRoutes);
app.use('/api/voyage', voyageRoutes);
app.use('/api/pricing-slots', pricingSlotsRoutes);
app.use('/api', deadlineAlertsRoutes);
app.use('/api/direct-filing', directFilingRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/tms-import', tmsImportRoutes);
app.use('/api/ais', aisRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/fleet-ops', fleetOpsRoutes);
app.use('/api/geofence', geofenceRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/sso', ssoRoutes);
app.use('/api/workflow', approvalWorkflowRoutes);
app.use('/api/agent-dashboard', agentDashboardRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/vessel-limits', vesselLimitsRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/demo-request', demoRequestRoutes);
app.use('/api/calculator', calculatorRoutes);
app.use('/api/vessels', vesselManagementRoutes);
app.use('/api/validate', validatorRoutes);
app.use('/api/sca', scaRoutes);
app.use('/api/vumpa', vumpaRoutes);
app.use('/api/submissions', submissionsRoutes);
app.use('/api/mpa', mpaRoutes);
app.use('/api/portals', portalsRoutes);
app.use('/api/compliance-infrastructure', complianceInfrastructureRoutes);
app.use('/api/compliance-infrastructure', complianceOperationsRoutes);
app.use(complianceInfrastructurePageRoutes);
app.use(pageRoutes);
app.use(contentRoutes);

app.listen(port, () => {
  console.log(`CanalClear running on port ${port}`);
  ensurePasswordResetsTable(pool);
  seedAdminFromEnv(pool);
  generateMissingBlogAudio(pool).catch(err => console.error('[Blog Audio] Auto-generation error:', err.message));
  generateMissingPodcastAudio(pool).catch(err => console.error('[Podcast Audio] Auto-generation error:', err.message));
  startAlertScheduler(pool);
  startDripScheduler(pool);
  startIspsAlertScheduler(pool);
  startDeadlineAlertScheduler(pool);
  startGeofenceScheduler(pool);
  startAisScheduler(pool).catch(err => console.error('[AIS] Scheduler startup error:', err.message));
  generateFounderPortrait(pool).catch(err => console.error('[Founder Portrait] Error:', err.message));

  const { ensureVumpaChecklistPDF } = require('./services/vumpa-checklist-pdf');
  ensureVumpaChecklistPDF(pool).catch(err => console.error('[VUMPA Checklist] Startup error:', err.message));
  const { ensureSuezDeadlineCheatsheetPDF } = require('./services/suez-deadline-cheatsheet-pdf');
  ensureSuezDeadlineCheatsheetPDF(pool).catch(err => console.error('[Suez Cheatsheet] Startup error:', err.message));
  const { ensureSuezConvoyTimelinePDF } = require('./services/suez-convoy-timeline-pdf');
  ensureSuezConvoyTimelinePDF(pool).catch(err => console.error('[Suez Timeline PDF] Startup error:', err.message));
  const { ensureBosporusPrimerPDF } = require('./services/bosporus-primer-pdf');
  ensureBosporusPrimerPDF(pool).catch(err => console.error('[Bosporus Primer] Startup error:', err.message));
  const { ensurePanamaVumpaPrimerPDF } = require('./services/panama-primer-pdf');
  ensurePanamaVumpaPrimerPDF(pool).catch(err => console.error('[Panama Primer] Startup error:', err.message));
  const { ensureSuezScaPrimerPDF } = require('./services/suez-primer-pdf');
  ensureSuezScaPrimerPDF(pool).catch(err => console.error('[Suez Primer] Startup error:', err.message));
  setTimeout(() => pingIndexNow(), 5000);

  const { runLimitNotificationJob } = require('./services/vessel-limit-service');
  const VESSEL_LIMIT_JOB_INTERVAL = 60 * 60 * 1000;
  setTimeout(() => {
    runLimitNotificationJob(pool).catch(err => console.error('[VesselLimit] Notification job error:', err.message));
    setInterval(() => {
      runLimitNotificationJob(pool).catch(err => console.error('[VesselLimit] Notification job error:', err.message));
    }, VESSEL_LIMIT_JOB_INTERVAL);
  }, 2 * 60 * 1000);
});