/**
 * db/drip-emails.js — SQL query functions for the drip_emails table.
 *
 * Owns: all CRUD for drip email scheduling and status tracking.
 * Does NOT own: email content generation, sending logic (Postmark), or lead management.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function insertDripEmail(pool, { lead_id, email_number, email, scheduled_for }) {
  return pool.query(
    'INSERT INTO drip_emails (lead_id, email_number, email, scheduled_for) VALUES ($1, $2, $3, $4)',
    [lead_id, email_number, email, scheduled_for]
  );
}

async function unsubscribePendingEmails(pool, email) {
  return pool.query(
    `UPDATE drip_emails SET status = 'unsubscribed' WHERE LOWER(email) = LOWER($1) AND status = 'pending'`,
    [email]
  );
}

async function getDueDripEmails(pool, { limit = 50 } = {}) {
  const result = await pool.query(`
    SELECT de.id, de.lead_id, de.email_number, de.email, l.company_name, l.fleet_size, l.source
    FROM drip_emails de
    JOIN leads l ON l.id = de.lead_id
    WHERE de.scheduled_for <= NOW() AND de.status = 'pending'
    ORDER BY de.scheduled_for ASC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

async function markDripEmailSent(pool, id) {
  return pool.query(
    `UPDATE drip_emails SET status = 'sent', sent_at = NOW() WHERE id = $1`,
    [id]
  );
}

async function markDripEmailFailed(pool, id, errorMessage) {
  return pool.query(
    `UPDATE drip_emails SET status = 'failed', error_message = $1 WHERE id = $2`,
    [errorMessage, id]
  );
}

async function markDripEmailNotImplemented(pool, id) {
  return pool.query(
    `UPDATE drip_emails SET status = 'failed', error_message = 'Content not implemented yet', sent_at = NOW() WHERE id = $1`,
    [id]
  );
}

module.exports = {
  insertDripEmail,
  unsubscribePendingEmails,
  getDueDripEmails,
  markDripEmailSent,
  markDripEmailFailed,
  markDripEmailNotImplemented,
};
