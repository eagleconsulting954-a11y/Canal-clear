/**
 * db/hazmat-checks.js — SQL query functions for hazmat_checks table.
 *
 * Owns: hazmat validation result persistence, usage counting.
 * Does NOT own: hazmat validation logic, IMDG rules, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

function insertHazmatCheck(pool, { userId, sessionId, unNumber, imdgClass, cargoDescription, packagingGroup, quantity, quantityUnit, overallStatus, totalChecks, passedChecks, failedChecks, warningChecks, resultJson, ipHash }) {
  return pool.query(`
    INSERT INTO hazmat_checks (
      user_id, session_id, un_number, imdg_class, cargo_description,
      packaging_group, quantity, quantity_unit,
      overall_status, total_checks, passed_checks, failed_checks, warning_checks,
      result_json, ip_hash
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [
    userId, sessionId,
    unNumber, imdgClass, cargoDescription,
    packagingGroup,
    quantity, quantityUnit,
    overallStatus, totalChecks, passedChecks,
    failedChecks, warningChecks,
    resultJson, ipHash,
  ]);
}

async function getUserSubscriptionForHazmat(pool, userId) {
  const result = await pool.query('SELECT subscription_status FROM users WHERE id = $1', [userId]);
  return result;
}

async function countHazmatChecksByUser(pool, userId) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM hazmat_checks WHERE user_id = $1 AND created_at >= date_trunc('month', NOW())`,
    [userId]
  );
  return result;
}

async function countHazmatChecksBySession(pool, sessionId) {
  const result = await pool.query(
    `SELECT COUNT(*) FROM hazmat_checks WHERE session_id = $1 AND user_id IS NULL AND created_at >= date_trunc('month', NOW())`,
    [sessionId]
  );
  return result;
}

module.exports = {
  insertHazmatCheck,
  getUserSubscriptionForHazmat,
  countHazmatChecksByUser,
  countHazmatChecksBySession,
};
