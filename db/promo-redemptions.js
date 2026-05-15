/**
 * db/promo-redemptions.js — Promo code redemption tracking
 *
 * Owns: all queries against promo_redemptions table.
 * Does NOT own: promo code definitions, route handling, pool construction.
 *
 * Tracks how many times each promo code has been used and records
 * the Stripe session ID as a deduplication key.
 */

/**
 * Count total redemptions for a promo code.
 * @param {object} pool
 * @param {string} code — normalized uppercase promo code
 * @returns {Promise<number>}
 */
async function getRedemptionCount(pool, code) {
  const result = await pool.query(
    'SELECT COUNT(*) AS cnt FROM promo_redemptions WHERE code = $1',
    [code]
  );
  return parseInt(result.rows[0]?.cnt ?? 0, 10);
}

/**
 * Record a promo code redemption tied to a Stripe checkout session.
 * Idempotent: same stripe_session_id can only be inserted once (UNIQUE constraint).
 * Returns true if inserted, false if duplicate.
 *
 * @param {object} pool
 * @param {string} code
 * @param {string} stripeSessionId — Stripe checkout session ID or link ID for dedup
 * @param {string} canal
 * @param {number} vessels
 * @returns {Promise<boolean>}
 */
async function recordRedemption(pool, code, stripeSessionId, canal, vessels) {
  try {
    await pool.query(
      `INSERT INTO promo_redemptions (code, stripe_session_id, canal, vessels)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [code, stripeSessionId, canal, vessels]
    );
    return true;
  } catch (err) {
    // Non-unique errors are unexpected — rethrow
    if (err.code === '23505') return false;
    throw err;
  }
}

module.exports = { getRedemptionCount, recordRedemption };
