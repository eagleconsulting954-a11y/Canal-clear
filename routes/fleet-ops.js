/**
 * routes/fleet-ops.js — Fleet Ops Dashboard API
 *
 * Owns: /api/fleet-ops/* — fleet-level analytics, compliance risk metrics,
 *       deadline calendar, cost avoidance stats, vessel drill-down data.
 * Does NOT own: individual filing CRUD (routes/api.js), AIS positions (routes/fleet.js),
 *               user auth (middleware/auth.js).
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

// ─── Mock fleet data — realistic ops scenario for 12 managed vessels ─────────
// In production this would aggregate from sp1_filings, malacca_filings,
// cape_filings, filings, and voyage_waypoints tables.

const MOCK_FLEET = [
  {
    id: 'v001', imo: '9234567', name: 'MV Horizonte Azul', type: 'Container',
    flag: 'PA', dwt: 62400, loa: 215, grt: 51200,
    compliance: {
      panama: { score: 94, status: 'compliant', nextDeadline: '2026-05-20', issues: 0 },
      suez:   { score: 88, status: 'compliant', nextDeadline: null, issues: 1 },
      bosporus: { score: 71, status: 'warning', nextDeadline: '2026-05-16', issues: 2 },
      malacca: { score: 95, status: 'compliant', nextDeadline: null, issues: 0 },
      cape:   { score: 82, status: 'compliant', nextDeadline: null, issues: 1 },
    },
    nextTransit: { waterway: 'bosporus', eta: '2026-05-16T08:00:00Z', filingDeadline: '2026-05-14T08:00:00Z' },
    status: 'approaching', nearestCanal: 'bosporus', etaHours: 52,
    filingStatus: 'warning', overallScore: 86,
    lastUpdated: '2026-05-13T04:00:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-07-15', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2026-09-01', status: 'valid' },
      { name: 'P&I Cover', expires: '2026-08-31', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f101', waterway: 'panama', type: 'VUMPA', date: '2026-04-12', status: 'approved', score: 94 },
      { id: 'f102', waterway: 'suez', type: 'SCA', date: '2026-03-22', status: 'approved', score: 88 },
    ],
  },
  {
    id: 'v002', imo: '9345678', name: 'MV Pacific Star', type: 'Bulk Carrier',
    flag: 'BS', dwt: 78200, loa: 229, grt: 43800,
    compliance: {
      panama: { score: 100, status: 'compliant', nextDeadline: null, issues: 0 },
      suez:   { score: 92, status: 'compliant', nextDeadline: null, issues: 0 },
      bosporus: { score: 96, status: 'compliant', nextDeadline: null, issues: 0 },
      malacca: { score: 89, status: 'compliant', nextDeadline: null, issues: 1 },
      cape:   { score: 91, status: 'compliant', nextDeadline: null, issues: 0 },
    },
    nextTransit: { waterway: 'malacca', eta: '2026-05-24T14:00:00Z', filingDeadline: '2026-05-22T14:00:00Z' },
    status: 'transiting', nearestCanal: 'panama', etaHours: 0,
    filingStatus: 'compliant', overallScore: 94,
    lastUpdated: '2026-05-13T03:45:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2027-01-20', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2026-11-15', status: 'valid' },
      { name: 'DOC Certificate', expires: '2026-12-31', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f201', waterway: 'panama', type: 'VUMPA', date: '2026-05-13', status: 'approved', score: 100 },
      { id: 'f202', waterway: 'malacca', type: 'STRAITREP', date: '2026-04-18', status: 'approved', score: 89 },
    ],
  },
  {
    id: 'v003', imo: '9456789', name: 'MT Nile Meridian', type: 'Tanker',
    flag: 'GR', dwt: 105000, loa: 274, grt: 58900,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 42, status: 'critical', nextDeadline: '2026-05-14', issues: 4 },
      bosporus: { score: 67, status: 'warning', nextDeadline: null, issues: 2 },
      malacca: { score: 55, status: 'warning', nextDeadline: null, issues: 3 },
      cape:   { score: 78, status: 'compliant', nextDeadline: null, issues: 1 },
    },
    nextTransit: { waterway: 'suez', eta: '2026-05-14T06:00:00Z', filingDeadline: '2026-05-13T06:00:00Z' },
    status: 'approaching', nearestCanal: 'suez', etaHours: 8,
    filingStatus: 'overdue', overallScore: 48,
    lastUpdated: '2026-05-13T04:10:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-05-28', status: 'expiring' },
      { name: 'ISPS Certificate', expires: '2026-06-10', status: 'expiring' },
      { name: 'P&I Cover', expires: '2026-07-01', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f301', waterway: 'suez', type: 'SCA', date: '2026-05-13', status: 'rejected', score: 42 },
      { id: 'f302', waterway: 'suez', type: 'SCNT', date: '2026-03-01', status: 'approved', score: 91 },
    ],
  },
  {
    id: 'v004', imo: '9567890', name: 'MV Desert Wind', type: 'RoRo',
    flag: 'CY', dwt: 24800, loa: 200, grt: 28100,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 31, status: 'critical', nextDeadline: '2026-05-15', issues: 5 },
      bosporus: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      malacca: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      cape:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
    },
    nextTransit: { waterway: 'suez', eta: '2026-05-15T10:00:00Z', filingDeadline: '2026-05-13T22:00:00Z' },
    status: 'approaching', nearestCanal: 'suez', etaHours: 36,
    filingStatus: 'overdue', overallScore: 31,
    lastUpdated: '2026-05-13T04:05:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2025-12-31', status: 'expired' },
      { name: 'ISPS Certificate', expires: '2026-08-22', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f401', waterway: 'suez', type: 'SCA', date: '2026-05-12', status: 'pending', score: 31 },
    ],
  },
  {
    id: 'v005', imo: '9678901', name: 'MV Aegean Glory', type: 'Chemical Tanker',
    flag: 'MT', dwt: 19200, loa: 170, grt: 14800,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 85, status: 'compliant', nextDeadline: null, issues: 1 },
      bosporus: { score: 91, status: 'compliant', nextDeadline: '2026-05-15', issues: 0 },
      malacca: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      cape:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
    },
    nextTransit: { waterway: 'bosporus', eta: '2026-05-15T16:00:00Z', filingDeadline: '2026-05-13T16:00:00Z' },
    status: 'approaching', nearestCanal: 'bosporus', etaHours: 14,
    filingStatus: 'compliant', overallScore: 88,
    lastUpdated: '2026-05-13T03:55:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-10-15', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2026-12-01', status: 'valid' },
      { name: 'SP-1 Filing', expires: null, status: 'filed' },
    ],
    recentFilings: [
      { id: 'f501', waterway: 'bosporus', type: 'SP-1', date: '2026-05-13', status: 'approved', score: 91 },
      { id: 'f502', waterway: 'suez', type: 'SCA', date: '2026-04-05', status: 'approved', score: 85 },
    ],
  },
  {
    id: 'v006', imo: '9789012', name: 'MV Eastern Promise', type: 'VLCC',
    flag: 'SG', dwt: 310000, loa: 333, grt: 161000,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      bosporus: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      malacca: { score: 97, status: 'compliant', nextDeadline: '2026-05-14', issues: 0 },
      cape:   { score: 94, status: 'compliant', nextDeadline: null, issues: 0 },
    },
    nextTransit: { waterway: 'malacca', eta: '2026-05-14T02:00:00Z', filingDeadline: '2026-05-13T20:00:00Z' },
    status: 'approaching', nearestCanal: 'malacca', etaHours: 12,
    filingStatus: 'compliant', overallScore: 96,
    lastUpdated: '2026-05-13T04:08:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2027-03-12', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2027-01-08', status: 'valid' },
      { name: 'P&I Cover', expires: '2026-09-30', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f601', waterway: 'malacca', type: 'STRAITREP', date: '2026-05-13', status: 'approved', score: 97 },
    ],
  },
  {
    id: 'v007', imo: '9890123', name: 'MV Malacca Trader', type: 'Container',
    flag: 'MY', dwt: 48600, loa: 294, grt: 50400,
    compliance: {
      panama: { score: 89, status: 'compliant', nextDeadline: null, issues: 1 },
      suez:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      bosporus: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      malacca: { score: 93, status: 'compliant', nextDeadline: null, issues: 0 },
      cape:   { score: 87, status: 'compliant', nextDeadline: null, issues: 1 },
    },
    nextTransit: { waterway: 'panama', eta: '2026-06-02T09:00:00Z', filingDeadline: '2026-05-30T09:00:00Z' },
    status: 'transiting', nearestCanal: 'malacca', etaHours: 0,
    filingStatus: 'compliant', overallScore: 90,
    lastUpdated: '2026-05-13T03:50:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-11-20', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2027-02-14', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f701', waterway: 'malacca', type: 'STRAITREP', date: '2026-05-10', status: 'approved', score: 93 },
      { id: 'f702', waterway: 'panama', type: 'VUMPA', date: '2026-04-28', status: 'approved', score: 89 },
    ],
  },
  {
    id: 'v008', imo: '9901234', name: 'MV Cape Sovereign', type: 'Bulk Carrier',
    flag: 'ZA', dwt: 92000, loa: 250, grt: 49000,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 77, status: 'compliant', nextDeadline: null, issues: 1 },
      bosporus: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      malacca: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      cape:   { score: 63, status: 'warning', nextDeadline: '2026-05-18', issues: 3 },
    },
    nextTransit: { waterway: 'cape', eta: '2026-05-18T20:00:00Z', filingDeadline: '2026-05-14T20:00:00Z' },
    status: 'approaching', nearestCanal: 'cape', etaHours: 28,
    filingStatus: 'pending', overallScore: 70,
    lastUpdated: '2026-05-13T04:02:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-06-30', status: 'expiring' },
      { name: 'ISPS Certificate', expires: '2026-10-18', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f801', waterway: 'cape', type: 'ISPS Pre-Arrival', date: '2026-05-13', status: 'pending', score: 63 },
      { id: 'f802', waterway: 'suez', type: 'SCA', date: '2026-02-14', status: 'approved', score: 77 },
    ],
  },
  {
    id: 'v009', imo: '9012345', name: 'MV Transpacific Ace', type: 'Car Carrier',
    flag: 'JP', dwt: 21000, loa: 200, grt: 58400,
    compliance: {
      panama: { score: 98, status: 'compliant', nextDeadline: '2026-05-28', issues: 0 },
      suez:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      bosporus: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      malacca: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      cape:   { score: 0, status: 'na', nextDeadline: null, issues: 0 },
    },
    nextTransit: { waterway: 'panama', eta: '2026-05-28T16:00:00Z', filingDeadline: '2026-05-26T16:00:00Z' },
    status: 'clear', nearestCanal: 'panama', etaHours: 96,
    filingStatus: 'compliant', overallScore: 98,
    lastUpdated: '2026-05-13T03:40:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2027-05-10', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2027-08-22', status: 'valid' },
      { name: 'P&I Cover', expires: '2026-09-30', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f901', waterway: 'panama', type: 'VUMPA', date: '2026-04-01', status: 'approved', score: 98 },
    ],
  },
  {
    id: 'v010', imo: '9123456', name: 'MV Indian Spirit', type: 'LNG Carrier',
    flag: 'IN', dwt: 84000, loa: 277, grt: 95700,
    compliance: {
      panama: { score: 0, status: 'na', nextDeadline: null, issues: 0 },
      suez:   { score: 88, status: 'compliant', nextDeadline: '2026-06-01', issues: 1 },
      bosporus: { score: 74, status: 'warning', nextDeadline: null, issues: 2 },
      malacca: { score: 91, status: 'compliant', nextDeadline: null, issues: 0 },
      cape:   { score: 85, status: 'compliant', nextDeadline: null, issues: 1 },
    },
    nextTransit: { waterway: 'suez', eta: '2026-06-01T12:00:00Z', filingDeadline: '2026-05-30T12:00:00Z' },
    status: 'approaching', nearestCanal: 'suez', etaHours: 72,
    filingStatus: 'compliant', overallScore: 85,
    lastUpdated: '2026-05-13T04:00:00Z',
    certificates: [
      { name: 'MARPOL Annex I', expires: '2026-09-15', status: 'valid' },
      { name: 'ISPS Certificate', expires: '2026-10-20', status: 'valid' },
    ],
    recentFilings: [
      { id: 'f1001', waterway: 'suez', type: 'SCA', date: '2026-04-20', status: 'approved', score: 88 },
      { id: 'f1002', waterway: 'malacca', type: 'STRAITREP', date: '2026-03-15', status: 'approved', score: 91 },
    ],
  },
];

// Cost avoidance — based on rejected/corrected filings and penalty avoidance
const COST_AVOIDANCE = {
  totalAvoidedUSD: 186400,
  filingsCompleted: 47,
  rejectionRateBefore: 34,
  rejectionRateAfter: 4.3,
  penaltiesAvoided: 12,
  agentFeesAvoided: 31200,
  month: 'May 2026',
  breakdown: [
    { waterway: 'Panama', savings: 44000, filings: 11 },
    { waterway: 'Suez', savings: 62200, filings: 14 },
    { waterway: 'Bosporus', savings: 28400, filings: 8 },
    { waterway: 'Malacca', savings: 31600, filings: 9 },
    { waterway: 'Cape', savings: 20200, filings: 5 },
  ],
};

// ─── GET /api/fleet-ops/overview — fleet summary + KPIs ──────────────────────
router.get('/overview', requireAuth, (req, res) => {
  const fleet = MOCK_FLEET;

  const totalVessels = fleet.length;
  const compliant = fleet.filter(v => v.filingStatus === 'compliant').length;
  const warning = fleet.filter(v => v.filingStatus === 'warning' || v.filingStatus === 'pending').length;
  const critical = fleet.filter(v => v.filingStatus === 'overdue').length;
  const avgScore = Math.round(fleet.reduce((sum, v) => sum + v.overallScore, 0) / totalVessels);

  const upcomingDeadlines = fleet
    .filter(v => v.nextTransit && v.nextTransit.filingDeadline)
    .map(v => ({
      vesselId: v.id, vesselName: v.name, imo: v.imo,
      waterway: v.nextTransit.waterway,
      eta: v.nextTransit.eta,
      deadline: v.nextTransit.filingDeadline,
      urgency: v.etaHours <= 24 ? 'critical' : v.etaHours <= 72 ? 'warning' : 'normal',
      filingStatus: v.filingStatus,
    }))
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));

  const vesselsNeedingAttention = fleet
    .filter(v => ['overdue', 'warning', 'pending'].includes(v.filingStatus))
    .sort((a, b) => a.overallScore - b.overallScore);

  res.json({
    success: true,
    kpis: {
      totalVessels,
      fleetComplianceScore: avgScore,
      compliantVessels: compliant,
      warningVessels: warning,
      criticalVessels: critical,
      filingCompletionRate: Math.round((compliant / totalVessels) * 100),
      overdueAlerts: critical,
      vesselsNeedingAttention: warning + critical,
    },
    upcomingDeadlines,
    vesselsNeedingAttention: vesselsNeedingAttention.slice(0, 5),
    costAvoidance: COST_AVOIDANCE,
    fleet: fleet.map(v => ({
      id: v.id, imo: v.imo, name: v.name, type: v.type, flag: v.flag,
      overallScore: v.overallScore, filingStatus: v.filingStatus,
      status: v.status, nearestCanal: v.nearestCanal, etaHours: v.etaHours,
      nextTransit: v.nextTransit, loa: v.loa, dwt: v.dwt,
    })),
  });
});

// ─── GET /api/fleet-ops/heatmap — compliance risk grid (vessel × waterway) ───
router.get('/heatmap', requireAuth, (req, res) => {
  const waterways = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

  const grid = MOCK_FLEET.map(v => ({
    vesselId: v.id,
    vesselName: v.name,
    imo: v.imo,
    type: v.type,
    cells: waterways.map(w => ({
      waterway: w,
      score: v.compliance[w].score,
      status: v.compliance[w].status,
      issues: v.compliance[w].issues,
      nextDeadline: v.compliance[w].nextDeadline,
    })),
  }));

  res.json({ success: true, waterways, grid });
});

// ─── GET /api/fleet-ops/calendar — filing deadlines calendar view ──────────
router.get('/calendar', requireAuth, (req, res) => {
  const events = [];

  MOCK_FLEET.forEach(v => {
    // Add next transit deadline
    if (v.nextTransit && v.nextTransit.filingDeadline) {
      events.push({
        id: `${v.id}-next`,
        vesselName: v.name, imo: v.imo,
        waterway: v.nextTransit.waterway,
        type: 'filing_deadline',
        date: v.nextTransit.filingDeadline,
        etaDate: v.nextTransit.eta,
        filingStatus: v.filingStatus,
        urgency: v.etaHours <= 24 ? 'critical' : v.etaHours <= 72 ? 'warning' : 'normal',
      });
    }

    // Add recent filing dates for history
    v.recentFilings.forEach(f => {
      events.push({
        id: f.id,
        vesselName: v.name, imo: v.imo,
        waterway: f.waterway,
        type: 'filing_' + f.status,
        date: f.date + 'T00:00:00Z',
        filingStatus: f.status,
        score: f.score,
        urgency: 'normal',
      });
    });
  });

  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json({ success: true, events });
});

// ─── GET /api/fleet-ops/vessel/:imo — vessel detail drill-down ─────────────
router.get('/vessel/:imo', requireAuth, (req, res) => {
  const vessel = MOCK_FLEET.find(v => v.imo === req.params.imo);
  if (!vessel) {
    return res.status(404).json({ success: false, message: 'Vessel not found in fleet' });
  }
  res.json({ success: true, vessel });
});

// ─── GET /api/fleet-ops/cost-avoidance — cost avoidance metrics ───────────
router.get('/cost-avoidance', requireAuth, (req, res) => {
  res.json({ success: true, ...COST_AVOIDANCE });
});

module.exports = router;
