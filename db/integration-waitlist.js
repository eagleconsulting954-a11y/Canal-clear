/**
 * db/integration-waitlist.js — Integration partner waitlist data access
 *
 * Owns: all queries against integration_waitlist table.
 * Does NOT own: route handling, authentication, pool construction,
 *               or email notification logic.
 *
 * All callers pass pool (from req.app.locals.pool).
 * Inserts are idempotent — duplicate (email, integration_slug) rows are
 * silently ignored via ON CONFLICT DO NOTHING.
 */

/**
 * Record a waitlist signup.
 * @param {object} pool
 * @param {object} params
 * @param {string} params.email
 * @param {string|null} params.company_name
 * @param {string} params.integration_slug  — e.g. 'veson-imos', 'q88', 'slack'
 * @returns {Promise<{inserted: boolean}>}
 */
async function addToWaitlist(pool, { email, company_name, integration_slug }) {
  const result = await pool.query(
    `INSERT INTO integration_waitlist (email, company_name, integration_slug)
     VALUES ($1, $2, $3)
     ON CONFLICT (email, integration_slug) DO NOTHING`,
    [email.trim().toLowerCase(), company_name || null, integration_slug]
  );
  return { inserted: result.rowCount > 0 };
}

/**
 * Count signups per integration slug, ordered by popularity.
 * @param {object} pool
 * @returns {Promise<Array<{slug: string, count: number}>>}
 */
async function getWaitlistCounts(pool) {
  const result = await pool.query(
    `SELECT integration_slug AS slug, COUNT(*)::int AS count
     FROM integration_waitlist
     GROUP BY integration_slug
     ORDER BY count DESC`
  );
  return result.rows;
}

module.exports = { addToWaitlist, getWaitlistCounts };
