/**
 * db/filings.js — SQL query functions for the generic filings table (Panama/Suez).
 *
 * Owns: CRUD for the legacy filings table used by Panama Canal and Suez Canal filings.
 * Does NOT own: SP-1 filings (db/bosporus-filings.js), Malacca (db/malacca-filings.js),
 *               Cape (db/cape-filings.js), or validation logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function createDraftFiling(pool, { user_id, canal, vessel_name, imo_number, flag_state, vessel_type, loa, beam, draft, gross_tonnage }) {
  const result = await pool.query(`
    INSERT INTO filings
      (user_id, canal, vessel_name, imo_number, flag_state, vessel_type,
       loa, beam, draft, gross_tonnage,
       status, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',NOW())
    RETURNING id
  `, [user_id, canal, vessel_name, imo_number, flag_state, vessel_type, loa, beam, draft, gross_tonnage]);
  return result.rows[0] || null;
}

/**
 * Count distinct vessels (by IMO) for a user.
 * Used by subscription/status and vessel limit enforcement.
 */
async function countDistinctVessels(pool, userId) {
  const result = await pool.query(
    `SELECT COUNT(DISTINCT imo_number) AS cnt
     FROM filings
     WHERE user_id = $1 AND imo_number IS NOT NULL AND imo_number <> ''`,
    [userId]
  );
  return result;
}

/**
 * Check if user already has a filing for a given IMO number.
 */
async function hasVesselByImo(pool, userId, imoNumber) {
  const result = await pool.query(
    'SELECT 1 FROM filings WHERE user_id = $1 AND imo_number = $2 LIMIT 1',
    [userId, imoNumber]
  );
  return result.rows.length > 0;
}

/**
 * Create a full filing with all fields.
 * Used by POST /api/filings.
 */
async function createFiling(pool, { userId, documentType, canal, status, vesselName, imoNumber, flagState, vesselType, classificationSociety, loa, beam, draft, grossTonnage, documentData, referenceNumber, notes }) {
  const result = await pool.query(`
    INSERT INTO filings (
      user_id, document_type, canal, status,
      vessel_name, imo_number, flag_state, vessel_type, classification_society,
      loa, beam, draft, gross_tonnage,
      document_data, reference_number, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *
  `, [
    userId, documentType, canal, status,
    vesselName || null, imoNumber || null, flagState || null, vesselType || null, classificationSociety || null,
    loa || null, beam || null, draft || null, grossTonnage || null,
    JSON.stringify(documentData || {}), referenceNumber || null, notes || null
  ]);
  return result;
}

/**
 * List filings for a user, newest first.
 */
async function listUserFilings(pool, userId, limit, offset) {
  const result = await pool.query(
    `SELECT id, document_type, status, vessel_name, imo_number, flag_state,
            vessel_type, reference_number, created_at, updated_at
     FROM filings
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result;
}

/**
 * Count total filings for a user.
 */
async function countUserFilings(pool, userId) {
  const result = await pool.query(
    'SELECT COUNT(*) FROM filings WHERE user_id = $1',
    [userId]
  );
  return result;
}

/**
 * Get a specific filing belonging to a user.
 */
async function getUserFilingById(pool, filingId, userId) {
  const result = await pool.query(
    'SELECT * FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return result;
}

/**
 * Check if a filing exists and belongs to a user (id only).
 */
async function checkFilingOwnership(pool, filingId, userId) {
  const result = await pool.query(
    'SELECT id FROM filings WHERE id=$1 AND user_id=$2',
    [filingId, userId]
  );
  return result;
}

/**
 * Update a filing with dynamic fields.
 * @param {object} pool
 * @param {string} updatesSql - SET clause fragment
 * @param {Array} params - parameterized values
 */
async function updateFiling(pool, updatesSql, params) {
  const result = await pool.query(updatesSql, params);
  return result;
}

module.exports = {
  createDraftFiling,
  countDistinctVessels,
  hasVesselByImo,
  createFiling,
  listUserFilings,
  countUserFilings,
  getUserFilingById,
  checkFilingOwnership,
  updateFiling,
};
