/**
 * routes/geofence.js — Geofence admin API.
 * Owns: /api/geofence/* endpoints (zone config, trigger events, active vessels).
 * Does NOT own: geofence detection logic (services/geofence-engine.js), vessel positions (AIS layer).
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  getAllZones,
  updateZone,
  getRecentEvents,
  getActiveVessels,
} = require('../db/geofence');

const VALID_WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

// ── GET /api/geofence/zones — list all zones with thresholds ─────────────────
router.get('/zones', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const zones = await getAllZones(pool);
    return res.json({ success: true, zones });
  } catch (err) {
    console.error('[Geofence] GET /zones error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/geofence/zones/:waterway — adjust thresholds for a canal ────────
router.put('/zones/:waterway', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { waterway } = req.params;

  if (!VALID_WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: `Invalid waterway. Must be one of: ${VALID_WATERWAYS.join(', ')}` });
  }

  const allowed = ['threshold_96h_nm', 'threshold_72h_nm', 'threshold_48h_nm', 'threshold_24h_nm', 'threshold_12h_nm', 'threshold_6h_nm', 'center_lat', 'center_lng'];
  const body = req.body || {};
  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key] === null ? null : Number(body[key]);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields to update' });
  }

  try {
    const zone = await updateZone(pool, waterway, updates);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });
    return res.json({ success: true, zone });
  } catch (err) {
    console.error(`[Geofence] PUT /zones/${waterway} error:`, err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/geofence/events — recent trigger events ─────────────────────────
router.get('/events', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { waterway, limit, offset } = req.query;

  if (waterway && !VALID_WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: 'Invalid waterway' });
  }

  try {
    const events = await getRecentEvents(pool, {
      waterway: waterway || null,
      limit:    Math.min(parseInt(limit) || 100, 500),
      offset:   parseInt(offset) || 0,
    });
    return res.json({ success: true, count: events.length, events });
  } catch (err) {
    console.error('[Geofence] GET /events error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/geofence/active — vessels currently inside any alert zone ────────
router.get('/active', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const vessels = await getActiveVessels(pool);
    return res.json({ success: true, count: vessels.length, vessels });
  } catch (err) {
    console.error('[Geofence] GET /active error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
