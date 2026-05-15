/**
 * db/sca-portal.js — SQL query functions for sca_credentials and sca_submissions tables.
 *
 * Owns: SCA (Suez Canal Authority) portal credential storage + submission history.
 * Does NOT own: encryption logic, route handling, actual portal automation, email sending.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

/**
 * Upsert SCA portal credentials for a user (one row per user, AES-256-GCM encrypted).
 */
async function upsertScaCredentials(pool, userId, encryptedUsername, encryptedPassword) {
  return pool.query(
    `INSERT INTO sca_credentials (user_id, encrypted_username, encrypted_password, encryption_iv, status, updated_at)
       VALUES ($1, $2, $3, 'v2', 'connected', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_username = EXCLUDED.encrypted_username,
         encrypted_password = EXCLUDED.encrypted_password,
         status = 'connected',
         updated_at = NOW()
       RETURNING id, status, created_at, updated_at`,
    [userId, encryptedUsername, encryptedPassword]
  );
}

/**
 * Get SCA credential status for a user (no plain credentials returned).
 */
async function getScaCredentialStatus(pool, userId) {
  return pool.query(
    `SELECT id, status, last_tested_at, created_at, updated_at
       FROM sca_credentials WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get encrypted SCA username for display hint decryption (first 3 chars only).
 */
async function getScaEncryptedUsername(pool, userId) {
  return pool.query(
    'SELECT encrypted_username FROM sca_credentials WHERE user_id = $1',
    [userId]
  );
}

/**
 * Delete SCA credentials for a user (disconnect).
 */
async function deleteScaCredentials(pool, userId) {
  return pool.query('DELETE FROM sca_credentials WHERE user_id = $1', [userId]);
}

/**
 * Mark SCA credentials as tested (updates last_tested_at).
 */
async function markScaCredentialsTested(pool, userId) {
  return pool.query(
    `UPDATE sca_credentials SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get SCA credential ID only — used to check that credentials exist before submission.
 */
async function getScaCredentialId(pool, userId) {
  return pool.query('SELECT id FROM sca_credentials WHERE user_id = $1', [userId]);
}

// ── Submission history ────────────────────────────────────────────────────────

/**
 * Create a new SCA submission record.
 */
async function createScaSubmission(pool, userId, filingId, vesselName, filingType, transitDirection, status, scaReference, notes) {
  return pool.query(
    `INSERT INTO sca_submissions
       (user_id, filing_id, vessel_name, filing_type, transit_direction, status, sca_reference, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, filingId, vesselName, filingType, transitDirection || null, status, scaReference, notes || null]
  );
}

/**
 * List submission history for a user.
 */
async function listScaSubmissions(pool, userId, limit, offset) {
  return pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.filing_type,
            s.transit_direction, s.convoy_number,
            s.submitted_at, s.status, s.sca_reference, s.notes,
            s.created_at, s.updated_at,
            f.document_type AS filing_document_type,
            f.imo_number, f.flag_state
     FROM sca_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

/**
 * Count total submissions for a user.
 */
async function countScaSubmissions(pool, userId) {
  return pool.query('SELECT COUNT(*) FROM sca_submissions WHERE user_id = $1', [userId]);
}

/**
 * Get a specific submission by ID, scoped to user.
 */
async function getScaSubmission(pool, id, userId) {
  return pool.query(
    `SELECT s.*, f.document_data, f.document_type AS filing_document_type
     FROM sca_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId]
  );
}

/**
 * Get minimal submission info for resubmit (only what's needed).
 */
async function getScaSubmissionForResubmit(pool, id, userId) {
  return pool.query(
    'SELECT id, vessel_name, filing_type, filing_id, transit_direction FROM sca_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

/**
 * Update submission status after async confirmation.
 */
async function updateScaSubmissionStatus(pool, id, userId, status, scaReference) {
  return pool.query(
    `UPDATE sca_submissions SET status = $3, sca_reference = COALESCE($4, sca_reference), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, status, scaReference || null]
  );
}

/**
 * Fetch a filing by ID scoped to user — used by SCA submit to enrich package data.
 * Best-effort: caller handles empty result gracefully.
 */
async function getFilingForScaSubmit(pool, filingId, userId) {
  return pool.query('SELECT * FROM filings WHERE id = $1 AND user_id = $2', [filingId, userId]);
}

/**
 * Append an SCA submission event to the filing audit log.
 * Best-effort: caller should catch errors.
 */
async function writeScaAuditEntry(pool, filingId, actor, action, comment) {
  return pool.query(
    `INSERT INTO filing_audit_log (filing_id, filing_type, action, actor, comment)
     VALUES ($1, 'suez', $2, $3, $4)`,
    [filingId, action, actor, comment]
  );
}

module.exports = {
  upsertScaCredentials,
  getScaCredentialStatus,
  getScaEncryptedUsername,
  deleteScaCredentials,
  markScaCredentialsTested,
  getScaCredentialId,
  createScaSubmission,
  listScaSubmissions,
  countScaSubmissions,
  getScaSubmission,
  getScaSubmissionForResubmit,
  updateScaSubmissionStatus,
  getFilingForScaSubmit,
  writeScaAuditEntry,
};
