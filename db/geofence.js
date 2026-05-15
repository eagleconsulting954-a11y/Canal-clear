/**
 * db/geofence.js — Geofence zones and trigger event queries.
 * Owns: geofence_zones, geofence_events tables.
 * Does NOT own: vessel position data (vessel_positions — owned by AIS layer), alert sending.
 */
'use strict';

/**
 * Ensure geofence tables exist. Called at startup before the scheduler runs.
 * Idempotent — safe to call multiple times.
 */
async function ensureGeofenceTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS geofence_zones (
      id          SERIAL PRIMARY KEY,
      waterway    TEXT NOT NULL UNIQUE CHECK (waterway IN ('panama', 'suez', 'bosporus', 'malacca', 'cape')),
      center_lat  DOUBLE PRECISION NOT NULL,
      center_lng  DOUBLE PRECISION NOT NULL,
      threshold_96h_nm  INTEGER,
      threshold_72h_nm  INTEGER,
      threshold_48h_nm  INTEGER,
      threshold_24h_nm  INTEGER,
      threshold_12h_nm  INTEGER,
      threshold_6h_nm   INTEGER,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Seed default zones if missing
  await pool.query(`
    INSERT INTO geofence_zones (waterway, center_lat, center_lng, threshold_96h_nm, threshold_48h_nm, threshold_24h_nm, threshold_6h_nm)
    VALUES
      ('panama',   9.0,   -79.5, 1500, 720, 360, 90),
      ('bosporus', 41.1,   29.0, NULL, 720, 360, 90),
      ('cape',   -34.3,    18.5, 1500, 720, 360, NULL)
    ON CONFLICT (waterway) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO geofence_zones (waterway, center_lat, center_lng, threshold_72h_nm, threshold_48h_nm, threshold_24h_nm)
    VALUES ('suez', 30.0, 32.5, 1080, 720, 360)
    ON CONFLICT (waterway) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO geofence_zones (waterway, center_lat, center_lng, threshold_24h_nm, threshold_12h_nm, threshold_6h_nm)
    VALUES ('malacca', 2.5, 101.5, 360, 180, 90)
    ON CONFLICT (waterway) DO NOTHING
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS geofence_events (
      id               SERIAL PRIMARY KEY,
      vessel_id        INTEGER,
      imo_number       TEXT NOT NULL,
      vessel_name      TEXT NOT NULL,
      waterway         TEXT NOT NULL CHECK (waterway IN ('panama', 'suez', 'bosporus', 'malacca', 'cape')),
      alert_window     TEXT NOT NULL,
      zone_distance_nm DOUBLE PRECISION,
      triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      alert_id         INTEGER,
      diverted         BOOLEAN NOT NULL DEFAULT FALSE,
      diverted_at      TIMESTAMPTZ,
      UNIQUE (imo_number, waterway, alert_window)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_geofence_events_imo       ON geofence_events(imo_number)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_geofence_events_waterway  ON geofence_events(waterway)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_geofence_events_triggered ON geofence_events(triggered_at DESC)`);
}

/**
 * Get all geofence zones with their thresholds.
 */
async function getAllZones(pool) {
  const { rows } = await pool.query(
    `SELECT * FROM geofence_zones ORDER BY waterway`
  );
  return rows;
}

/**
 * Update thresholds for a single waterway zone.
 */
async function updateZone(pool, waterway, thresholds) {
  const fields = [];
  const values = [waterway];
  const allowed = ['threshold_96h_nm', 'threshold_72h_nm', 'threshold_48h_nm', 'threshold_24h_nm', 'threshold_12h_nm', 'threshold_6h_nm', 'center_lat', 'center_lng'];

  for (const key of allowed) {
    if (key in thresholds) {
      values.push(thresholds[key]);
      fields.push(`${key} = $${values.length}`);
    }
  }

  if (fields.length === 0) return null;

  values.push(new Date().toISOString());
  fields.push(`updated_at = $${values.length}`);

  const { rows } = await pool.query(
    `UPDATE geofence_zones SET ${fields.join(', ')} WHERE waterway = $1 RETURNING *`,
    values
  );
  return rows[0] || null;
}

/**
 * Check if a specific alert has already been triggered for this vessel+waterway+window.
 */
async function hasEventFired(pool, imoNumber, waterway, alertWindow) {
  const { rows } = await pool.query(
    `SELECT 1 FROM geofence_events WHERE imo_number = $1 AND waterway = $2 AND alert_window = $3`,
    [imoNumber, waterway, alertWindow]
  );
  return rows.length > 0;
}

/**
 * Record a geofence trigger event. Returns the inserted row.
 * ON CONFLICT DO NOTHING — idempotent, dedup is the UNIQUE constraint.
 */
async function recordEvent(pool, { vesselId, imoNumber, vesselName, waterway, alertWindow, distanceNm, alertId }) {
  const { rows } = await pool.query(
    `INSERT INTO geofence_events (vessel_id, imo_number, vessel_name, waterway, alert_window, zone_distance_nm, alert_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (imo_number, waterway, alert_window) DO NOTHING
     RETURNING *`,
    [vesselId || null, imoNumber, vesselName, waterway, alertWindow, distanceNm || null, alertId || null]
  );
  return rows[0] || null;
}

/**
 * Mark vessel as diverted from a canal (course-change away after trigger).
 * Does NOT cancel the alert — better safe than sorry.
 */
async function markDiverted(pool, imoNumber, waterway) {
  await pool.query(
    `UPDATE geofence_events
     SET diverted = TRUE, diverted_at = NOW()
     WHERE imo_number = $1 AND waterway = $2 AND diverted = FALSE`,
    [imoNumber, waterway]
  );
}

/**
 * Link a filing_deadlines alert_id to an existing geofence event.
 */
async function linkAlertId(pool, imoNumber, waterway, alertWindow, alertId) {
  await pool.query(
    `UPDATE geofence_events SET alert_id = $1
     WHERE imo_number = $2 AND waterway = $3 AND alert_window = $4`,
    [alertId, imoNumber, waterway, alertWindow]
  );
}

/**
 * Recent trigger events for the admin dashboard.
 */
async function getRecentEvents(pool, { waterway, limit = 100, offset = 0 } = {}) {
  const params = [];
  let where = '';
  if (waterway) {
    params.push(waterway);
    where = `WHERE e.waterway = $1`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT e.*, fd.deadline_at, fd.user_id AS deadline_user_id
     FROM geofence_events e
     LEFT JOIN filing_deadlines fd ON fd.id = e.alert_id
     ${where}
     ORDER BY e.triggered_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/**
 * Vessels currently inside any alert zone (any triggered event in the last 120h,
 * not diverted, no transit completion signal).
 */
async function getActiveVessels(pool) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (imo_number, waterway)
       imo_number, vessel_name, waterway, alert_window, zone_distance_nm, triggered_at, diverted
     FROM geofence_events
     WHERE triggered_at > NOW() - INTERVAL '120 hours'
       AND diverted = FALSE
     ORDER BY imo_number, waterway, triggered_at DESC`
  );
  return rows;
}

/**
 * Fetch the latest position for each vessel from vessel_positions (AIS layer).
 * Returns [] if the table doesn't exist yet (AIS task still deploying).
 */
async function fetchLatestVesselPositions(pool) {
  try {
    const { rows } = await pool.query(`
      SELECT
        vp.id AS position_id,
        vp.vessel_id,
        vp.imo_number,
        vp.vessel_name,
        vp.latitude,
        vp.longitude,
        vp.speed_knots,
        vp.heading,
        vp.course,
        vp.timestamp AS position_ts
      FROM vessel_positions vp
      INNER JOIN (
        SELECT imo_number, MAX(timestamp) AS latest
        FROM vessel_positions
        GROUP BY imo_number
      ) latest_pos ON vp.imo_number = latest_pos.imo_number
                   AND vp.timestamp = latest_pos.latest
      WHERE vp.latitude IS NOT NULL AND vp.longitude IS NOT NULL
    `);
    return rows;
  } catch (err) {
    if (err.message && err.message.includes('vessel_positions')) return [];
    throw err;
  }
}

/**
 * Look up the user_id associated with a vessel by IMO number.
 * Checks vessels table first, then filing history. Returns null if not in fleet.
 */
async function lookupVesselUserId(pool, imoNumber) {
  try {
    const { rows } = await pool.query(
      `SELECT user_id FROM vessels WHERE imo = $1 LIMIT 1`,
      [imoNumber]
    );
    if (rows.length && rows[0].user_id) return rows[0].user_id;
  } catch (_) {}

  const filingTables = ['sp1_filings', 'malacca_filings', 'cape_filings'];
  for (const tbl of filingTables) {
    try {
      const { rows } = await pool.query(
        `SELECT user_id FROM ${tbl} WHERE imo_number = $1 AND deleted_at IS NULL LIMIT 1`,
        [imoNumber]
      );
      if (rows.length && rows[0].user_id) return rows[0].user_id;
    } catch (_) {}
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id FROM filing_deadlines WHERE imo_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [imoNumber]
    );
    if (rows.length && rows[0].user_id) return rows[0].user_id;
  } catch (_) {}

  return null;
}

/**
 * Find an existing filing_deadlines record for this vessel+waterway.
 * Returns the deadline id, or null if none.
 */
async function findExistingDeadlineId(pool, imoNumber, waterway) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM filing_deadlines
       WHERE imo_number = $1 AND waterway = $2 AND alerts_enabled = TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [imoNumber, waterway]
    );
    return rows.length ? rows[0].id : null;
  } catch (_) {
    return null;
  }
}

/**
 * Check if any (non-diverted) geofence event has already fired for this vessel+waterway.
 * Used to detect diversions — vessel had crossed a threshold but is now heading away.
 */
async function hasAnyEventFired(pool, imoNumber, waterway) {
  const { rows } = await pool.query(
    `SELECT 1 FROM geofence_events WHERE imo_number = $1 AND waterway = $2 AND diverted = FALSE LIMIT 1`,
    [imoNumber, waterway]
  );
  return rows.length > 0;
}

module.exports = {
  ensureGeofenceTables,
  getAllZones,
  updateZone,
  hasEventFired,
  hasAnyEventFired,
  recordEvent,
  markDiverted,
  linkAlertId,
  getRecentEvents,
  getActiveVessels,
  fetchLatestVesselPositions,
  lookupVesselUserId,
  findExistingDeadlineId,
};
