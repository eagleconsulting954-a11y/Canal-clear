/**
 * db/vumpa-portal.js — SQL query functions for vumpa (ACP) credentials and submissions.
 *
 * Owns: ACP VUMPA portal credential storage (acp_credentials table) and
 *       Panama filing submission history (acp_submissions table).
 * Does NOT own: encryption logic, route handling, portal automation, email sending.
 *
 * Tables used: acp_credentials, acp_submissions (created in migration 1743600000000_create_acp_tables.js)
 * All callers pass `pool` (from req.app.locals.pool).
 */

/**
 * Upsert ACP VUMPA portal credentials for a user (one row per user, AES-256-GCM encrypted).
 */
async function upsertVumpaCredentials(pool, userId, encryptedUsername, encryptedPassword) {
  return pool.query(
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
}

/**
 * Get VUMPA credential status for a user (no plain credentials returned).
 */
async function getVumpaCredentialStatus(pool, userId) {
  return pool.query(
    `SELECT id, status, last_tested_at, created_at, updated_at
       FROM acp_credentials WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get encrypted VUMPA username for display hint (first 3 chars only).
 */
async function getVumpaEncryptedUsername(pool, userId) {
  return pool.query(
    'SELECT encrypted_username FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
}

/**
 * Delete VUMPA credentials for a user (disconnect).
 */
async function deleteVumpaCredentials(pool, userId) {
  return pool.query('DELETE FROM acp_credentials WHERE user_id = $1', [userId]);
}

/**
 * Mark VUMPA credentials as tested (updates last_tested_at).
 */
async function markVumpaCredentialsTested(pool, userId) {
  return pool.query(
    `UPDATE acp_credentials SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get VUMPA credential ID only — used to verify credentials exist before submission.
 */
async function getVumpaCredentialId(pool, userId) {
  return pool.query('SELECT id, status FROM acp_credentials WHERE user_id = $1', [userId]);
}

// ── Submission history ─────────────────────────────────────────────────────────

/**
 * Create a new VUMPA submission record.
 */
async function createVumpaSubmission(pool, userId, filingId, vesselName, filingType, status, acpReference, notes) {
  return pool.query(
    `INSERT INTO acp_submissions (user_id, filing_id, vessel_name, filing_type, status, acp_reference, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [userId, filingId || null, vesselName, filingType, status, acpReference, notes || null]
  );
}

/**
 * List submission history for a user.
 */
async function listVumpaSubmissions(pool, userId, limit, offset) {
  return pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.filing_type,
            s.submitted_at, s.status, s.acp_reference, s.notes,
            s.created_at, s.updated_at,
            f.imo_number, f.flag_state
     FROM acp_submissions s
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
async function countVumpaSubmissions(pool, userId) {
  return pool.query('SELECT COUNT(*) FROM acp_submissions WHERE user_id = $1', [userId]);
}

/**
 * Get a specific submission by ID, scoped to user.
 */
async function getVumpaSubmission(pool, id, userId) {
  return pool.query(
    `SELECT s.*, f.document_data, f.document_type AS filing_document_type
     FROM acp_submissions s
     LEFT JOIN filings f ON f.id = s.filing_id
     WHERE s.id = $1 AND s.user_id = $2`,
    [id, userId]
  );
}

/**
 * Get minimal submission info for resubmit.
 */
async function getVumpaSubmissionForResubmit(pool, id, userId) {
  return pool.query(
    'SELECT id, vessel_name, filing_type, filing_id FROM acp_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

/**
 * Update submission status after async confirmation.
 */
async function updateVumpaSubmissionStatus(pool, id, userId, status, acpReference) {
  return pool.query(
    `UPDATE acp_submissions SET status = $3, acp_reference = COALESCE($4, acp_reference), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, status, acpReference || null]
  );
}

/**
 * Fetch a Panama filing by ID scoped to user — used by VUMPA submit for package enrichment.
 */
async function getFilingForVumpaSubmit(pool, filingId, userId) {
  return pool.query(
    'SELECT * FROM filings WHERE id = $1 AND user_id = $2 AND canal = \'panama\'',
    [filingId, userId]
  );
}

/**
 * Append a VUMPA submission event to the filing audit log.
 * Best-effort: caller should catch errors.
 */
async function writeVumpaAuditEntry(pool, filingId, actor, action, comment) {
  return pool.query(
    `INSERT INTO filing_audit_log (filing_id, filing_type, action, actor, comment)
     VALUES ($1, 'panama', $2, $3, $4)`,
    [filingId, action, actor, comment]
  );
}

module.exports = {
  upsertVumpaCredentials,
  getVumpaCredentialStatus,
  getVumpaEncryptedUsername,
  deleteVumpaCredentials,
  markVumpaCredentialsTested,
  getVumpaCredentialId,
  createVumpaSubmission,
  listVumpaSubmissions,
  countVumpaSubmissions,
  getVumpaSubmission,
  getVumpaSubmissionForResubmit,
  updateVumpaSubmissionStatus,
  getFilingForVumpaSubmit,
  writeVumpaAuditEntry,
};
