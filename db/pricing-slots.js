/**
 * db/pricing-slots.js — Founding slot counter data access
 *
 * Owns: all queries against pricing_slots and pricing_slot_purchases tables.
 * Does NOT own: route handling, authentication, pool construction.
 *
 * All callers pass pool (from req.app.locals.pool).
 * Thread-safety: decrementSlot uses FOR UPDATE + idempotency key to prevent races.
 */

/**
 * Get the current slot counts.
 * @param {object} pool
 * @returns {Promise<{total: number, remaining: number}>}
 */
async function getSlots(pool) {
  const result = await pool.query(
    'SELECT total_slots, remaining_slots FROM pricing_slots ORDER BY id LIMIT 1'
  );
  if (result.rows.length === 0) {
    return { total: 20, remaining: 20 };
  }
  const row = result.rows[0];
  return { total: row.total_slots, remaining: row.remaining_slots };
}

/**
 * Atomically decrement remaining_slots by 1 for a given Stripe session ID.
 * Idempotent: the same session_id can only decrement once.
 * Counter never goes below 0.
 *
 * @param {object} pool
 * @param {string} stripeSessionId
 * @returns {Promise<{decremented: boolean, remaining: number}>}
 */
async function decrementSlot(pool, stripeSessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check for duplicate — if already processed, skip
    const existing = await client.query(
      'SELECT id FROM pricing_slot_purchases WHERE stripe_session_id = $1',
      [stripeSessionId]
    );
    if (existing.rows.length > 0) {
      const current = await client.query(
        'SELECT remaining_slots FROM pricing_slots ORDER BY id LIMIT 1 FOR UPDATE'
      );
      await client.query('COMMIT');
      return {
        decremented: false,
        remaining: current.rows[0] ? current.rows[0].remaining_slots : 0,
      };
    }

    // Lock the row to prevent concurrent races
    const slotRow = await client.query(
      'SELECT id, remaining_slots FROM pricing_slots ORDER BY id LIMIT 1 FOR UPDATE'
    );

    if (slotRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return { decremented: false, remaining: 0 };
    }

    const currentRemaining = slotRow.rows[0].remaining_slots;
    const slotId = slotRow.rows[0].id;
    const newRemaining = Math.max(0, currentRemaining - 1);

    // Update counter
    await client.query(
      'UPDATE pricing_slots SET remaining_slots = $1, updated_at = NOW() WHERE id = $2',
      [newRemaining, slotId]
    );

    // Record dedup key
    await client.query(
      'INSERT INTO pricing_slot_purchases (stripe_session_id) VALUES ($1)',
      [stripeSessionId]
    );

    await client.query('COMMIT');
    return { decremented: true, remaining: newRemaining };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get active Suez fee tiers ordered by min SCNT ascending.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getActiveFeeTiers(pool) {
  return pool.query(
    'SELECT * FROM suez_fee_tiers WHERE active = true ORDER BY min_scnt ASC'
  );
}

module.exports = { getSlots, decrementSlot, getActiveFeeTiers };
