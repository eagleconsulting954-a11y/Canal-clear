/**
 * db/samsa-portal.js — SQL queries for samsa_submissions table.
 *
 * Owns: SAMSA ISPS pre-arrival submission history storage (Cape Town Radio email channel).
 * Does NOT own: email generation, email sending, route handling, auth, or encryption.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

/**
 * Create a new SAMSA submission record.
 */
async function createSamsaSubmission(pool, {
  userId, filingId, vesselName, imoNumber, portOfArrival,
  recipientEmail, emailSubject, messageHash,
  status, samsaReference, errorMessage,
}) {
  return pool.query(
    `INSERT INTO samsa_submissions
       (user_id, filing_id, vessel_name, imo_number, port_of_arrival,
        recipient_email, email_subject, message_hash,
        status, samsa_reference, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      userId, filingId || null, vesselName, imoNumber || null, portOfArrival || null,
      recipientEmail, emailSubject, messageHash,
      status, samsaReference, errorMessage || null,
    ]
  );
}

/**
 * List SAMSA submission history for a user, most recent first.
 */
async function listSamsaSubmissions(pool, userId, limit, offset) {
  return pool.query(
    `SELECT s.id, s.filing_id, s.vessel_name, s.imo_number, s.port_of_arrival,
            s.recipient_email, s.email_subject, s.message_hash,
            s.status, s.samsa_reference, s.error_message,
            s.submitted_at, s.created_at, s.updated_at
     FROM samsa_submissions s
     WHERE s.user_id = $1
     ORDER BY s.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
}

/**
 * Count total SAMSA submissions for a user.
 */
async function countSamsaSubmissions(pool, userId) {
  return pool.query('SELECT COUNT(*) FROM samsa_submissions WHERE user_id = $1', [userId]);
}

/**
 * Get a specific SAMSA submission by ID, scoped to user.
 */
async function getSamsaSubmission(pool, id, userId) {
  return pool.query(
    'SELECT * FROM samsa_submissions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

/**
 * Get minimal submission data for resubmit.
 */
async function getSamsaSubmissionForResubmit(pool, id, userId) {
  return pool.query(
    `SELECT id, vessel_name, imo_number, filing_id, port_of_arrival, samsa_reference
     FROM samsa_submissions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
}

/**
 * Update submission status (e.g. acknowledged).
 */
async function updateSamsaSubmissionStatus(pool, id, userId, status) {
  return pool.query(
    `UPDATE samsa_submissions SET status = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, status]
  );
}

/**
 * Write a SAMSA submission event to the filing audit log.
 * Best-effort: caller catches errors.
 */
async function writeSamsaAuditEntry(pool, filingId, actor, action, comment) {
  return pool.query(
    `INSERT INTO filing_audit_log (filing_id, filing_type, action, actor, comment)
     VALUES ($1, 'cape', $2, $3, $4)`,
    [filingId, action, actor, comment]
  );
}

module.exports = {
  createSamsaSubmission,
  listSamsaSubmissions,
  countSamsaSubmissions,
  getSamsaSubmission,
  getSamsaSubmissionForResubmit,
  updateSamsaSubmissionStatus,
  writeSamsaAuditEntry,
};
