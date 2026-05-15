/**
 * db/demo-requests.js — SQL query functions for the demo_requests table.
 *
 * Owns: storing and querying self-serve demo access requests (leads who request demo codes).
 * Does NOT own: demo code generation (db/demo-codes.js), email sending (services/email.js),
 *               rate limiting logic (routes/demo-request.js).
 */

/**
 * Insert a new demo request record.
 */
async function createDemoRequest(pool, { name, email, company, role, fleetSize, waterway, demoCode, ipAddress, domain }) {
  const result = await pool.query(`
    INSERT INTO demo_requests (name, email, company, role, fleet_size, waterway, demo_code, ip_address, domain)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [name, email, company, role, fleetSize, waterway, demoCode || null, ipAddress || null, domain]);
  return result.rows[0];
}

/**
 * Mark the demo request email as sent.
 */
async function markEmailSent(pool, id) {
  const result = await pool.query(`
    UPDATE demo_requests SET email_sent_at = NOW() WHERE id = $1 RETURNING *
  `, [id]);
  return result.rows[0] || null;
}

/**
 * Record a resend attempt (increment resend_count, update last_resend_at).
 */
async function recordResend(pool, id) {
  const result = await pool.query(`
    UPDATE demo_requests
    SET resend_count = resend_count + 1, last_resend_at = NOW(), email_sent_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id]);
  return result.rows[0] || null;
}

/**
 * Find the most recent demo request for a given email address.
 */
async function getLatestRequestByEmail(pool, email) {
  const result = await pool.query(`
    SELECT * FROM demo_requests
    WHERE email = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [email.toLowerCase().trim()]);
  return result.rows[0] || null;
}

/**
 * Count requests from a given IP address in the past 24 hours.
 */
async function countRecentByIp(pool, ipAddress) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count FROM demo_requests
    WHERE ip_address = $1 AND created_at > NOW() - INTERVAL '24 hours'
  `, [ipAddress]);
  return result.rows[0]?.count || 0;
}

/**
 * Count requests from a given email domain in the past 24 hours.
 */
async function countRecentByDomain(pool, domain) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS count FROM demo_requests
    WHERE domain = $1 AND created_at > NOW() - INTERVAL '24 hours'
  `, [domain.toLowerCase().trim()]);
  return result.rows[0]?.count || 0;
}

/**
 * List all demo requests for the admin panel, newest first.
 * Joins demo_codes to get redemption status.
 */
async function listDemoRequests(pool, { limit = 100, offset = 0 } = {}) {
  const result = await pool.query(`
    SELECT
      dr.*,
      dc.use_count AS code_use_count,
      dc.max_uses  AS code_max_uses,
      dc.is_active AS code_is_active,
      CASE WHEN dc.use_count > 0 THEN TRUE ELSE FALSE END AS code_redeemed
    FROM demo_requests dr
    LEFT JOIN demo_codes dc ON dc.code = dr.demo_code
    ORDER BY dr.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result.rows;
}

/**
 * Total count of demo requests (for pagination).
 */
async function countDemoRequests(pool) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM demo_requests`);
  return result.rows[0]?.count || 0;
}

module.exports = {
  createDemoRequest,
  markEmailSent,
  recordResend,
  getLatestRequestByEmail,
  countRecentByIp,
  countRecentByDomain,
  listDemoRequests,
  countDemoRequests,
};
