/**
 * db/acp.js — SQL query functions for acp_credentials and acp_submissions tables.
 *
 * Owns: ACP credential CRUD, ACP submission listing/creation/resubmission.
 * Does NOT own: ACP portal automation, encryption/decryption logic, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

// ── ACP Credentials ─────────────────────────────────────────────────────────

async function upsertAcpCredentials(pool, userId, encryptedUsername, encryptedPassword) {
  const result = await pool.query(
    `INSERT INTO acp_credentials (user_id, encrypted_username, encrypted_password, encryption_iv, status, updated_at)
     VALUES ($1, $2, $3, 'v2', 'connected', NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       encrypted_username = EXCLUDED.encrypted_username,
       encrypted_password = EXCLUDED.encrypted_password,
       status = 'connected',
       updated_at = NOW()
     RETURNING id, status, created_at, updated_at`,
    [userId, encryptedUsername, encryptedPassword]
  );
  return result.rows[0] || null;
}

async function getAcpCredentialStatus(pool, userId) {
  const result = await pool.query(
    `SELECT id, status, last_tested_at, created_at, updated_at,
            LEFT(encrypted_username, 6) AS username_prefix
     FROM acp_credentials WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getAcpEncryptedUsername(pool, userId) {
  const result = await pool.query(
    'SELECT encrypted_username FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

async function deleteAcpCredentials(pool, userId) {
  return pool.query('DELETE FROM acp_credentials WHERE user_id = $1', [userId]);
}

async function getAcpCredentialId(pool, userId) {
  const result = await pool.query(
    'SELECT id FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

async function markAcpCredentialsTested(pool, userId) {
  return pool.query(
    `UPDATE acp_credentials SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

async function getAcpCredentialStatusForSubmit(pool, userId) {
  const result = await pool.query(
    'SELECT id, status FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

// ── ACP Submissions ─────────────────────────────────────────────────────────

async function listAcpSubmissions(pool, userId, { limit = 50, offset = 0 } = {}) {
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
  return result.rows;
}

async function countAcpSubmissions(pool, userId) {
  const result = await pool.query(
    'SELECT COUNT(*) FROM acp_submissions WHERE user_id = $1',
    [userId]
  );
  return parseInt(result.rows[0].count);
}

async function getAcpSubmissionById(pool, id, userId) {
  const result = await pool.query(
    `SELECT s.*, f.document_data, f.document_type AS filing_document_type
     FROM acp_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId]
  );
  return result.rows[0] || null;
}

async function getAcpSubmissionForResubmit(pool, id, userId) {
  const result = await pool.query(
    'SELECT id, vessel_name, filing_type, filing_id FROM acp_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0] || null;
}

async function createAcpSubmission(pool, { userId, filingId, vesselName, filingType, status, acpReference, notes }) {
  const result = await pool.query(
    `INSERT INTO acp_submissions (user_id, filing_id, vessel_name, filing_type, status, acp_reference, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, filingId || null, vesselName, filingType, status, acpReference, notes || null]
  );
  return result.rows[0] || null;
}

// ── ACP Submission Summaries (used by compliance dashboard) ─────────────────

async function getAcpSubmissionSummaryByVessel(pool, userId) {
  const result = await pool.query(`
    SELECT
      LOWER(vessel_name) AS vname,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected,
      COUNT(CASE WHEN status = 'submitted' THEN 1 END)::int AS submitted,
      COUNT(CASE WHEN status = 'approved'  THEN 1 END)::int AS approved,
      MAX(submitted_at) AS last_acp_at
    FROM acp_submissions
    WHERE user_id = $1
    GROUP BY LOWER(vessel_name)
  `, [userId]);
  return result.rows;
}

async function getAcpSubmissionsByVesselName(pool, userId, vesselName) {
  const result = await pool.query(`
    SELECT id, filing_type, status, submitted_at, created_at, updated_at
    FROM acp_submissions
    WHERE user_id = $1 AND LOWER(vessel_name) = LOWER($2)
    ORDER BY COALESCE(submitted_at, created_at) DESC
    LIMIT 25
  `, [userId, vesselName]);
  return result.rows;
}

module.exports = {
  upsertAcpCredentials,
  getAcpCredentialStatus,
  getAcpEncryptedUsername,
  deleteAcpCredentials,
  getAcpCredentialId,
  markAcpCredentialsTested,
  getAcpCredentialStatusForSubmit,
  listAcpSubmissions,
  countAcpSubmissions,
  getAcpSubmissionById,
  getAcpSubmissionForResubmit,
  createAcpSubmission,
  getAcpSubmissionSummaryByVessel,
  getAcpSubmissionsByVesselName,
};
