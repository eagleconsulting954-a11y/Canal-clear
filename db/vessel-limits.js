/**
 * db/vessel-limits.js — SQL queries for agency vessel limit enforcement.
 *
 * Owns: vessel count queries for agency accounts (agent_client_vessels),
 *       grace period timestamp reads/writes, notification day tracking.
 * Does NOT own: limit calculation logic (in services/vessel-limit-service.js),
 *               route handling, email sending.
 */

/**
 * Count distinct vessels an agency user manages across all their clients.
 * Counts rows in agent_client_vessels joined through agent_clients.
 * This is the authoritative vessel count for agency tier enforcement.
 */
async function countAgencyVessels(pool, userId) {
  const result = await pool.query(
    `SELECT COUNT(acv.id) AS cnt
     FROM agent_client_vessels acv
     JOIN agent_clients ac ON ac.id = acv.client_id
     WHERE ac.user_id = $1 AND ac.is_active = TRUE`,
    [userId]
  );
  return parseInt(result.rows[0]?.cnt || '0', 10);
}

/**
 * Get the current vessel limit enforcement state for a user.
 * Returns: vessel_limit_exceeded_at, vessel_limit_notified_day, vessel_limit, plan_type, subscription_plan
 */
async function getUserLimitState(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, subscription_plan, plan_type, vessel_limit,
            vessel_limit_exceeded_at, vessel_limit_notified_day
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Record when a user first exceeded their vessel limit.
 * No-op if vessel_limit_exceeded_at is already set (preserves original timestamp).
 */
async function markVesselLimitExceeded(pool, userId) {
  await pool.query(
    `UPDATE users
     SET vessel_limit_exceeded_at = COALESCE(vessel_limit_exceeded_at, NOW())
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Clear the exceeded timestamp when a user upgrades or removes enough vessels.
 * Also resets the notification day counter.
 */
async function clearVesselLimitExceeded(pool, userId) {
  await pool.query(
    `UPDATE users
     SET vessel_limit_exceeded_at = NULL,
         vessel_limit_notified_day = NULL
     WHERE id = $1`,
    [userId]
  );
}

/**
 * Record which notification day we last sent (1, 5, or 7).
 * Prevents duplicate emails if the cron job runs multiple times.
 */
async function setNotifiedDay(pool, userId, day) {
  await pool.query(
    `UPDATE users SET vessel_limit_notified_day = $2 WHERE id = $1`,
    [userId, day]
  );
}

/**
 * Get all agency users who are currently over their vessel limit.
 * Used by the notification cron job to send day-1/day-5/day-7 emails.
 */
async function getOverLimitAgencies(pool) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.subscription_plan, u.vessel_limit,
            u.vessel_limit_exceeded_at, u.vessel_limit_notified_day
     FROM users u
     WHERE u.vessel_limit_exceeded_at IS NOT NULL
       AND u.subscription_status IN ('active', 'trialing')
       AND u.plan_type = 'agent_pro'
     ORDER BY u.vessel_limit_exceeded_at ASC`
  );
  return result.rows;
}

module.exports = {
  countAgencyVessels,
  getUserLimitState,
  markVesselLimitExceeded,
  clearVesselLimitExceeded,
  setNotifiedDay,
  getOverLimitAgencies,
};
