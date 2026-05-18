/**
 * routes/deadline-alerts.js — Deadline alert preferences + admin alert API.
 * Owns: /api/alerts/* (user prefs, deadline creation), /api/admin/alerts/* (log, stats, test/preview).
 * Does NOT own: email sending (deadline-alert-service), scheduling (startup.js).
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  upsertDeadline,
  getUserWaterwayPrefs,
  setUserWaterwayPrefs,
  getAlertLog,
  countAlertsSent,
  defaultWindowsFor,
} = require('../db/filing-deadlines');
const { buildDeadlineAlertEmail } = require('../services/deadline-alert-service');
const { sendEmail } = require('../services/alert-service');

const VALID_WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

// ── User: get alert preferences for all waterways ───────────────────────────
router.get('/alerts/preferences', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  try {
    const prefs = {};
    for (const waterway of VALID_WATERWAYS) {
      prefs[waterway] = await getUserWaterwayPrefs(pool, userId, waterway);
    }
    return res.json({ success: true, preferences: prefs });
  } catch (err) {
    console.error('[AlertPrefs] GET error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── User: update alert preferences for a waterway ────────────────────────────
router.post('/alerts/preferences/:waterway', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;
  const { waterway } = req.params;

  if (!VALID_WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: `Invalid waterway. Must be one of: ${VALID_WATERWAYS.join(', ')}` });
  }

  const { enabled, alert_windows } = req.body || {};

  // Validate alert_windows if provided
  const validWindows = ['96h', '72h', '48h', '24h', '12h', '6h'];
  const windows = Array.isArray(alert_windows)
    ? alert_windows.filter(w => validWindows.includes(w))
    : defaultWindowsFor(waterway);

  try {
    await setUserWaterwayPrefs(pool, userId, waterway, {
      enabled: enabled !== false,
      alertWindows: windows.length ? windows : defaultWindowsFor(waterway),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('[AlertPrefs] POST error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── User: create a filing deadline (called by filing wizards) ────────────────
router.post('/alerts/deadlines', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;
  const {
    waterway, filing_type, vessel_name, imo_number,
    deadline_at, filing_id, filing_url, compliance_issues,
  } = req.body || {};

  if (!waterway || !VALID_WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: 'Valid waterway required' });
  }
  if (!vessel_name) {
    return res.status(400).json({ success: false, message: 'vessel_name required' });
  }
  if (!deadline_at || isNaN(Date.parse(deadline_at))) {
    return res.status(400).json({ success: false, message: 'Valid deadline_at required' });
  }

  try {
    const row = await upsertDeadline(pool, {
      userId,
      waterway,
      filingType: filing_type || waterway,
      vesselName: vessel_name,
      imoNumber:  imo_number || null,
      deadlineAt: deadline_at,
      filingId:   filing_id || null,
      filingUrl:  filing_url || null,
      complianceIssues: compliance_issues || [],
    });
    return res.json({ success: true, deadline: row });
  } catch (err) {
    console.error('[AlertDeadlines] POST error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: alert log (most recent alerts, filterable by waterway) ─────────────
router.get('/admin/alerts/log', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { waterway, limit, offset } = req.query;

  if (waterway && !VALID_WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: 'Invalid waterway' });
  }

  try {
    const rows = await getAlertLog(pool, {
      waterway: waterway || null,
      limit:  Math.min(parseInt(limit) || 100, 500),
      offset: parseInt(offset) || 0,
    });
    const total = await countAlertsSent(pool, waterway || null);
    return res.json({ success: true, total, alerts: rows });
  } catch (err) {
    console.error('[AdminAlerts] GET log error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: alert summary stats ────────────────────────────────────────────────
router.get('/admin/alerts/stats', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const [total, byWaterway, recent] = await Promise.all([
      countAlertsSent(pool, null),
      Promise.all(
        VALID_WATERWAYS.map(async w => ({ waterway: w, count: await countAlertsSent(pool, w) }))
      ),
      getAlertLog(pool, { limit: 10 }),
    ]);

    return res.json({
      success: true,
      total_alerts_sent: total,
      by_waterway: byWaterway,
      recent_alerts: recent,
    });
  } catch (err) {
    console.error('[AdminAlerts] GET stats error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Sample data for test/preview endpoints ────────────────────────────────────

// Realistic sample data per waterway for the test alert email
function buildSampleData(waterway) {
  const SAMPLES = {
    panama:   { vessel: 'EVER GIVEN',      imo: '9811000', filing: 'VUMPA Pre-Arrival',       window: '48h', issues: ['Crew change documentation incomplete', 'PCSOPEP renewal expires in 7 days'] },
    suez:     { vessel: 'MSC OSCAR',        imo: '9703291', filing: 'SCA Convoy Booking',       window: '72h', issues: ['Transit application pending SCA review', 'Pilotage certificate required for LOA > 270m'] },
    bosporus: { vessel: 'AEGEAN STAR',      imo: '9315749', filing: 'SP-1 Pre-Arrival',         window: '48h', issues: ['LOA 210m — daytime transit only (06:00–20:00)', 'SP-1 must be filed 24h before ETA Istanbul'] },
    malacca:  { vessel: 'MAERSK SELETAR',   imo: '9525658', filing: 'STRAITREP Filing',         window: '24h', issues: ['STRAITREP not yet filed with VTIS West', 'DG manifest (IMDG Class 3) requires pre-notification'] },
    cape:     { vessel: 'GOLDEN OCEAN',     imo: '9481159', filing: 'ISPS Pre-Arrival (SAMSA)', window: '96h', issues: ['Last 10 port calls incomplete — missing Port Klang entry', 'SSO signature required on ISPS declaration'] },
  };
  const s = SAMPLES[waterway] || SAMPLES.panama;
  const deadlineAt = new Date(Date.now() + (parseInt(s.window) * 60 * 60 * 1000)).toISOString();
  return { ...s, deadlineAt };
}

// ── Admin: generate test/preview HTML for a waterway ─────────────────────────
router.get('/admin/alerts/preview', requireAuth, requireAdmin, (req, res) => {
  const waterway = VALID_WATERWAYS.includes(req.query.waterway) ? req.query.waterway : 'panama';
  const sample = buildSampleData(waterway);

  const html = buildDeadlineAlertEmail({
    waterway,
    filingType:       sample.filing,
    vesselName:       sample.vessel,
    imoNumber:        sample.imo,
    deadlineAt:       sample.deadlineAt,
    hoursLeft:        parseInt(sample.window),
    alertWindow:      sample.window,
    complianceIssues: sample.issues,
    filingUrl:        'https://canalclear.org/demo/panama',
    userName:         req.user ? (req.user.name || 'Admin') : 'Admin',
  });

  return res.json({ success: true, waterway, html });
});

// ── Admin: send test deadline alert to logged-in admin's email ────────────────
router.post('/admin/alerts/test-send', requireAuth, requireAdmin, async (req, res) => {
  const waterway = VALID_WATERWAYS.includes(req.body && req.body.waterway) ? req.body.waterway : 'panama';
  const adminEmail = req.user && req.user.email;

  if (!adminEmail) return res.status(400).json({ success: false, message: 'No admin email found' });

  const sample = buildSampleData(waterway);

  const html = buildDeadlineAlertEmail({
    waterway,
    filingType:       sample.filing,
    vesselName:       sample.vessel,
    imoNumber:        sample.imo,
    deadlineAt:       sample.deadlineAt,
    hoursLeft:        parseInt(sample.window),
    alertWindow:      sample.window,
    complianceIssues: sample.issues,
    filingUrl:        'https://canalclear.org/demo/panama',
    userName:         req.user.name || 'Admin',
  });

  const subject = `[TEST] CanalClear ${sample.window} Deadline Alert — MV ${sample.vessel} (${waterway})`;
  const ok = await sendEmail({ to: adminEmail, subject, html });

  return res.json({
    success: ok,
    sent_to: adminEmail,
    waterway,
    message: ok ? `Test alert sent to ${adminEmail}` : 'Email send failed — check POLSIA_API_KEY and server logs',
  });
});

module.exports = router;
