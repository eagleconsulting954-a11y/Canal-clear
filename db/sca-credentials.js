/**
 * db/sca-credentials.js — SQL query functions for acp_credentials and acp_submissions tables.
 *
 * Owns: ACP credential management (store/test/delete), submission CRUD.
 * Does NOT own: route handling, actual ACP portal automation, email sending.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function deleteAcpCredentials(pool, userId) {
  return pool.query('DELETE FROM acp_credentials WHERE user_id = $1', [userId]);
}

async function getAcpCredentialId(pool, userId) {
  const result = await pool.query(
    'SELECT id FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
  return result;
}

async function markAcpCredentialsTested(pool, userId) {
  return pool.query(
    `UPDATE acp_credentials SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

async function listAcpSubmissions(pool, userId, limit, offset) {
  const result = await pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.filing_type,
            s.submitted_at, s.status, s.acp_reference, s.notes,
            s.created_at, s.updated_at,
            f.document_type AS filing_document_type,
            f.imo_number, f.flag_state
     FROM acp_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result;
}

async function countAcpSubmissions(pool, userId) {
  const result = await pool.query(
    'SELECT COUNT(*) FROM acp_submissions WHERE user_id = $1',
    [userId]
  );
  return result;
}

async function getAcpSubmission(pool, id, userId) {
  const result = await pool.query(
    `SELECT s.*, f.document_data, f.document_type AS filing_document_type
     FROM acp_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId]
  );
  return result;
}

async function getAcpSubmissionForResubmit(pool, id, userId) {
  const result = await pool.query(
    'SELECT id, vessel_name, filing_type, filing_id FROM acp_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result;
}

async function getAcpCredentialStatus(pool, userId) {
  const result = await pool.query(
    'SELECT id, status FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
  return result;
}

async function createAcpSubmission(pool, userId, filingId, vesselName, filingType, status, acpReference, notes) {
  const result = await pool.query(
    `INSERT INTO acp_submissions (user_id, filing_id, vessel_name, filing_type, status, acp_reference, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, filingId, vesselName, filingType, status, acpReference, notes || null]
  );
  return result;
}

module.exports = {
  deleteAcpCredentials,
  getAcpCredentialId,
  markAcpCredentialsTested,
  listAcpSubmissions,
  countAcpSubmissions,
  getAcpSubmission,
  getAcpSubmissionForResubmit,
  getAcpCredentialStatus,
  createAcpSubmission,
};
