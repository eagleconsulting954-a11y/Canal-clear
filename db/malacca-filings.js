/**
 * db/malacca-filings.js — SQL query functions for malacca_filings table
 *
 * Owns: all SQL queries against malacca_filings table.
 * Does NOT own: validation logic, route handling, pool construction, or auth.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 * Soft deletes: all read operations filter deleted_at IS NULL by default.
 */

/**
 * Create a new STRAITREP filing. Returns the created row.
 */
async function createMalaccaFiling(pool, fields) {
  const {
    user_id, imo_number, vessel_name, flag_state, call_sign, mmsi, vessel_type,
    gross_tonnage, net_tonnage, loa, beam, draft,
    transit_direction, last_port, next_port, estimated_arrival,
    cargo_type, cargo_quantity, dangerous_goods_class,
    crew_count, speed_knots,
    agent_name, agent_contact,
    vhf_watch, pilotage_booked, isps_compliant,
    has_dangerous_goods,
    compliance_score,
    filing_status,
    document_data,
  } = fields;

  const result = await pool.query(`
    INSERT INTO malacca_filings (
      user_id,
      imo_number, vessel_name, flag_state, call_sign, mmsi, vessel_type,
      gross_tonnage, net_tonnage, loa, beam, draft,
      transit_direction, last_port, next_port, estimated_arrival,
      cargo_type, cargo_quantity, dangerous_goods_class,
      crew_count, speed_knots,
      agent_name, agent_contact,
      vhf_watch, pilotage_booked, isps_compliant,
      has_dangerous_goods,
      compliance_score,
      filing_status,
      document_data,
      created_at, updated_at
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      $22, $23,
      $24, $25, $26,
      $27,
      $28,
      $29,
      $30,
      NOW(), NOW()
    )
    RETURNING *
  `, [
    user_id,
    imo_number, vessel_name, flag_state, call_sign, mmsi, vessel_type,
    gross_tonnage, net_tonnage, loa, beam, draft,
    transit_direction, last_port, next_port, estimated_arrival,
    cargo_type, cargo_quantity, dangerous_goods_class,
    crew_count, speed_knots,
    agent_name, agent_contact,
    vhf_watch, pilotage_booked, isps_compliant,
    has_dangerous_goods,
    compliance_score,
    filing_status || 'draft',
    document_data ? JSON.stringify(document_data) : '{}',
  ]);

  return result.rows[0];
}

/**
 * Get a single filing by ID (soft-delete aware).
 */
async function getMalaccaFilingById(pool, id, userId) {
  const result = await pool.query(
    `SELECT * FROM malacca_filings WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  );
  return result.rows[0] || null;
}

/**
 * List filings for a user (soft-delete aware, newest first).
 */
async function listMalaccaFilings(pool, userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT * FROM malacca_filings
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

/**
 * Update an existing filing.
 */
async function updateMalaccaFiling(pool, id, userId, data) {
  const sets = [];
  const vals = [];
  let idx = 1;

  const allowed = [
    'imo_number', 'vessel_name', 'flag_state', 'call_sign', 'mmsi', 'vessel_type',
    'gross_tonnage', 'net_tonnage', 'loa', 'beam', 'draft',
    'transit_direction', 'last_port', 'next_port', 'estimated_arrival',
    'cargo_type', 'cargo_quantity', 'dangerous_goods_class',
    'crew_count', 'speed_knots',
    'agent_name', 'agent_contact',
    'vhf_watch', 'pilotage_booked', 'isps_compliant',
    'has_dangerous_goods', 'compliance_score', 'filing_status', 'document_data',
  ];

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${idx++}`);
      vals.push(key === 'document_data' ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(id, userId);

  const result = await pool.query(
    `UPDATE malacca_filings SET ${sets.join(', ')}
     WHERE id = $${idx++} AND user_id = $${idx++} AND deleted_at IS NULL
     RETURNING *`,
    vals
  );
  return result.rows[0] || null;
}

/**
 * Soft-delete a filing.
 */
async function deleteMalaccaFiling(pool, id, userId) {
  const result = await pool.query(
    `UPDATE malacca_filings SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [id, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createMalaccaFiling,
  getMalaccaFilingById,
  listMalaccaFilings,
  updateMalaccaFiling,
  deleteMalaccaFiling,
};
