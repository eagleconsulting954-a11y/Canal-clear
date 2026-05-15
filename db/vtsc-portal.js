/**
 * db/vtsc-portal.js — SQL queries for vtsc_submissions table.
 *
 * Owns: VTSC (Turkish Straits VTS Center) SP-1 submission history storage.
 * Does NOT own: email generation, email sending, route handling, auth, encryption.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

/**
 * Create a new VTSC submission record.
 */
async function createVtscSubmission(pool, {
  userId, filingId, vesselName, imoNumber, transitDirection,
  vtsCenter, recipientEmail, emailSubject, messageHash,
  status, vtscReference, errorMessage,
}) {
  return pool.query(
    `INSERT INTO vtsc_submissions
       (user_id, filing_id, vessel_name, imo_number, transit_direction,
        vts_center, recipient_email, email_subject, message_hash,
        status, vtsc_reference, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      userId, filingId || null, vesselName, imoNumber || null, transitDirection || null,
      vtsCenter, recipientEmail, emailSubject, messageHash,
      status, vtscReference, errorMessage || null,
    ]
  );
}

/**
 * List VTSC submission history for a user, most recent first.
 */
async function listVtscSubmissions(pool, userId, limit, offset) {
  return pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.imo_number, s.transit_direction,
            s.vts_center, s.recipient_email, s.email_subject, s.message_hash,
            s.status, s.vtsc_reference, s.error_message,
            s.submitted_at, s.created_at, s.updated_at
     FROM vtsc_submissions s
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

/**
 * Count total VTSC submissions for a user.
 */
async function countVtscSubmissions(pool, userId) {
  return pool.query('SELECT COUNT(*) FROM vtsc_submissions WHERE user_id = $1', [userId]);
}

/**
 * Get a specific VTSC submission by ID, scoped to user.
 */
async function getVtscSubmission(pool, id, userId) {
  return pool.query(
    'SELECT * FROM vtsc_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

/**
 * Get minimal submission data for resubmit.
 */
async function getVtscSubmissionForResubmit(pool, id, userId) {
  return pool.query(
    `SELECT id, vessel_name, imo_number, filing_id, transit_direction, vts_center
     FROM vtsc_submissions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}

/**
 * Update submission status (e.g. acknowledged).
 */
async function updateVtscSubmissionStatus(pool, id, userId, status) {
  return pool.query(
    `UPDATE vtsc_submissions SET status = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, status]
  );
}

/**
 * Write a VTSC submission event to the filing audit log.
 * Best-effort: caller catches errors.
 */
async function writeVtscAuditEntry(pool, filingId, actor, action, comment) {
  return pool.query(
    `INSERT INTO filing_audit_log (filing_id, filing_type, action, actor, comment)
     VALUES ($1, 'bosporus', $2, $3, $4)`,
    [filingId, action, actor, comment]
  );
}

module.exports = {
  createVtscSubmission,
  listVtscSubmissions,
  countVtscSubmissions,
  getVtscSubmission,
  getVtscSubmissionForResubmit,
  updateVtscSubmissionStatus,
  writeVtscAuditEntry,
};
