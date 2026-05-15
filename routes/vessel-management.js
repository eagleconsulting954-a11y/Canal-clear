/**
 * routes/vessel-management.js — Fleet vessel management API
 *
 * Owns: /api/vessels CRUD, compliance status per waterway, CSV bulk import,
 *       demo vessel seeding, and per-vessel compliance cache.
 * Does NOT own: AIS tracking (routes/fleet.js), certificate management (routes/api.js),
 *               filing submission (routes/api.js, bosporus.js, etc).
 */

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { requireAuthOrDemo } = require('../middleware/demoAuth');

// ── Helpers ─────────────────────────────────────────────────────────────────

function pool(req) { return req.app.locals.pool; }

// Waterways CanalClear covers
const WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

// Demo vessel seeds — one of each major type
const DEMO_VESSELS = [
  {
    name: 'MV Pacific Pioneer',
    imo: '9234501',
    flag: 'Panama',
    type: 'Container',
    gt: 62500,
    nt: 35000,
    loa: 294.0,
    beam: 32.2,
    max_draft: 14.5,
    is_sample: true,
  },
  {
    name: 'MT Atlantic Meridian',
    imo: '9345612',
    flag: 'Greece',
    type: 'Tanker',
    gt: 105000,
    nt: 58000,
    loa: 274.0,
    beam: 48.0,
    max_draft: 17.0,
    is_sample: true,
  },
  {
    name: 'MV Stellar Harvest',
    imo: '9456723',
    flag: 'Marshall Islands',
    type: 'Bulk Carrier',
    gt: 87000,
    nt: 52000,
    loa: 250.0,
    beam: 42.0,
    max_draft: 15.2,
    is_sample: true,
  },
];

// Derive a per-waterway compliance badge from cached data (or default yellow if no data)
function buildComplianceMap(cacheRows) {
  const map = {};
  for (const w of WATERWAYS) {
    const row = cacheRows.find(r => r.waterway === w);
    map[w] = row ? { status: row.status, score: row.score, validated_at: row.validated_at } : { status: 'unknown', score: null, validated_at: null };
  }
  return map;
}

// ── GET /api/vessels — list fleet with per-waterway compliance ───────────────
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const p = pool(req);

  try {
    // Seed demo vessels for demo accounts that have none
    await ensureDemoVessels(p, userId, req.user);

    const { rows: vessels } = await p.query(
      `SELECT id, name, imo, flag, type, gt, nt, loa, beam, max_draft, class_society, status, is_sample, created_at
       FROM vessels
       WHERE user_id = $1 AND status != 'deleted'
       ORDER BY created_at DESC`,
      [userId]
    );

    if (vessels.length === 0) {
      return res.json({ success: true, vessels: [], total: 0 });
    }

    const vesselIds = vessels.map(v => v.id);
    const { rows: cache } = await p.query(
      `SELECT vessel_id, waterway, status, score, validated_at
       FROM fleet_compliance_cache
       WHERE vessel_id = ANY($1)`,
      [vesselIds]
    );

    const result = vessels.map(v => ({
      ...v,
      compliance: buildComplianceMap(cache.filter(c => c.vessel_id === v.id)),
    }));

    res.json({ success: true, vessels: result, total: result.length });
  } catch (err) {
    console.error('[vessel-management] list error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/vessels — add vessel ──────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { name, imo, flag, type, gt, nt, loa, beam, max_draft, class_society } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ success: false, message: 'Vessel name is required' });
  }
  if (imo && !/^\d{7}$/.test(imo.trim())) {
    return res.status(400).json({ success: false, message: 'IMO number must be exactly 7 digits' });
  }

  try {
    const { rows } = await pool(req).query(
      `INSERT INTO vessels (user_id, name, imo, flag, type, gt, nt, loa, beam, max_draft, class_society, status, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', false)
       RETURNING *`,
      [
        userId,
        name.trim(),
        imo ? imo.trim() : null,
        flag || null,
        type || null,
        gt    ? parseInt(gt,    10) : null,
        nt    ? parseInt(nt,    10) : null,
        loa   ? parseFloat(loa)   : null,
        beam  ? parseFloat(beam)  : null,
        max_draft ? parseFloat(max_draft) : null,
        class_society || null,
      ]
    );
    res.json({ success: true, vessel: rows[0] });
  } catch (err) {
    console.error('[vessel-management] create error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/vessels/:id — single vessel with compliance ─────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const vesselId = parseInt(req.params.id, 10);
  const p = pool(req);

  try {
    const { rows } = await p.query(
      `SELECT * FROM vessels WHERE id = $1 AND user_id = $2 AND status != 'deleted'`,
      [vesselId, userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Vessel not found' });
    }

    const { rows: cache } = await p.query(
      `SELECT waterway, status, score, issues, validated_at FROM fleet_compliance_cache WHERE vessel_id = $1`,
      [vesselId]
    );

    const { rows: recentFilings } = await p.query(
      `SELECT f.id, f.canal, f.status, f.created_at, f.reference_number
       FROM filings f
       WHERE f.user_id = $1 AND (f.imo_number = $2 OR LOWER(f.vessel_name) = LOWER($3))
       ORDER BY f.created_at DESC LIMIT 10`,
      [userId, rows[0].imo || '', rows[0].name]
    );

    res.json({
      success: true,
      vessel: {
        ...rows[0],
        compliance: buildComplianceMap(cache),
        recent_filings: recentFilings,
      },
    });
  } catch (err) {
    console.error('[vessel-management] get error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/vessels/:id — update vessel ─────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const vesselId = parseInt(req.params.id, 10);
  const { name, imo, flag, type, gt, nt, loa, beam, max_draft, class_society } = req.body;

  if (imo && !/^\d{7}$/.test(imo.trim())) {
    return res.status(400).json({ success: false, message: 'IMO number must be exactly 7 digits' });
  }

  try {
    const { rows } = await pool(req).query(
      `UPDATE vessels
       SET name          = COALESCE($1, name),
           imo           = COALESCE($2, imo),
           flag          = COALESCE($3, flag),
           type          = COALESCE($4, type),
           gt            = COALESCE($5, gt),
           nt            = COALESCE($6, nt),
           loa           = COALESCE($7, loa),
           beam          = COALESCE($8, beam),
           max_draft     = COALESCE($9, max_draft),
           class_society = COALESCE($10, class_society),
           updated_at    = NOW()
       WHERE id = $11 AND user_id = $12 AND status != 'deleted'
       RETURNING *`,
      [
        name ? name.trim() : null,
        imo  ? imo.trim()  : null,
        flag || null,
        type || null,
        gt    ? parseInt(gt, 10)   : null,
        nt    ? parseInt(nt, 10)   : null,
        loa   ? parseFloat(loa)    : null,
        beam  ? parseFloat(beam)   : null,
        max_draft ? parseFloat(max_draft) : null,
        class_society || null,
        vesselId,
        userId,
      ]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Vessel not found' });
    }
    res.json({ success: true, vessel: rows[0] });
  } catch (err) {
    console.error('[vessel-management] update error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/vessels/:id — soft delete ────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const vesselId = parseInt(req.params.id, 10);

  try {
    const { rowCount } = await pool(req).query(
      `UPDATE vessels SET status = 'deleted', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status != 'deleted'`,
      [vesselId, userId]
    );
    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Vessel not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[vessel-management] delete error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/vessels/bulk-import — CSV upload ───────────────────────────────
// Accepts: array of { imo, name, flag, type } objects (parsed client-side)
router.post('/bulk-import', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { vessels } = req.body;

  if (!Array.isArray(vessels) || vessels.length === 0) {
    return res.status(400).json({ success: false, message: 'No vessels provided' });
  }
  if (vessels.length > 500) {
    return res.status(400).json({ success: false, message: 'Maximum 500 vessels per import' });
  }

  const p = pool(req);
  let imported = 0;
  let skipped  = 0;
  const errors = [];

  for (const v of vessels) {
    const name = (v.name || '').trim();
    const imo  = (v.imo  || '').replace(/\s/g, '');
    if (!name) { skipped++; continue; }
    if (imo && !/^\d{7}$/.test(imo)) {
      errors.push(`Skipped "${name}" — invalid IMO ${imo}`);
      skipped++;
      continue;
    }
    try {
      await p.query(
        `INSERT INTO vessels (user_id, name, imo, flag, type, status, is_sample)
         VALUES ($1, $2, $3, $4, $5, 'active', false)
         ON CONFLICT DO NOTHING`,
        [userId, name, imo || null, (v.flag || null), (v.type || null)]
      );
      imported++;
    } catch (err) {
      errors.push(`Error importing "${name}": ${err.message}`);
      skipped++;
    }
  }

  res.json({ success: true, imported, skipped, errors });
});

// ── POST /api/vessels/:id/validate/:waterway — run pre-transit validation ───
router.post('/:id/validate/:waterway', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const vesselId = parseInt(req.params.id, 10);
  const waterway = req.params.waterway;
  const p = pool(req);

  if (!WATERWAYS.includes(waterway)) {
    return res.status(400).json({ success: false, message: `Unknown waterway: ${waterway}` });
  }

  try {
    const { rows } = await p.query(
      `SELECT * FROM vessels WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [vesselId, userId]
    );
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Vessel not found' });
    }

    // Simple readiness check based on vessel data completeness
    const vessel = rows[0];
    const issues = [];
    if (!vessel.imo)       issues.push({ field: 'imo',       message: 'IMO number required for all waterways' });
    if (!vessel.flag)      issues.push({ field: 'flag',      message: 'Flag state required for compliance check' });
    if (!vessel.type)      issues.push({ field: 'type',      message: 'Vessel type needed for route-specific requirements' });
    if (!vessel.gt)        issues.push({ field: 'gt',        message: 'Gross tonnage required for authority filings' });
    if (!vessel.loa)       issues.push({ field: 'loa',       message: 'LOA required for transit slot booking' });
    if (!vessel.max_draft) issues.push({ field: 'max_draft', message: 'Max draft required for canal clearance check' });

    // Waterway-specific checks
    if (waterway === 'panama') {
      if (vessel.max_draft && parseFloat(vessel.max_draft) > 15.24) {
        issues.push({ field: 'max_draft', message: `Draft ${vessel.max_draft}m exceeds Panama Canal Neopanamax limit (15.24m) — restricted transit` });
      }
      if (vessel.loa && parseFloat(vessel.loa) > 366) {
        issues.push({ field: 'loa', message: 'LOA exceeds Panama Canal maximum (366m) — transit not possible' });
      }
    }
    if (waterway === 'suez') {
      if (vessel.max_draft && parseFloat(vessel.max_draft) > 20.1) {
        issues.push({ field: 'max_draft', message: `Draft ${vessel.max_draft}m exceeds Suez Canal limit (20.1m)` });
      }
    }
    if (waterway === 'bosporus') {
      if (vessel.loa && parseFloat(vessel.loa) > 350) {
        issues.push({ field: 'loa', message: 'LOA exceeds Bosporus transit maximum (350m)' });
      }
    }

    const score  = Math.max(0, 100 - issues.length * 15);
    const status = issues.length === 0 ? 'green' : issues.length <= 2 ? 'yellow' : 'red';

    // Upsert compliance cache
    await p.query(
      `INSERT INTO fleet_compliance_cache (vessel_id, user_id, waterway, score, status, issues, validated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (vessel_id, waterway)
       DO UPDATE SET score = $4, status = $5, issues = $6, validated_at = NOW()`,
      [vesselId, userId, waterway, score, status, JSON.stringify(issues)]
    );

    res.json({ success: true, waterway, score, status, issues, vessel_id: vesselId });
  } catch (err) {
    console.error('[vessel-management] validate error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Demo vessel seeding ──────────────────────────────────────────────────────
async function ensureDemoVessels(p, userId, user) {
  // Only seed for demo sessions (is_demo) or users with 0 vessels
  // We detect "demo account" from the plan_type or is_demo flag on user context
  if (!user || !user.is_demo) return;

  const { rows } = await p.query(
    'SELECT COUNT(*)::int AS cnt FROM vessels WHERE user_id = $1',
    [userId]
  );
  if (rows[0].cnt > 0) return;

  for (const v of DEMO_VESSELS) {
    await p.query(
      `INSERT INTO vessels (user_id, name, imo, flag, type, gt, nt, loa, beam, max_draft, status, is_sample)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', true)
       ON CONFLICT DO NOTHING`,
      [userId, v.name, v.imo, v.flag, v.type, v.gt, v.nt, v.loa, v.beam, v.max_draft]
    );
  }
}

module.exports = router;
