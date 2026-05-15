/**
 * db/ais-positions.js — AIS vessel position data access layer.
 *
 * Owns: all SQL against vessel_positions, vessel_tracks, ais_provider_config.
 * Does NOT own: position computation, mock data generation, provider logic, route handling.
 *
 * All callers pass `pool` from req.app.locals.pool.
 */

// ─────────────────────────────────────────────────────────────────────────────
// vessel_positions — individual position records
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a batch of position records. Returns inserted count.
 * @param {object} pool
 * @param {Array<object>} positions - Array of position objects
 */
async function insertPositions(pool, positions) {
  if (!positions || positions.length === 0) return 0;

  const values = [];
  const placeholders = positions.map((p, i) => {
    const base = i * 10;
    values.push(
      p.vessel_id ?? null,
      p.imo_number,
      p.vessel_name,
      p.mmsi ?? null,
      p.latitude,
      p.longitude,
      p.speed_knots ?? 0,
      p.heading ?? null,
      p.course ?? null,
      p.nav_status ?? 'underway'
    );
    return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`;
  });

  // source defaults to 'mock' at DB level; callers override via UPDATE if needed
  await pool.query(
    `INSERT INTO vessel_positions
       (vessel_id, imo_number, vessel_name, mmsi, latitude, longitude,
        speed_knots, heading, course, nav_status)
     VALUES ${placeholders.join(', ')}`,
    values
  );

  return positions.length;
}

/**
 * Insert a single position record. Returns the created row.
 */
async function insertPosition(pool, p) {
  const result = await pool.query(
    `INSERT INTO vessel_positions
       (vessel_id, imo_number, vessel_name, mmsi, latitude, longitude,
        speed_knots, heading, course, nav_status, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      p.vessel_id ?? null,
      p.imo_number,
      p.vessel_name,
      p.mmsi ?? null,
      p.latitude,
      p.longitude,
      p.speed_knots ?? 0,
      p.heading ?? null,
      p.course ?? null,
      p.nav_status ?? 'underway',
      p.source ?? 'mock',
    ]
  );
  return result.rows[0];
}

/**
 * Get all current vessel positions (latest per IMO).
 * Optional filters: imo (string), waterway (string — checks canal proximity).
 * @returns {Array<object>}
 */
async function getAllCurrentPositions(pool, { imo, waterway } = {}) {
  // Use DISTINCT ON to return one row per IMO (most recent)
  let query = `
    SELECT DISTINCT ON (vp.imo_number)
      vp.id, vp.imo_number, vp.vessel_name, vp.mmsi,
      vp.latitude, vp.longitude, vp.speed_knots, vp.heading, vp.course,
      vp.nav_status, vp.source, vp.timestamp,
      vt.dist_panama_nm, vt.dist_suez_nm, vt.dist_bosporus_nm,
      vt.dist_malacca_nm, vt.dist_cape_nm,
      vt.eta_panama_h, vt.eta_suez_h, vt.eta_bosporus_h,
      vt.eta_malacca_h, vt.eta_cape_h
    FROM vessel_positions vp
    LEFT JOIN vessel_tracks vt ON vt.imo_number = vp.imo_number
    WHERE 1=1
  `;
  const params = [];

  if (imo) {
    params.push(imo);
    query += ` AND vp.imo_number = $${params.length}`;
  }

  if (waterway) {
    // Filter to vessels within reasonable proximity of the canal
    const distCol = `vt.dist_${waterway}_nm`;
    query += ` AND ${distCol} IS NOT NULL AND ${distCol} < 2000`;
  }

  query += ` ORDER BY vp.imo_number, vp.timestamp DESC`;
  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Get single vessel current position + last 72h track.
 * @param {string} imo
 * @returns {{ current: object|null, track: Array<object> }}
 */
async function getVesselTrack(pool, imo) {
  const [current, track] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (imo_number)
         id, imo_number, vessel_name, mmsi, latitude, longitude,
         speed_knots, heading, course, nav_status, source, timestamp
       FROM vessel_positions
       WHERE imo_number = $1
       ORDER BY imo_number, timestamp DESC
       LIMIT 1`,
      [imo]
    ),
    pool.query(
      `SELECT id, latitude, longitude, speed_knots, heading, course,
              nav_status, source, timestamp
       FROM vessel_positions
       WHERE imo_number = $1
         AND timestamp >= NOW() - INTERVAL '72 hours'
       ORDER BY timestamp DESC
       LIMIT 500`,
      [imo]
    ),
  ]);

  return {
    current: current.rows[0] ?? null,
    track: track.rows,
  };
}

/**
 * Get all vessels within configurable distance of a canal.
 * @param {string} waterway - 'panama'|'suez'|'bosporus'|'malacca'|'cape'
 * @param {number} maxDistNm - distance threshold in nautical miles (default 1000)
 */
async function getVesselsNearWaterway(pool, waterway, maxDistNm = 1000) {
  const distCol = `dist_${waterway}_nm`;
  const etaCol  = `eta_${waterway}_h`;

  // Validate waterway to avoid SQL injection
  const valid = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  if (!valid.includes(waterway)) throw new Error(`Invalid waterway: ${waterway}`);

  const result = await pool.query(
    `SELECT
       vt.imo_number, vt.vessel_name, vt.mmsi,
       vt.last_latitude AS latitude, vt.last_longitude AS longitude,
       vt.last_speed_knots AS speed_knots, vt.last_heading AS heading,
       vt.last_nav_status AS nav_status, vt.last_seen_at AS timestamp,
       vt.${distCol} AS distance_nm, vt.${etaCol} AS eta_hours,
       vt.source
     FROM vessel_tracks vt
     WHERE vt.${distCol} IS NOT NULL
       AND vt.${distCol} <= $1
       AND vt.last_seen_at >= NOW() - INTERVAL '2 hours'
     ORDER BY vt.${distCol} ASC`,
    [maxDistNm]
  );
  return result.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// vessel_tracks — materialised latest state per vessel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert vessel track row with computed canal distances + ETAs.
 * Called after each position update.
 */
async function upsertVesselTrack(pool, data) {
  await pool.query(
    `INSERT INTO vessel_tracks
       (imo_number, vessel_name, mmsi, vessel_id,
        last_latitude, last_longitude, last_speed_knots, last_heading,
        last_nav_status, last_seen_at,
        dist_panama_nm, dist_suez_nm, dist_bosporus_nm, dist_malacca_nm, dist_cape_nm,
        eta_panama_h, eta_suez_h, eta_bosporus_h, eta_malacca_h, eta_cape_h,
        source, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
     ON CONFLICT (imo_number) DO UPDATE SET
       vessel_name       = EXCLUDED.vessel_name,
       mmsi              = EXCLUDED.mmsi,
       vessel_id         = EXCLUDED.vessel_id,
       last_latitude     = EXCLUDED.last_latitude,
       last_longitude    = EXCLUDED.last_longitude,
       last_speed_knots  = EXCLUDED.last_speed_knots,
       last_heading      = EXCLUDED.last_heading,
       last_nav_status   = EXCLUDED.last_nav_status,
       last_seen_at      = EXCLUDED.last_seen_at,
       dist_panama_nm    = EXCLUDED.dist_panama_nm,
       dist_suez_nm      = EXCLUDED.dist_suez_nm,
       dist_bosporus_nm  = EXCLUDED.dist_bosporus_nm,
       dist_malacca_nm   = EXCLUDED.dist_malacca_nm,
       dist_cape_nm      = EXCLUDED.dist_cape_nm,
       eta_panama_h      = EXCLUDED.eta_panama_h,
       eta_suez_h        = EXCLUDED.eta_suez_h,
       eta_bosporus_h    = EXCLUDED.eta_bosporus_h,
       eta_malacca_h     = EXCLUDED.eta_malacca_h,
       eta_cape_h        = EXCLUDED.eta_cape_h,
       source            = EXCLUDED.source,
       updated_at        = NOW()`,
    [
      data.imo_number, data.vessel_name, data.mmsi ?? null, data.vessel_id ?? null,
      data.latitude, data.longitude, data.speed_knots ?? 0, data.heading ?? null,
      data.nav_status ?? 'underway', data.timestamp ?? new Date(),
      data.dist_panama_nm ?? null, data.dist_suez_nm ?? null,
      data.dist_bosporus_nm ?? null, data.dist_malacca_nm ?? null, data.dist_cape_nm ?? null,
      data.eta_panama_h ?? null, data.eta_suez_h ?? null,
      data.eta_bosporus_h ?? null, data.eta_malacca_h ?? null, data.eta_cape_h ?? null,
      data.source ?? 'mock',
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ais_provider_config
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the active provider configuration row.
 */
async function getProviderConfig(pool) {
  const result = await pool.query(
    `SELECT id, provider, api_key, poll_interval_sec, enabled, updated_at
     FROM ais_provider_config
     ORDER BY id LIMIT 1`
  );
  return result.rows[0] ?? null;
}

/**
 * Update provider config. Returns the updated row.
 * @param {object} pool
 * @param {object} fields - { provider, api_key, poll_interval_sec, enabled }
 */
async function updateProviderConfig(pool, fields) {
  const setClauses = [];
  const values = [];

  if (fields.provider !== undefined) {
    values.push(fields.provider);
    setClauses.push(`provider = $${values.length}`);
  }
  if (fields.api_key !== undefined) {
    values.push(fields.api_key);
    setClauses.push(`api_key = $${values.length}`);
  }
  if (fields.poll_interval_sec !== undefined) {
    values.push(fields.poll_interval_sec);
    setClauses.push(`poll_interval_sec = $${values.length}`);
  }
  if (fields.enabled !== undefined) {
    values.push(fields.enabled);
    setClauses.push(`enabled = $${values.length}`);
  }

  if (setClauses.length === 0) return await getProviderConfig(pool);

  setClauses.push(`updated_at = NOW()`);

  const result = await pool.query(
    `UPDATE ais_provider_config SET ${setClauses.join(', ')}
     WHERE id = (SELECT id FROM ais_provider_config ORDER BY id LIMIT 1)
     RETURNING *`,
    values
  );
  return result.rows[0];
}

/**
 * Delete vessel_positions older than retentionHours (default 72).
 * Called periodically to keep the table lean.
 */
async function pruneOldPositions(pool, retentionHours = 72) {
  const result = await pool.query(
    `DELETE FROM vessel_positions
     WHERE timestamp < NOW() - ($1 || ' hours')::INTERVAL`,
    [retentionHours]
  );
  return result.rowCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// vessels table — IMO linkage helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve IMO numbers to vessels.id values in a single batch query.
 * Returns a map of { imo: vessel_id }.
 * Returns empty map on error (graceful degradation — vessel_id stays null).
 * @param {object} pool
 * @param {string[]} imoList
 */
async function resolveVesselIds(pool, imoList) {
  if (!imoList || imoList.length === 0) return {};
  try {
    const placeholders = imoList.map((_, i) => `$${i + 1}`).join(',');
    // vessels table uses column 'imo' (created by alert_system migration),
    // NOT 'imo_number' (the onboarding migration was a no-op due to IF NOT EXISTS)
    const result = await pool.query(
      `SELECT id, imo FROM vessels
       WHERE imo = ANY(ARRAY[${placeholders}]::TEXT[])`,
      imoList
    );
    const map = {};
    for (const row of result.rows) {
      map[row.imo] = row.id;
    }
    return map;
  } catch (_err) {
    // Graceful degradation: AIS positions still recorded — vessel_id stays null.
    return {};
  }
}

module.exports = {
  insertPosition,
  insertPositions,
  getAllCurrentPositions,
  getVesselTrack,
  getVesselsNearWaterway,
  upsertVesselTrack,
  getProviderConfig,
  updateProviderConfig,
  pruneOldPositions,
  resolveVesselIds,
};
