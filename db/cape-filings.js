/**
 * db/cape-filings.js — SQL query functions for cape_filings table
 *
 * Owns: all SQL queries against cape_filings (Cape of Good Hope ISPS pre-arrival filings).
 * Does NOT own: validation logic, route handling, pool construction, or auth.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 * Soft deletes: all read operations filter deleted_at IS NULL by default.
 */

/**
 * Create a new Cape of Good Hope ISPS pre-arrival filing.
 */
async function createCapeFiling(pool, fields) {
  const {
    user_id, vessel_name, imo_number, flag_state, call_sign, mmsi, vessel_type,
    gross_tonnage, net_tonnage, loa, beam, draft,
    port_of_origin, next_port, estimated_arrival,
    cargo_summary, crew_count,
    isps_security_level, last_10_ports,
    has_dangerous_goods, dangerous_goods_class, dangerous_goods_detail,
    sso_name, sso_contact, sso_email,
    compliance_score, filing_status,
    deadline_96h_at, document_data,
  } = fields;

  const result = await pool.query(`
    INSERT INTO cape_filings (
      user_id,
      vessel_name, imo_number, flag_state, call_sign, mmsi, vessel_type,
      gross_tonnage, net_tonnage, loa, beam, draft,
      port_of_origin, next_port, estimated_arrival,
      cargo_summary, crew_count,
      isps_security_level, last_10_ports,
      has_dangerous_goods, dangerous_goods_class, dangerous_goods_detail,
      sso_name, sso_contact, sso_email,
      compliance_score, filing_status,
      deadline_96h_at, document_data,
      created_at, updated_at
    ) VALUES (
      $1,
      $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15,
      $16, $17,
      $18, $19,
      $20, $21, $22,
      $23, $24, $25,
      $26, $27,
      $28, $29,
      NOW(), NOW()
    )
    RETURNING *
  `, [
    user_id,
    vessel_name, imo_number, flag_state, call_sign, mmsi, vessel_type,
    gross_tonnage, net_tonnage, loa, beam, draft,
    port_of_origin, next_port, estimated_arrival,
    cargo_summary, crew_count,
    isps_security_level,
    last_10_ports ? JSON.stringify(last_10_ports) : '[]',
    has_dangerous_goods,
    dangerous_goods_class, dangerous_goods_detail,
    sso_name, sso_contact, sso_email,
    compliance_score,
    filing_status || 'draft',
    deadline_96h_at || null,
    document_data ? JSON.stringify(document_data) : '{}',
  ]);

  return result.rows[0];
}

/**
 * Get a single filing by ID (soft-delete aware).
 */
async function getCapeFilingById(pool, id, userId) {
  const result = await pool.query(
    `SELECT * FROM cape_filings WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  );
  return result.rows[0] || null;
}

/**
 * List filings for a user (soft-delete aware, newest first).
 */
async function listCapeFilings(pool, userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT * FROM cape_filings
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

/**
 * Update an existing filing (allowed fields only).
 */
async function updateCapeFiling(pool, id, userId, data) {
  const sets = [];
  const vals = [];
  let idx = 1;

  const allowed = [
    'vessel_name', 'imo_number', 'flag_state', 'call_sign', 'mmsi', 'vessel_type',
    'gross_tonnage', 'net_tonnage', 'loa', 'beam', 'draft',
    'port_of_origin', 'next_port', 'estimated_arrival',
    'cargo_summary', 'crew_count',
    'isps_security_level', 'last_10_ports',
    'has_dangerous_goods', 'dangerous_goods_class', 'dangerous_goods_detail',
    'sso_name', 'sso_contact', 'sso_email',
    'compliance_score', 'filing_status',
    'deadline_96h_at', 'document_data',
  ];

  const jsonFields = new Set(['last_10_ports', 'document_data']);

  for (const key of allowed) {
    if (key in data) {
      sets.push(`${key} = $${idx++}`);
      vals.push(jsonFields.has(key) ? JSON.stringify(data[key]) : data[key]);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  vals.push(id, userId);

  const result = await pool.query(
    `UPDATE cape_filings SET ${sets.join(', ')}
     WHERE id = $${idx++} AND user_id = $${idx++} AND deleted_at IS NULL
     RETURNING *`,
    vals
  );
  return result.rows[0] || null;
}

/**
 * Soft-delete a filing.
 */
async function deleteCapeFiling(pool, id, userId) {
  const result = await pool.query(
    `UPDATE cape_filings SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [id, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createCapeFiling,
  getCapeFilingById,
  listCapeFilings,
  updateCapeFiling,
  deleteCapeFiling,
};
