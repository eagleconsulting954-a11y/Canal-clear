/**
 * db/mpa-portal.js — SQL query functions for mpa_credentials and mpa_submissions tables.
 *
 * Owns: MPA digitalPORT@SG / OCEANS-X credential storage + submission history queries.
 * Does NOT own: encryption logic, route handling, API calls to MPA, email sending.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

/**
 * Upsert MPA OCEANS-X API credentials for a user (one row per user, AES-256-GCM encrypted).
 */
async function upsertMpaCredentials(pool, userId, encryptedApiKey) {
  return pool.query(
    `INSERT INTO mpa_credentials (user_id, encrypted_api_key, encryption_iv, status, updated_at)
       VALUES ($1, $2, 'v2', 'connected', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_api_key = EXCLUDED.encrypted_api_key,
         status = 'connected',
         updated_at = NOW()
       RETURNING id, status, created_at, updated_at`,
    [userId, encryptedApiKey]
  );
}

/**
 * Get MPA credential status for a user (no plain credentials returned).
 */
async function getMpaCredentialStatus(pool, userId) {
  return pool.query(
    `SELECT id, status, last_tested_at, created_at, updated_at
       FROM mpa_credentials WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get encrypted MPA API key — used internally for enrichment calls.
 */
async function getMpaEncryptedKey(pool, userId) {
  return pool.query(
    'SELECT encrypted_api_key FROM mpa_credentials WHERE user_id = $1',
    [userId]
  );
}

/**
 * Delete MPA credentials for a user (disconnect).
 */
async function deleteMpaCredentials(pool, userId) {
  return pool.query('DELETE FROM mpa_credentials WHERE user_id = $1', [userId]);
}

/**
 * Mark MPA credentials as tested (updates last_tested_at).
 */
async function markMpaCredentialsTested(pool, userId) {
  return pool.query(
    `UPDATE mpa_credentials SET status = 'connected', last_tested_at = NOW(), updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get MPA credential ID only — used to verify credentials exist before submission.
 */
async function getMpaCredentialId(pool, userId) {
  return pool.query('SELECT id FROM mpa_credentials WHERE user_id = $1', [userId]);
}

// ── Submission history ────────────────────────────────────────────────────────

/**
 * Create a new MPA submission record.
 */
async function createMpaSubmission(pool, userId, filingId, vesselName, imoNumber, filingType, transitDirection, status, mpaReference, oceansXData, notes) {
  return pool.query(
    `INSERT INTO mpa_submissions
       (user_id, filing_id, vessel_name, imo_number, filing_type, transit_direction, status, mpa_reference, oceans_x_vessel_data, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [userId, filingId || null, vesselName, imoNumber || null, filingType, transitDirection || null, status, mpaReference, oceansXData ? JSON.stringify(oceansXData) : null, notes || null]
  );
}

/**
 * List submission history for a user.
 */
async function listMpaSubmissions(pool, userId, limit, offset) {
  return pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.imo_number, s.filing_type,
            s.transit_direction, s.submitted_at, s.status, s.mpa_reference,
            s.oceans_x_vessel_data, s.notes, s.created_at, s.updated_at
     FROM mpa_submissions s
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

/**
 * Count total MPA submissions for a user.
 */
async function countMpaSubmissions(pool, userId) {
  return pool.query('SELECT COUNT(*) FROM mpa_submissions WHERE user_id = $1', [userId]);
}

/**
 * Get a specific MPA submission by ID, scoped to user.
 */
async function getMpaSubmission(pool, id, userId) {
  return pool.query(
    `SELECT * FROM mpa_submissions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}

/**
 * Get minimal submission info for resubmit.
 */
async function getMpaSubmissionForResubmit(pool, id, userId) {
  return pool.query(
    'SELECT id, vessel_name, imo_number, filing_type, filing_id, transit_direction FROM mpa_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

/**
 * Fetch a malacca_filings row for MPA submission enrichment.
 */
async function getMalaccaFilingForMpaSubmit(pool, filingId, userId) {
  return pool.query('SELECT * FROM malacca_filings WHERE id = $1 AND user_id = $2', [filingId, userId]);
}

/**
 * Append an MPA submission event to the filing audit log.
 */
async function writeMpaAuditEntry(pool, filingId, actor, action, comment) {
  return pool.query(
    `INSERT INTO filing_audit_log (filing_id, filing_type, action, actor, comment)
     VALUES ($1, 'malacca', $2, $3, $4)`,
    [filingId, action, actor, comment]
  );
}

module.exports = {
  upsertMpaCredentials,
  getMpaCredentialStatus,
  getMpaEncryptedKey,
  deleteMpaCredentials,
  markMpaCredentialsTested,
  getMpaCredentialId,
  createMpaSubmission,
  listMpaSubmissions,
  countMpaSubmissions,
  getMpaSubmission,
  getMpaSubmissionForResubmit,
  getMalaccaFilingForMpaSubmit,
  writeMpaAuditEntry,
};
