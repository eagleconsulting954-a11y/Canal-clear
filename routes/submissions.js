/**
 * routes/submissions.js — Submission attempt audit log API.
 *
 * Owns: admin endpoints for the /admin/submissions viewer; per-vessel history endpoint
 *       for authenticated customers; manual status override for portal-assist acknowledgements.
 * Does NOT own: actual filing submission logic, email sending, portal automation.
 *
 * Admin routes require requireAuth + requireAdmin middleware.
 * Customer route (/api/submissions/vessel/:vesselId) requires requireAuth only.
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const sa = require('../db/submission-attempts');

// ── Admin: list with filters + pagination ─────────────────────────────────────

router.get('/admin/submissions', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    waterway, authority, status, vessel_id, user_id,
    date_from, date_to,
    offset = 0, limit = 50,
  } = req.query;

  try {
    const result = await sa.list(pool, {
      waterway, authority, status,
      vesselId:  vessel_id,
      userId:    user_id,
      dateFrom:  date_from,
      dateTo:    date_to,
      offset:    parseInt(offset, 10) || 0,
      limit:     Math.min(parseInt(limit, 10) || 50, 200),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Submissions] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: stats summary + 7-day trend ───────────────────────────────────────

router.get('/admin/submissions/stats', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const data = await sa.stats(pool);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[Submissions] stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: row detail (full payload + response) ───────────────────────────────

router.get('/admin/submissions/:id', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid ID' });

  try {
    const row = await sa.getById(pool, id);
    if (!row) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, attempt: row });
  } catch (err) {
    console.error('[Submissions] detail error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: manual status update (for portal-assist manual_required → acknowledged) ──

router.patch('/admin/submissions/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid ID' });

  const { status, authority_reference, error_message } = req.body || {};
  if (!status || !sa.VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `status must be one of: ${sa.VALID_STATUSES.join(', ')}`,
    });
  }

  try {
    const updated = await sa.updateStatus(pool, id, status, {
      authorityReference: authority_reference,
      errorMessage:       error_message,
      acknowledgedAt:     status === 'acknowledged' ? new Date() : null,
    });
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, attempt: updated });
  } catch (err) {
    console.error('[Submissions] status update error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: CSV export ─────────────────────────────────────────────────────────

router.get('/admin/submissions/export/csv', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { waterway, authority, status, date_from, date_to } = req.query;

  try {
    const rows = await sa.csvRows(pool, { waterway, authority, status, dateFrom: date_from, dateTo: date_to });

    const headers = [
      'id', 'created_at', 'waterway', 'authority', 'channel', 'direction',
      'status', 'authority_reference', 'response_status', 'sent_at', 'acknowledged_at',
      'vessel_name', 'vessel_imo', 'user_email', 'error_message',
    ];

    const escapeCell = (v) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const lines = [
      headers.join(','),
      ...rows.map(r => headers.map(h => escapeCell(r[h])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="submission-attempts.csv"');
    res.send(lines.join('\r\n'));
  } catch (err) {
    console.error('[Submissions] CSV export error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Customer: per-vessel filing history ──────────────────────────────────────

router.get('/vessel-history/:vesselId', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const vesselId = parseInt(req.params.vesselId, 10);
  if (!vesselId) return res.status(400).json({ success: false, message: 'Invalid vessel ID' });

  const offset = parseInt(req.query.offset, 10) || 0;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  try {
    const result = await sa.getByVessel(pool, vesselId, req.user.id, { limit, offset });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Submissions] vessel history error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
