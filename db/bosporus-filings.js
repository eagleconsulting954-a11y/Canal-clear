/**
 * db/bosporus-filings.js — SP-1 filing data access for Bosporus / Turkish Straits
 *
 * Owns: all SQL queries against sp1_filings table.
 * Does NOT own: validation logic, route handling, pool construction, or auth.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 * Soft deletes: all read operations filter deleted_at IS NULL by default.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a new SP-1 filing. Returns the created row.
 *
 * @param {object} pool
 * @param {object} fields - Filing fields (snake_case, matches sp1_filings columns)
 * @returns {Promise<object>}
 */
async function createSP1Filing(pool, fields) {
  const {
    user_id, imo_number, vessel_name, flag_state, call_sign, mmsi, vessel_type,
    gross_tonnage, net_tonnage, loa, beam, draft,
    transit_direction, last_port, next_port, estimated_arrival,
    cargo_type, cargo_quantity, dangerous_goods_class,
    crew_count, passenger_count,
    agent_name, agent_contact, insurance_details, pi_club,
    compliance_score, filing_status,
    document_data,
    deadline_24h, deadline_48h,
  } = fields;

  const result = await pool.query(
    `INSERT INTO sp1_filings (
      user_id, imo_number, vessel_name, flag_state, call_sign, mmsi, vessel_type,
      gross_tonnage, net_tonnage, loa, beam, draft,
      transit_direction, last_port, next_port, estimated_arrival,
      cargo_type, cargo_quantity, dangerous_goods_class,
      crew_count, passenger_count,
      agent_name, agent_contact, insurance_details, pi_club,
      compliance_score, filing_status,
      document_data,
      deadline_24h, deadline_48h,
      created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,
      $8,$9,$10,$11,$12,
      $13,$14,$15,$16,
      $17,$18,$19,
      $20,$21,
      $22,$23,$24,$25,
      $26,$27,
      $28,
      $29,$30,
      NOW(), NOW()
    ) RETURNING *`,
    [
      user_id || null, imo_number || null, vessel_name || null,
      flag_state || null, call_sign || null, mmsi || null, vessel_type || null,
      gross_tonnage || null, net_tonnage || null, loa || null, beam || null, draft || null,
      transit_direction || null, last_port || null, next_port || null, estimated_arrival || null,
      cargo_type || null, cargo_quantity || null, dangerous_goods_class || null,
      crew_count || null, passenger_count || 0,
      agent_name || null, agent_contact || null, insurance_details || null, pi_club || null,
      compliance_score || null, filing_status || 'draft',
      JSON.stringify(document_data || {}),
      deadline_24h || null, deadline_48h || null,
    ]
  );
  return result.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single SP-1 filing by ID.
 * Returns null if not found or soft-deleted.
 *
 * @param {object} pool
 * @param {number} id
 * @param {number} [userId] - Optional: restrict to a specific user
 * @returns {Promise<object|null>}
 */
async function getSP1FilingById(pool, id, userId = null) {
  const params = [id];
  let sql = `SELECT * FROM sp1_filings WHERE id = $1 AND deleted_at IS NULL`;
  if (userId) {
    sql += ` AND user_id = $2`;
    params.push(userId);
  }
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

/**
 * List SP-1 filings with optional filters.
 *
 * @param {object} pool
 * @param {object} opts - { userId, status, imoNumber, dateFrom, dateTo, limit, offset }
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function listSP1Filings(pool, opts = {}) {
  const {
    userId,
    status,
    imoNumber,
    dateFrom,
    dateTo,
    limit  = 50,
    offset = 0,
  } = opts;

  const conditions = ['deleted_at IS NULL'];
  const params     = [];

  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }

  if (status) {
    params.push(status);
    conditions.push(`filing_status = $${params.length}`);
  }

  if (imoNumber) {
    params.push(imoNumber.replace(/^IMO\s*/i, '').trim());
    conditions.push(`imo_number = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`created_at >= $${params.length}`);
  }

  if (dateTo) {
    params.push(dateTo);
    conditions.push(`created_at <= $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count query
  const countResult = await pool.query(
    `SELECT COUNT(*)::integer AS total FROM sp1_filings ${where}`,
    params
  );

  // Data query
  params.push(limit);
  params.push(offset);
  const dataResult = await pool.query(
    `SELECT * FROM sp1_filings
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    rows:  dataResult.rows,
    total: countResult.rows[0]?.total || 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a SP-1 filing by ID.
 * Only updates fields that are present in `fields` (partial update).
 * Returns the updated row or null if not found.
 *
 * @param {object} pool
 * @param {number} id
 * @param {object} fields
 * @param {number} [userId] - Optional: restrict to a specific user
 * @returns {Promise<object|null>}
 */
async function updateSP1Filing(pool, id, fields, userId = null) {
  // Build dynamic SET clause from provided fields only
  const UPDATABLE_COLUMNS = [
    'imo_number', 'vessel_name', 'flag_state', 'call_sign', 'mmsi', 'vessel_type',
    'gross_tonnage', 'net_tonnage', 'loa', 'beam', 'draft',
    'transit_direction', 'last_port', 'next_port', 'estimated_arrival',
    'cargo_type', 'cargo_quantity', 'dangerous_goods_class',
    'crew_count', 'passenger_count',
    'agent_name', 'agent_contact', 'insurance_details', 'pi_club',
    'compliance_score', 'filing_status',
    'document_data',
    'deadline_24h', 'deadline_48h',
    'submitted_at',
  ];

  const setClauses = [];
  const params     = [];

  for (const col of UPDATABLE_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(fields, col)) {
      let val = fields[col];
      // Serialize JSONB
      if (col === 'document_data' && val !== null && typeof val === 'object') {
        val = JSON.stringify(val);
      }
      params.push(val);
      setClauses.push(`${col} = $${params.length}`);
    }
  }

  if (setClauses.length === 0) return null;

  // Always bump updated_at
  setClauses.push(`updated_at = NOW()`);

  params.push(id);
  let sql = `UPDATE sp1_filings SET ${setClauses.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL`;
  if (userId) {
    params.push(userId);
    sql += ` AND user_id = $${params.length}`;
  }
  sql += ' RETURNING *';

  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a SP-1 filing by setting deleted_at = NOW().
 * Returns true if a row was affected.
 *
 * @param {object} pool
 * @param {number} id
 * @param {number} [userId]
 * @returns {Promise<boolean>}
 */
async function deleteSP1Filing(pool, id, userId = null) {
  const params = [id];
  let sql = `UPDATE sp1_filings SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`;
  if (userId) {
    params.push(userId);
    sql += ` AND user_id = $${params.length}`;
  }
  const result = await pool.query(sql, params);
  return result.rowCount > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get recent SP-1 filings for the admin dashboard (last 20, all users).
 * Used to feed the fleet-level filing list.
 *
 * @param {object} pool
 * @returns {Promise<object[]>}
 */
async function getRecentSP1FilingsForDashboard(pool) {
  const result = await pool.query(
    `SELECT id, user_id, imo_number, vessel_name, flag_state, vessel_type,
            loa, draft, transit_direction, estimated_arrival,
            filing_status, compliance_score, created_at, submitted_at
     FROM sp1_filings
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 20`
  );
  return result.rows;
}

/**
 * Get filings approaching their 24h deadline within the next N hours.
 * Used by the alert service.
 *
 * @param {object} pool
 * @param {number} [withinHours=12]
 * @returns {Promise<object[]>}
 */
async function getDeadlineApproachingFilings(pool, withinHours = 12) {
  const result = await pool.query(
    `SELECT id, user_id, imo_number, vessel_name, filing_status,
            estimated_arrival, deadline_24h, compliance_score
     FROM sp1_filings
     WHERE deleted_at IS NULL
       AND filing_status IN ('draft', 'validated')
       AND deadline_24h IS NOT NULL
       AND deadline_24h > NOW()
       AND deadline_24h <= NOW() + INTERVAL '1 hour' * $1
     ORDER BY deadline_24h ASC`,
    [withinHours]
  );
  return result.rows;
}

module.exports = {
  createSP1Filing,
  getSP1FilingById,
  listSP1Filings,
  updateSP1Filing,
  deleteSP1Filing,
  getRecentSP1FilingsForDashboard,
  getDeadlineApproachingFilings,
};
