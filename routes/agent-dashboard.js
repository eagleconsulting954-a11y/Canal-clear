/**
 * Agent Dashboard routes — API data endpoints for the shipping agent dashboard.
 * Owns: agent KPI data, client portfolio summary, filing metrics, client deadlines.
 * Does NOT own: auth middleware, user management, filing creation, canal-specific logic.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireSubscription, canalsForPlan } = require('../middleware/auth');
const usersDb = require('../db/users');

// ── Demo seed data (until multi-client workspace feature ships) ──────────────
// These represent a realistic agency portfolio for design/product validation.
const DEMO_CLIENTS = [
  {
    id: 1,
    client_name: 'Aegean Bulk Carriers S.A.',
    contact_name: 'Nikos Papadopoulos',
    contact_email: 'n.papadopoulos@aegeanbulk.gr',
    company_type: 'owner',
    vessels: [
      { imo: '9521234', name: 'AEGEAN STAR', type: 'Bulk Carrier', flag: 'Greece', gt: 82340, waterways: ['bosporus', 'suez'] },
      { imo: '9521235', name: 'AEGEAN ATLAS', type: 'Bulk Carrier', flag: 'Greece', gt: 79200, waterways: ['bosporus', 'suez', 'malacca'] },
      { imo: '9521236', name: 'AEGEAN SPIRIT', type: 'Handymax', flag: 'Marshall Islands', gt: 45100, waterways: ['suez', 'cape'] },
    ],
    filings_this_month: 7,
    avg_compliance_score: 91,
    pending_deadlines: 2,
    active_filings: 3,
    last_filing_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 2,
    client_name: 'Pacific Tanker Corp',
    contact_name: 'James Wei',
    contact_email: 'j.wei@pacifictanker.com',
    company_type: 'operator',
    vessels: [
      { imo: '9612301', name: 'PACIFIC GLORY', type: 'VLCC', flag: 'Panama', gt: 302450, waterways: ['malacca', 'suez'] },
      { imo: '9612302', name: 'PACIFIC DAWN', type: 'Aframax', flag: 'Liberia', gt: 108700, waterways: ['malacca'] },
    ],
    filings_this_month: 5,
    avg_compliance_score: 88,
    pending_deadlines: 1,
    active_filings: 2,
    last_filing_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 3,
    client_name: 'Nordic Container Lines',
    contact_name: 'Lars Eriksson',
    contact_email: 'l.eriksson@nordiccontainer.se',
    company_type: 'operator',
    vessels: [
      { imo: '9734501', name: 'NORDIC HAWK', type: 'Container', flag: 'Sweden', gt: 94300, waterways: ['suez', 'bosporus'] },
      { imo: '9734502', name: 'NORDIC FALCON', type: 'Container', flag: 'Denmark', gt: 91200, waterways: ['suez'] },
      { imo: '9734503', name: 'NORDIC EAGLE', type: 'Feeder', flag: 'Sweden', gt: 31400, waterways: ['bosporus'] },
      { imo: '9734504', name: 'NORDIC OWL', type: 'Feeder', flag: 'Sweden', gt: 28900, waterways: ['bosporus', 'suez'] },
    ],
    filings_this_month: 12,
    avg_compliance_score: 94,
    pending_deadlines: 3,
    active_filings: 4,
    last_filing_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 4,
    client_name: 'Gulf LNG Partners Ltd.',
    contact_name: 'Fatima Al-Rashidi',
    contact_email: 'f.alrashidi@gulflng.ae',
    company_type: 'charterer',
    vessels: [
      { imo: '9889901', name: 'GULF ENERGY', type: 'LNG Carrier', flag: 'UAE', gt: 130800, waterways: ['suez', 'malacca', 'panama'] },
    ],
    filings_this_month: 3,
    avg_compliance_score: 96,
    pending_deadlines: 1,
    active_filings: 1,
    last_filing_at: new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 5,
    client_name: 'Southern Cape Shipping',
    contact_name: 'André van Dijk',
    contact_email: 'a.vandijk@southerncape.za',
    company_type: 'manager',
    vessels: [
      { imo: '9445201', name: 'CAPE PIONEER', type: 'Bulk Carrier', flag: 'South Africa', gt: 87600, waterways: ['cape'] },
      { imo: '9445202', name: 'CAPE VENTURE', type: 'Bulk Carrier', flag: 'Marshall Islands', gt: 85100, waterways: ['cape', 'suez'] },
    ],
    filings_this_month: 4,
    avg_compliance_score: 83,
    pending_deadlines: 4,
    active_filings: 2,
    last_filing_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'needs_attention',
  },
];

const DEMO_UPCOMING_DEADLINES = [
  { client: 'Nordic Container Lines', vessel: 'NORDIC HAWK', waterway: 'Suez Canal', filing_type: 'SCNT Tonnage Certificate', deadline_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), compliance_score: 94, urgency: 'critical' },
  { client: 'Southern Cape Shipping', vessel: 'CAPE PIONEER', waterway: 'Cape of Good Hope', filing_type: 'ISPS Pre-Arrival', deadline_at: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString(), compliance_score: 78, urgency: 'high' },
  { client: 'Southern Cape Shipping', vessel: 'CAPE VENTURE', waterway: 'Cape of Good Hope', filing_type: 'ISPS Pre-Arrival', deadline_at: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString(), compliance_score: 88, urgency: 'high' },
  { client: 'Aegean Bulk Carriers S.A.', vessel: 'AEGEAN STAR', waterway: 'Bosporus', filing_type: 'SP-1 Pre-Arrival', deadline_at: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), compliance_score: 91, urgency: 'medium' },
  { client: 'Aegean Bulk Carriers S.A.', vessel: 'AEGEAN ATLAS', waterway: 'Suez Canal', filing_type: 'SCNT Filing', deadline_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), compliance_score: 95, urgency: 'medium' },
  { client: 'Gulf LNG Partners Ltd.', vessel: 'GULF ENERGY', waterway: 'Panama Canal', filing_type: 'VUMPA Filing', deadline_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), compliance_score: 96, urgency: 'low' },
  { client: 'Nordic Container Lines', vessel: 'NORDIC FALCON', waterway: 'Suez Canal', filing_type: 'SCA Pre-Arrival', deadline_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), compliance_score: 94, urgency: 'low' },
  { client: 'Southern Cape Shipping', vessel: 'CAPE PIONEER', waterway: 'Cape of Good Hope', filing_type: 'MARPOL Annex V', deadline_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(), compliance_score: 83, urgency: 'low' },
];

const WATERWAY_BREAKDOWN = {
  suez:     { label: 'Suez Canal',        filings: 14, icon: '🇪🇬' },
  bosporus: { label: 'Bosporus',          filings: 8,  icon: '🇹🇷' },
  malacca:  { label: 'Malacca Strait',    filings: 5,  icon: '🇸🇬' },
  cape:     { label: 'Cape of Good Hope', filings: 6,  icon: '🇿🇦' },
  panama:   { label: 'Panama Canal',      filings: 3,  icon: '🇵🇦' },
};

// ── GET /api/agent-dashboard/summary ────────────────────────────────────────
// Returns all KPI data for the agent dashboard in one call.
router.get('/summary', requireAuth, requireSubscription, async (req, res) => {
  try {
    // Compute portfolio KPIs from demo data
    const totalVessels     = DEMO_CLIENTS.reduce((sum, c) => sum + c.vessels.length, 0);
    const totalClients     = DEMO_CLIENTS.length;
    const filingsThisMonth = DEMO_CLIENTS.reduce((sum, c) => sum + c.filings_this_month, 0);
    const avgComplianceScore = Math.round(
      DEMO_CLIENTS.reduce((sum, c) => sum + c.avg_compliance_score * c.vessels.length, 0) / totalVessels
    );
    const pendingDeadlines = DEMO_CLIENTS.reduce((sum, c) => sum + c.pending_deadlines, 0);
    const activeFilings    = DEMO_CLIENTS.reduce((sum, c) => sum + c.active_filings, 0);

    // Rolling 30-day filing trend (mock daily series)
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      trend.push({
        date: d.toISOString().slice(0, 10),
        filings: Math.floor(Math.random() * 4) + (i < 7 ? 2 : 1),  // higher recent volume
      });
    }

    res.json({
      success: true,
      is_demo: true,  // flag frontend to show "demo mode" banner
      kpis: {
        total_vessels:       totalVessels,
        total_clients:       totalClients,
        filings_this_month:  filingsThisMonth,
        filings_today:       5,
        filings_this_week:   19,
        avg_compliance_score: avgComplianceScore,
        pending_deadlines:   pendingDeadlines,
        active_filings:      activeFilings,
        rejection_rate:      2.1,       // % of filings needing revision
        avg_prep_time_min:   18,        // avg minutes per filing
        cost_prevented_usd:  74000,     // vs. paying ship agents
      },
      clients: DEMO_CLIENTS.map(c => ({
        id: c.id,
        client_name: c.client_name,
        contact_name: c.contact_name,
        contact_email: c.contact_email,
        company_type: c.company_type,
        vessel_count: c.vessels.length,
        vessels: c.vessels,
        filings_this_month: c.filings_this_month,
        avg_compliance_score: c.avg_compliance_score,
        pending_deadlines: c.pending_deadlines,
        active_filings: c.active_filings,
        last_filing_at: c.last_filing_at,
        status: c.status,
      })),
      upcoming_deadlines: DEMO_UPCOMING_DEADLINES,
      waterway_breakdown: WATERWAY_BREAKDOWN,
      filing_trend: trend,
    });
  } catch (err) {
    console.error('[AgentDashboard] summary error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load agent dashboard data' });
  }
});

// ── GET /api/agent-dashboard/client/:id ─────────────────────────────────────
// Returns a single client's full data for the client detail panel.
router.get('/client/:id', requireAuth, requireSubscription, (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const client = DEMO_CLIENTS.find(c => c.id === clientId);
  if (!client) {
    return res.status(404).json({ success: false, message: 'Client not found' });
  }
  const deadlines = DEMO_UPCOMING_DEADLINES.filter(d => d.client === client.client_name);
  res.json({ success: true, client, deadlines });
});

// ── Governing body portal registry ──────────────────────────────────────────
// Filtered to waterways the agent's subscription covers.
// URLs verified 2026-05-13 via screenshot.
const PORTAL_REGISTRY = {
  panama: {
    waterway_key: 'panama',
    waterway_label: 'Panama Canal',
    authority_name: 'Autoridad del Canal de Panamá (ACP)',
    url: 'https://peajes.pancanal.com/',
    description: 'Maritime Services portal — VUMPA/PCSOPEP filings, transit scheduling & billing',
    icon: '🇵🇦',
  },
  suez: {
    waterway_key: 'suez',
    waterway_label: 'Suez Canal',
    authority_name: 'Suez Canal Authority (SCA)',
    url: 'https://www.suezcanal.gov.eg/',
    description: 'e-Services portal — SCNT/SCOT filings, booking & transit management',
    icon: '🇪🇬',
  },
  bosporus: {
    waterway_key: 'bosporus',
    waterway_label: 'Bosporus / Turkish Straits',
    authority_name: 'Turkish Coastal Safety (KDGM / KEGM)',
    url: 'https://www.kiyiemniyeti.gov.tr/',
    description: 'Turkish Straits VTS — SP-1/Montreux filings, traffic management',
    icon: '🇹🇷',
  },
  malacca: {
    waterway_key: 'malacca',
    waterway_label: 'Strait of Malacca',
    authority_name: 'MPA Singapore & MMEA Malaysia',
    url: 'https://www.mpa.gov.sg/',
    description: 'Maritime & Port Authority of Singapore — STRAITREP/VTS filings',
    icon: '🇸🇬',
  },
  cape: {
    waterway_key: 'cape',
    waterway_label: 'Cape of Good Hope',
    authority_name: 'SAMSA (South African Maritime Safety Authority)',
    url: 'https://www.samsa.org.za/',
    description: 'SAMSA portal — ISPS pre-arrival filings & compliance declarations',
    icon: '🇿🇦',
  },
};

// ── GET /api/agent-dashboard/portals ─────────────────────────────────────────
// Returns governing body portal links for the current user's waterway subscription.
router.get('/portals', requireAuth, requireSubscription, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const user = await usersDb.getUserWaterwayAccess(pool, req.user.id);

    const effectiveCanals = (user && user.allowed_canals && user.allowed_canals.length > 0)
      ? user.allowed_canals
      : canalsForPlan(req.user.subscription_plan || '');

    const portals = effectiveCanals
      .filter(k => PORTAL_REGISTRY[k])
      .map(k => PORTAL_REGISTRY[k]);

    res.json({ success: true, portals });
  } catch (err) {
    console.error('[AgentDashboard] portals error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to load authority portals' });
  }
});

// ── GET /api/agent-dashboard/is-agent ───────────────────────────────────────
// Returns whether the current user has agent role (drives dashboard routing).
router.get('/is-agent', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    let isAgent = false;

    // Check is_agent column (created by migration). Graceful if column doesn't exist yet.
    try {
      const user = await usersDb.getUserAgentStatus(pool, req.user.id);
      if (user) {
        isAgent = user.is_agent || (user.subscription_plan || '').toLowerCase().includes('agent');
      }
    } catch (colErr) {
      // Column not yet migrated — fall back to plan-name detection
      const user = await usersDb.getUserSubscriptionPlan(pool, req.user.id);
      if (user) {
        isAgent = (user.subscription_plan || '').toLowerCase().includes('agent');
      }
    }

    res.json({ success: true, is_agent: isAgent });
  } catch (err) {
    res.json({ success: true, is_agent: false });
  }
});

module.exports = router;
