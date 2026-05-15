/**
 * db/voyages.js — SQL query functions for voyages + voyage_waypoints tables
 *
 * Owns: all SQL queries for unified voyage planning (voyages, voyage_waypoints).
 * Does NOT own: validation logic, filing generation, route handling, pool construction.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 * Soft deletes: voyages filtered by deleted_at IS NULL by default.
 */

/**
 * Create a new voyage record.
 */
async function createVoyage(pool, fields) {
  const {
    user_id, voyage_name, vessel_name, imo_number, flag_state, call_sign, mmsi,
    vessel_type, gross_tonnage, net_tonnage, loa, beam, draft,
    origin_port, destination_port, departure_date, arrival_date,
    vessel_speed_kt, waterways, notes,
  } = fields;

  const result = await pool.query(`
    INSERT INTO voyages (
      user_id, voyage_name, vessel_name, imo_number, flag_state, call_sign, mmsi,
      vessel_type, gross_tonnage, net_tonnage, loa, beam, draft,
      origin_port, destination_port, departure_date, arrival_date,
      vessel_speed_kt, waterways, notes,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20,
      NOW(), NOW()
    )
    RETURNING *
  `, [
    user_id, voyage_name || 'Unnamed Voyage',
    vessel_name, imo_number, flag_state, call_sign, mmsi,
    vessel_type, gross_tonnage, net_tonnage, loa, beam, draft,
    origin_port, destination_port, departure_date || null, arrival_date || null,
    vessel_speed_kt || 14.0, waterways || [], notes || null,
  ]);

  return result.rows[0];
}

/**
 * List voyages for a user (excludes soft-deleted).
 */
async function listVoyages(pool, userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(`
    SELECT v.*,
      COUNT(w.id) AS waypoint_count
    FROM voyages v
    LEFT JOIN voyage_waypoints w ON w.voyage_id = v.id
    WHERE v.user_id = $1
      AND v.deleted_at IS NULL
    GROUP BY v.id
    ORDER BY v.created_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);
  return result.rows;
}

/**
 * Get a single voyage by id (with waypoints), owned by userId.
 */
async function getVoyageById(pool, id, userId) {
  const [voyageRes, waypointsRes] = await Promise.all([
    pool.query(`
      SELECT * FROM voyages
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    `, [id, userId]),
    pool.query(`
      SELECT * FROM voyage_waypoints
      WHERE voyage_id = $1
      ORDER BY sequence_order ASC
    `, [id]),
  ]);
  if (!voyageRes.rows[0]) return null;
  return { ...voyageRes.rows[0], waypoints: waypointsRes.rows };
}

/**
 * Update voyage fields.
 */
async function updateVoyage(pool, id, userId, fields) {
  const {
    voyage_name, vessel_name, imo_number, flag_state, call_sign, mmsi,
    vessel_type, gross_tonnage, net_tonnage, loa, beam, draft,
    origin_port, destination_port, departure_date, arrival_date,
    vessel_speed_kt, waterways, overall_score, status, notes,
  } = fields;

  const result = await pool.query(`
    UPDATE voyages SET
      voyage_name = COALESCE($3, voyage_name),
      vessel_name = COALESCE($4, vessel_name),
      imo_number = COALESCE($5, imo_number),
      flag_state = COALESCE($6, flag_state),
      call_sign = COALESCE($7, call_sign),
      mmsi = COALESCE($8, mmsi),
      vessel_type = COALESCE($9, vessel_type),
      gross_tonnage = COALESCE($10, gross_tonnage),
      net_tonnage = COALESCE($11, net_tonnage),
      loa = COALESCE($12, loa),
      beam = COALESCE($13, beam),
      draft = COALESCE($14, draft),
      origin_port = COALESCE($15, origin_port),
      destination_port = COALESCE($16, destination_port),
      departure_date = COALESCE($17, departure_date),
      arrival_date = COALESCE($18, arrival_date),
      vessel_speed_kt = COALESCE($19, vessel_speed_kt),
      waterways = COALESCE($20, waterways),
      overall_score = COALESCE($21, overall_score),
      status = COALESCE($22, status),
      notes = COALESCE($23, notes),
      updated_at = NOW()
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    RETURNING *
  `, [
    id, userId,
    voyage_name, vessel_name, imo_number, flag_state, call_sign, mmsi,
    vessel_type, gross_tonnage, net_tonnage, loa, beam, draft,
    origin_port, destination_port, departure_date || null, arrival_date || null,
    vessel_speed_kt || null, waterways || null, overall_score || null, status || null, notes || null,
  ]);
  return result.rows[0] || null;
}

/**
 * Soft-delete a voyage.
 */
async function deleteVoyage(pool, id, userId) {
  const result = await pool.query(`
    UPDATE voyages SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    RETURNING id
  `, [id, userId]);
  return result.rows[0] || null;
}

/**
 * Upsert waypoints for a voyage (replaces all existing waypoints).
 */
async function upsertWaypoints(pool, voyageId, waypoints) {
  // Delete existing, then insert new
  await pool.query(`DELETE FROM voyage_waypoints WHERE voyage_id = $1`, [voyageId]);

  if (!waypoints || waypoints.length === 0) return [];

  const inserted = [];
  for (let i = 0; i < waypoints.length; i++) {
    const w = waypoints[i];
    const result = await pool.query(`
      INSERT INTO voyage_waypoints (
        voyage_id, waterway, sequence_order, port_entry, port_exit,
        eta, etd, transit_hours, filing_deadline, filing_status,
        compliance_score, filing_data, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
      RETURNING *
    `, [
      voyageId,
      w.waterway,
      i,
      w.port_entry || null,
      w.port_exit || null,
      w.eta || null,
      w.etd || null,
      w.transit_hours || null,
      w.filing_deadline || null,
      w.filing_status || 'pending',
      w.compliance_score || 0,
      w.filing_data ? JSON.stringify(w.filing_data) : '{}',
    ]);
    inserted.push(result.rows[0]);
  }
  return inserted;
}

/**
 * Update a single waypoint's filing status/score.
 */
async function updateWaypoint(pool, voyageId, waterway, fields) {
  const { filing_status, compliance_score, filing_data, eta, etd, filing_deadline } = fields;
  const result = await pool.query(`
    UPDATE voyage_waypoints SET
      filing_status = COALESCE($3, filing_status),
      compliance_score = COALESCE($4, compliance_score),
      filing_data = COALESCE($5::jsonb, filing_data),
      eta = COALESCE($6, eta),
      etd = COALESCE($7, etd),
      filing_deadline = COALESCE($8, filing_deadline),
      updated_at = NOW()
    WHERE voyage_id = $1 AND waterway = $2
    RETURNING *
  `, [
    voyageId, waterway,
    filing_status || null,
    compliance_score !== undefined ? compliance_score : null,
    filing_data ? JSON.stringify(filing_data) : null,
    eta || null,
    etd || null,
    filing_deadline || null,
  ]);
  return result.rows[0] || null;
}

module.exports = {
  createVoyage,
  listVoyages,
  getVoyageById,
  updateVoyage,
  deleteVoyage,
  upsertWaypoints,
  updateWaypoint,
};
