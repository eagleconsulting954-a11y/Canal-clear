/**
 * db/direct-filing-waitlist.js — Direct Authority Filing waitlist persistence.
 * Owns: direct_filing_waitlist table reads and writes.
 * Does NOT own: Pool construction (server.js), route handling (routes/direct-filing.js).
 */

/**
 * Add a signup to the direct filing waitlist.
 * Duplicate emails are allowed — a single operator may sign up multiple times.
 */
async function addWaitlistEntry(pool, { email, companyName, fleetSize, authorities, comment }) {
  const result = await pool.query(
    `INSERT INTO direct_filing_waitlist (email, company_name, fleet_size, authorities, comment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [email.toLowerCase().trim(), companyName || null, fleetSize || null, authorities || [], comment || null]
  );
  return result.rows[0];
}

/**
 * Count signups per authority for demand analysis.
 */
async function getAuthorityDemandStats(pool) {
  const result = await pool.query(`
    SELECT
      unnest(authorities) AS authority,
      COUNT(*) AS count
    FROM direct_filing_waitlist
    GROUP BY authority
    ORDER BY count DESC
  `);
  return result.rows;
}

/**
 * Total waitlist count.
 */
async function getWaitlistCount(pool) {
  const result = await pool.query(`SELECT COUNT(*) AS count FROM direct_filing_waitlist`);
  return parseInt(result.rows[0].count, 10);
}

module.exports = { addWaitlistEntry, getAuthorityDemandStats, getWaitlistCount };
