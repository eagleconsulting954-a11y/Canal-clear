/**
 * Page routes — serves all HTML pages (public and protected).
 * Owns: page-serving GET routes for landing pages, auth pages, product pages,
 *       demo pages, admin pages, lead magnets, protected app pages.
 * Does NOT own: API endpoints (routes/api.js), asset serving (routes/assets.js),
 *               content routes with dynamic slugs (routes/content.js).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { requireAuth, requireSubscription, requireAdmin, requireAgentPlan, requireOpsPlan } = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');

// Landing page — express.static at / already serves public/index.html for /
// via the index option. This explicit route adds __POLSIA_SLUG__ replacement.
router.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, '..', 'public', 'index.html');

  if (!fs.existsSync(htmlPath)) {
    res.status(503).json({ message: 'index.html not found — run npm run build' });
    return;
  }

  const slug = process.env.POLSIA_ANALYTICS_SLUG || '';
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace('__POLSIA_SLUG__', slug);
  res.type('html').send(html);
});

// Auth pages (public)
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
router.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'signup.html'));
});
router.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'forgot-password.html'));
});
router.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reset-password.html'));
});

// Pricing / paywall (public)
router.get('/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'pricing.html'));
});

// Rejection Exposure Calculator (public lead-gen)
router.get('/calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'calculator.html'));
});

// Compliance Risk Calculator — simplified 3-input Panama Canal risk tool (public, shareable)
router.get('/tools/compliance-risk', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compliance-risk.html'));
});

// Transparency / technology explainer (public)
router.get('/how-it-works', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'how-it-works.html'));
});

// Authority integration status — per-authority submission method + live badges (public)
router.get('/authorities', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'authorities.html'));
});

// Compliance Validator — all 5 waterways (public, no login required)
router.get('/validator', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'validator.html'));
});

// Legal pages (public)
router.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
router.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});
router.get('/security', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'security.html'));
});
router.get('/developers', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'developers.html'));
});
router.get('/developer-portal', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'developer-portal.html'));
});

// Sales funnel — conversion-optimised linear flow
router.get('/funnel', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'funnel.html'));
});
router.get('/funnel/solution', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'funnel-solution.html'));
});
router.get('/funnel/roi', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'funnel-roi.html'));
});
router.get('/funnel/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'funnel-pricing.html'));
});

// Welcome page (post-payment account setup)
router.get('/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'welcome.html'));
});

// Guided onboarding wizard (protected — auth only, no subscription required)
router.get('/onboarding', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'onboarding.html'));
});

// TMS Import — universal data import layer (auth required, subscription not required for upload step)
router.get('/tms-import', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'tms-import.html'));
});

// PROTECTED: App dashboard + filing wizard
// Demo sessions can access these pages without a paid subscription.
router.get('/app', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'app.html'));
});

// PROTECTED: Authority Login Portal Hub — one-stop access to all waterway authority portals
router.get('/app/portals', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'portals.html'));
});

// PROTECTED: Fleet Management dashboard — vessel list + per-waterway compliance
router.get('/app/fleet', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'fleet.html'));
});

// PROTECTED: Vessel detail page — particulars + compliance + recent filings
router.get('/app/fleet/:id', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'vessel-detail.html'));
});

router.get('/filing', attachDemoSession, requireAuthOrDemo, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'filing.html'));
});

// Lead magnet landing pages (/get/*) — standalone, no nav
router.get('/get/suez-cheatsheet', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'suez-cheatsheet.html'));
});
router.get('/get/panama-primer', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'panama-primer.html'));
});
router.get('/get/suez-primer', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'suez-primer.html'));
});
router.get('/get/bosporus-primer', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'bosporus-primer.html'));
});
router.get('/get/cape-compliance-guide', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'cape-compliance-guide.html'));
});
router.get('/get/malacca-primer', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'malacca-primer.html'));
});
router.get('/get/cape-primer', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'cape-primer.html'));
});
router.get('/get/calculator', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get', 'calculator.html'));
});
router.get('/get/vumpa-checklist', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'get-vumpa-checklist.html'));
});

// Legacy lead magnet redirects — old URLs referenced by blog posts and bookmarks
router.get('/get/suez-deadline-cheatsheet', (req, res) => res.redirect(301, '/get/suez-cheatsheet'));
router.get('/get/suez-convoy-calculator', (req, res) => res.redirect(301, '/get/calculator'));

// Integrations "Coming Soon" page (public — waitlist-driven)
router.get('/integrations', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'integrations.html'));
});

// Direct Authority Filing waitlist page (public — coming-soon feature preview)
router.get('/direct-filing', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'direct-filing.html'));
});

// Public status page (enterprise trust signal — no auth required)
router.get('/status', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'status.html'));
});

// Canal product pages (public — SEO/lead gen)
router.get('/panama', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'panama.html'));
});
router.get('/suez', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'suez.html'));
});
router.get('/bosporus', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'bosporus.html'));
});
router.get('/malacca', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'malacca.html'));
});
router.get('/strait-of-malacca', (req, res) => {
  res.redirect(301, '/malacca');
});
router.get('/cape-of-good-hope', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cape-of-good-hope.html'));
});
router.get('/cape', (req, res) => {
  res.redirect(301, '/cape-of-good-hope');
});

// PROTECTED: Suez tools
router.get('/suez-calculator', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'suez-calculator.html'));
});
router.get('/suez/convoy', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'suez-convoy.html'));
});
router.get('/suez/notifications', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'suez-notifications.html'));
});

// PROTECTED: ACP Auto-Filing
router.get('/acp', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'acp.html'));
});

// PROTECTED: SCA E-Services Integration — connect Suez Canal Authority portal account
router.get('/sca-connect', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'sca-connect.html'));
});

// PROTECTED: ACP VUMPA Integration — connect Panama Canal VUMPA portal account
router.get('/vumpa-connect', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'vumpa-connect.html'));
});

// PROTECTED: Alert settings + Fleet Dashboard
router.get('/settings/alerts', requireAuth, requireSubscription, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'settings-alerts.html'));
});
router.get('/dashboard', requireAuth, requireSubscription, (req, res) => {
  const plan = req.dbUser && req.dbUser.plan_type;
  if (plan === 'agent_pro') return res.redirect('/agent-dashboard');
  if (plan === 'ops_manager') return res.redirect('/fleet-ops');
  // free/trial — show default dashboard
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});
// PROTECTED: Fleet Ops Dashboard (vessel-centric view for fleet operators)
router.get('/fleet-ops', requireAuth, requireSubscription, requireOpsPlan, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'fleet-ops.html'));
});

// Client workspace management (auth required, subscription not checked — agents can manage clients without active filing sub)
router.get('/clients', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'clients.html'));
});

// Admin dashboard — requires admin role, serves admin panel (not a plan-based redirect)
router.get('/admin', requireAuth, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});
router.get('/admin/analytics', async (req, res) => {
  const adminToken = process.env.ANALYTICS_ADMIN_TOKEN;
  const provided = req.query.token || req.headers['x-admin-token'];
  if (adminToken && provided !== adminToken) {
    return res.status(401).send('<h1>Unauthorized</h1><p>Provide ?token=YOUR_TOKEN</p>');
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-analytics.html'));
});

// Voyage planner (public demo + protected app)
router.get('/voyage', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'voyage-planner.html'));
});
router.get('/demo/voyage', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'voyage-planner.html'));
});

// Fleet tracking dashboard (public — uses mock AIS data; upgrade prompt for live feed)
router.get('/fleet/tracking', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'fleet-tracking.html'));
});

// Self-serve demo request form (public — top of funnel)
router.get('/request-demo', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'request-demo.html'));
});
router.get('/request-demo/thanks', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'request-demo-thanks.html'));
});

// Demo pages (public — no auth)
router.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
});
router.get('/demo/panama', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-panama.html'));
});
router.get('/demo/suez', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-suez.html'));
});
router.get('/demo/bosporus', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-bosporus.html'));
});
router.get('/demo/malacca', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-malacca.html'));
});
router.get('/demo/cape', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-cape.html'));
});
router.get('/demo/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo-dashboard.html'));
});

// Content hub pages
router.get('/guide', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'guide.html'));
});
router.get('/compare', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compare.html'));
});
router.get('/compliance-guide', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compliance-guide.html'));
});
router.get('/knowledge-base', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'knowledge-base.html'));
});
router.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about.html'));
});
router.get('/about/francis', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'about', 'francis.html'));
});
router.get('/compliance-score', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compliance-score.html'));
});
router.get('/hazmat', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'hazmat.html'));
});
router.get('/case-study', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'case-study.html'));
});

// Onboarding (requires auth but NOT subscription)
router.get('/onboarding', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'onboarding.html'));
});

// Filing approval review + pending approvals list (auth required)
router.get('/approval-review', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'approval-review.html'));
});

// PROTECTED: Agent Dashboard — client-centric view for shipping agents
router.get('/agent-dashboard', requireAuth, requireSubscription, requireAgentPlan, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'agent-dashboard.html'));
});

module.exports = router;
