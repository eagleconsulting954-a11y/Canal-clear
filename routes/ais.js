/**
 * routes/ais.js — AIS vessel tracking REST API.
 *
 * Owns: HTTP handling for vessel position queries and provider config.
 * Does NOT own: DB queries (db/ais-positions.js), mock data generation, auth logic.
 *
 * Mounted at: /api/ais
 */

const { Router } = require('express');
const {
  getAllCurrentPositions,
  getVesselTrack,
  getVesselsNearWaterway,
  getProviderConfig,
  updateProviderConfig,
} = require('../db/ais-positions');
const { forceTick, ADAPTERS } = require('../services/ais-provider');
const { requireAdmin } = require('../middleware/auth');

const router = Router();

// Valid waterways for input sanitization
const VALID_WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

// ── GET /api/ais/positions ────────────────────────────────────────────────────
// All current vessel positions (one per IMO, most recent).
// Query params:
//   ?imo=9123456       — filter to specific IMO
//   ?waterway=panama   — filter to vessels within 2000 nm of canal
router.get('/positions', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { imo, waterway } = req.query;

    if (waterway && !VALID_WATERWAYS.includes(waterway)) {
      return res.status(400).json({ error: `Invalid waterway. Must be one of: ${VALID_WATERWAYS.join(', ')}` });
    }

    const positions = await getAllCurrentPositions(pool, { imo, waterway });
    return res.json({
      count: positions.length,
      positions,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AIS] GET /positions error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

// ── GET /api/ais/positions/:imo ───────────────────────────────────────────────
// Single vessel current position + last 72h track.
router.get('/positions/:imo', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { imo } = req.params;

    if (!imo || !/^\d{7}$/.test(imo)) {
      return res.status(400).json({ error: 'IMO number must be exactly 7 digits' });
    }

    const { current, track } = await getVesselTrack(pool, imo);

    if (!current) {
      return res.status(404).json({ error: `No position data found for IMO ${imo}` });
    }

    return res.json({
      imo_number: imo,
      current,
      track,
      track_points: track.length,
      track_window_hours: 72,
    });
  } catch (err) {
    console.error('[AIS] GET /positions/:imo error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch vessel track' });
  }
});

// ── GET /api/ais/vessels/near/:waterway ──────────────────────────────────────
// Vessels within configurable distance of a specific canal.
// Query params:
//   ?max_dist_nm=1000  — distance threshold in nautical miles (default 1000)
router.get('/vessels/near/:waterway', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { waterway } = req.params;

    if (!VALID_WATERWAYS.includes(waterway)) {
      return res.status(400).json({
        error: `Invalid waterway. Must be one of: ${VALID_WATERWAYS.join(', ')}`,
      });
    }

    const maxDistNm = parseInt(req.query.max_dist_nm, 10) || 1000;
    if (maxDistNm < 1 || maxDistNm > 10000) {
      return res.status(400).json({ error: 'max_dist_nm must be between 1 and 10000' });
    }

    const vessels = await getVesselsNearWaterway(pool, waterway, maxDistNm);

    return res.json({
      waterway,
      max_dist_nm: maxDistNm,
      count: vessels.length,
      vessels,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`[AIS] GET /vessels/near/${req.params.waterway} error:`, err.message);
    return res.status(500).json({ error: 'Failed to fetch vessels near waterway' });
  }
});

// ── POST /api/ais/provider/config ─────────────────────────────────────────────
// Admin: switch between mock and real AIS providers, set API key, adjust poll interval.
// Requires admin auth.
//
// Body: { provider, api_key, poll_interval_sec, enabled }
router.post('/provider/config', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { provider, api_key, poll_interval_sec, enabled } = req.body;

    // Validate provider if supplied
    const validProviders = Object.keys(ADAPTERS);
    if (provider && !validProviders.includes(provider)) {
      return res.status(400).json({
        error: `Invalid provider. Available: ${validProviders.join(', ')}`,
      });
    }

    // Validate poll interval
    if (poll_interval_sec !== undefined) {
      const sec = parseInt(poll_interval_sec, 10);
      if (isNaN(sec) || sec < 30 || sec > 3600) {
        return res.status(400).json({ error: 'poll_interval_sec must be between 30 and 3600' });
      }
    }

    const updated = await updateProviderConfig(pool, {
      provider,
      api_key,
      poll_interval_sec: poll_interval_sec !== undefined ? parseInt(poll_interval_sec, 10) : undefined,
      enabled,
    });

    return res.json({
      message: 'Provider config updated',
      config: {
        provider: updated.provider,
        poll_interval_sec: updated.poll_interval_sec,
        enabled: updated.enabled,
        updated_at: updated.updated_at,
        // Never return api_key in response
      },
    });
  } catch (err) {
    console.error('[AIS] POST /provider/config error:', err.message);
    return res.status(500).json({ error: 'Failed to update provider config' });
  }
});

// ── GET /api/ais/provider/config ──────────────────────────────────────────────
// Admin: get current provider config.
router.get('/provider/config', requireAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const config = await getProviderConfig(pool);

    if (!config) {
      return res.status(404).json({ error: 'Provider config not found' });
    }

    return res.json({
      provider: config.provider,
      poll_interval_sec: config.poll_interval_sec,
      enabled: config.enabled,
      updated_at: config.updated_at,
      available_providers: Object.keys(ADAPTERS),
      // api_key intentionally omitted
    });
  } catch (err) {
    console.error('[AIS] GET /provider/config error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch provider config' });
  }
});

// ── POST /api/ais/provider/refresh ────────────────────────────────────────────
// Admin: trigger immediate position refresh outside normal poll interval.
router.post('/provider/refresh', requireAdmin, async (req, res) => {
  try {
    await forceTick();
    return res.json({ message: 'AIS refresh triggered', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AIS] POST /provider/refresh error:', err.message);
    return res.status(500).json({ error: 'Failed to trigger refresh' });
  }
});

module.exports = router;
