/**
 * routes/voyage.js — Unified Voyage Planning API
 *
 * Owns: all /api/voyage/* endpoint handlers for multi-waterway voyage planning.
 * Does NOT own: validation logic (voyage-generator.js), SQL (db/voyages.js),
 *               PDF generation (voyage-pdf.js), vessel lookup, or auth middleware.
 *
 * Endpoints:
 *   POST   /api/voyage/detect          — detect waterways from origin/destination (no auth)
 *   POST   /api/voyage/plan            — compute timings for a route (no auth — used in demo)
 *   POST   /api/voyage                 — create voyage (auth)
 *   GET    /api/voyage                 — list voyages (auth)
 *   GET    /api/voyage/:id             — get voyage + waypoints (auth)
 *   PUT    /api/voyage/:id             — update voyage (auth)
 *   DELETE /api/voyage/:id             — soft-delete voyage (auth)
 *   POST   /api/voyage/:id/waypoints   — replace waypoints (auth)
 *   PUT    /api/voyage/:id/waypoints/:waterway — update single waypoint (auth)
 *   GET    /api/voyage/:id/pdf         — PDF compliance package (auth)
 *   GET    /api/voyage/ports           — list known port names for autocomplete (no auth)
 */

const express = require('express');
const router  = express.Router();

const { requireAuth }                = require('../middleware/auth');
const {
  detectWaterways,
  calculateWaypointTimings,
  computeOverallScore,
  PORT_COORDS,
} = require('../services/voyage-generator');
const {
  createVoyage,
  listVoyages,
  getVoyageById,
  updateVoyage,
  deleteVoyage,
  upsertWaypoints,
  updateWaypoint,
} = require('../db/voyages');
const { generateVoyageCompliancePDF } = require('../services/voyage-pdf');
const { lookupByIMO, validateIMOChecksum } = require('../services/vessel-lookup');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voyage/demo-pdf — generate PDF from client-supplied plan (no auth)
// Demo-safe: no voyage saved, no auth required — used from voyage-planner.html
// ─────────────────────────────────────────────────────────────────────────────

router.post('/demo-pdf', async (req, res) => {
  try {
    const { voyage, waypoints } = req.body;
    if (!voyage || !waypoints) {
      return res.status(400).json({ success: false, message: 'voyage and waypoints required.' });
    }
    const pdf = await generateVoyageCompliancePDF(voyage, waypoints);
    const voyageSlug = (voyage.voyage_name || 'voyage').toLowerCase().replace(/\s+/g, '-');
    const dateSlug   = new Date().toISOString().slice(0, 10);
    const filename   = `${voyageSlug}_compliance-package_${dateSlug}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voyage/ports — known port names for autocomplete
// ─────────────────────────────────────────────────────────────────────────────

router.get('/ports', (req, res) => {
  const ports = Object.keys(PORT_COORDS).sort();
  return res.json({ success: true, ports });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voyage/detect — detect waterways from port pair (no auth)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/detect', (req, res) => {
  try {
    const { origin, destination, manual_waterways } = req.body;
    if (!origin || !destination) {
      return res.status(400).json({ success: false, message: 'origin and destination required.' });
    }
    const waterways = detectWaterways(origin, destination, manual_waterways);
    return res.json({ success: true, waterways });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voyage/plan — compute full timing plan (no auth — demo-safe)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/plan', (req, res) => {
  try {
    const {
      origin, destination, departure_date,
      vessel_speed_kt, waterways, manual_waterways,
    } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ success: false, message: 'origin and destination required.' });
    }

    const resolvedWaterways = (waterways && waterways.length > 0)
      ? waterways
      : detectWaterways(origin, destination, manual_waterways);

    const departure = departure_date
      ? new Date(departure_date)
      : new Date(Date.now() + 3 * 24 * 3600000); // default: 3 days from now

    const waypoints = calculateWaypointTimings(
      origin, destination, departure,
      vessel_speed_kt || 14,
      resolvedWaterways,
    );

    return res.json({ success: true, waterways: resolvedWaterways, waypoints });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voyage — create voyage (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const data   = req.body;

    // Resolve waterways
    const waterways = (data.waterways && data.waterways.length > 0)
      ? data.waterways
      : detectWaterways(data.origin_port, data.destination_port);

    const voyage = await createVoyage(pool, { ...data, user_id: userId, waterways });

    // Auto-generate waypoints if departure_date provided
    let waypoints = [];
    if (data.departure_date) {
      const wps = calculateWaypointTimings(
        data.origin_port, data.destination_port,
        data.departure_date,
        data.vessel_speed_kt || 14,
        waterways,
      );

      // Pre-populate vessel data into filing_data for each waypoint
      const vessel = {
        vessel_name:   data.vessel_name,
        imo_number:    data.imo_number,
        flag_state:    data.flag_state,
        call_sign:     data.call_sign,
        mmsi:          data.mmsi,
        vessel_type:   data.vessel_type,
        gross_tonnage: data.gross_tonnage,
        net_tonnage:   data.net_tonnage,
        loa:           data.loa,
        beam:          data.beam,
        draft:         data.draft,
      };
      const { buildFilingData } = require('../services/voyage-generator');
      for (const wp of wps) {
        wp.filing_data = buildFilingData(wp.waterway, vessel);
      }

      waypoints = await upsertWaypoints(pool, voyage.id, wps);
    }

    return res.status(201).json({ success: true, voyage, waypoints });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voyage — list voyages (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const voyages = await listVoyages(pool, userId, { limit, offset });
    return res.json({ success: true, voyages });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voyage/:id — get voyage + waypoints (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const voyage = await getVoyageById(pool, req.params.id, userId);
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found.' });
    return res.json({ success: true, voyage });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voyage/:id — update voyage (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const voyage = await updateVoyage(pool, req.params.id, userId, req.body);
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found.' });
    return res.json({ success: true, voyage });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/voyage/:id — soft-delete (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const result = await deleteVoyage(pool, req.params.id, userId);
    if (!result) return res.status(404).json({ success: false, message: 'Voyage not found.' });
    return res.json({ success: true, message: 'Voyage deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/voyage/:id/waypoints — replace waypoints (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:id/waypoints', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const voyage = await getVoyageById(pool, req.params.id, userId);
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found.' });

    const waypoints = await upsertWaypoints(pool, voyage.id, req.body.waypoints || []);
    const score     = computeOverallScore(waypoints);
    await updateVoyage(pool, voyage.id, userId, { overall_score: score });

    return res.json({ success: true, waypoints });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/voyage/:id/waypoints/:waterway — update single waypoint (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:id/waypoints/:waterway', requireAuth, async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const voyage   = await getVoyageById(pool, req.params.id, userId);
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found.' });

    const waypoint = await updateWaypoint(pool, voyage.id, req.params.waterway, req.body);
    if (!waypoint) return res.status(404).json({ success: false, message: 'Waypoint not found.' });

    // Recompute overall score
    const allWps = voyage.waypoints.map(w =>
      w.waterway === req.params.waterway ? { ...w, ...waypoint } : w
    );
    const score = computeOverallScore(allWps);
    await updateVoyage(pool, voyage.id, userId, { overall_score: score });

    return res.json({ success: true, waypoint, overall_score: score });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/voyage/:id/pdf — voyage compliance package PDF (auth)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const voyage = await getVoyageById(pool, req.params.id, userId);
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found.' });

    const pdf = await generateVoyageCompliancePDF(voyage, voyage.waypoints || []);

    const voyageSlug = (voyage.voyage_name || 'voyage').toLowerCase().replace(/\s+/g, '-');
    const dateSlug   = new Date().toISOString().slice(0, 10);
    const filename   = `${voyageSlug}_compliance-package_${dateSlug}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
