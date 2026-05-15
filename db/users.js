/**
 * db/users.js — SQL query functions for the users table.
 *
 * Owns: all user lookups, updates, and creation queries against the users table.
 * Does NOT own: authentication logic, password hashing, JWT signing, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

// ── READ ─────────────────────────────────────────────────────────────────────

async function getUserByEmail(pool, email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1',
    [email.toLowerCase().trim()]
  );
  return result.rows[0] || null;
}

async function getUserById(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, name, subscription_status, subscription_plan,
            plan_type, is_admin, created_at, onboarding_completed,
            allowed_canals, vessel_limit
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function getUserFullById(pool, userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Lightweight projection used by requireSubscription middleware.
 */
async function getUserSubscriptionById(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, subscription_status, subscription_expires_at,
            subscription_plan, plan_type, grace_period_started_at,
            onboarding_completed
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Lightweight projection used by requireAdmin middleware.
 */
async function getUserAdminStatus(pool, userId) {
  const result = await pool.query(
    'SELECT id, is_admin FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Lightweight projection used by requireWaterway middleware.
 */
async function getUserWaterwayAccess(pool, userId) {
  const result = await pool.query(
    'SELECT is_admin, allowed_canals, subscription_plan, subscription_status FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Used by agent-dashboard is-agent check.
 */
async function getUserAgentStatus(pool, userId) {
  const result = await pool.query(
    'SELECT is_agent, subscription_plan FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Fallback for agent-dashboard when is_agent column doesn't exist yet.
 */
async function getUserSubscriptionPlan(pool, userId) {
  const result = await pool.query(
    'SELECT subscription_plan FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Used by onboarding state endpoint.
 */
async function getOnboardingState(pool, userId) {
  const result = await pool.query(
    'SELECT onboarding_completed, onboarding_step FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Used by GET /api/subscription/status.
 */
async function getUserSubscriptionStatus(pool, userId) {
  const result = await pool.query(
    `SELECT id, subscription_status, subscription_plan, subscription_expires_at,
            plan_type, vessel_limit, allowed_canals, stripe_customer_id
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Used by GET /api/auth/me.
 */
async function getUserProfile(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, name, subscription_status, subscription_plan,
            subscription_expires_at, plan_type, is_admin, created_at,
            onboarding_completed, vessel_limit, allowed_canals
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

// ── WRITE ────────────────────────────────────────────────────────────────────

async function setGracePeriodStarted(pool, userId) {
  return pool.query(
    'UPDATE users SET grace_period_started_at = NOW() WHERE id = $1',
    [userId]
  );
}

async function seedAdminByEmail(pool, email) {
  const normalized = email.toLowerCase().trim();
  const result = await pool.query(
    'UPDATE users SET is_admin = TRUE WHERE LOWER(email) = $1 AND is_admin = FALSE RETURNING email',
    [normalized]
  );
  return result.rows[0] || null;
}

/**
 * Dynamic onboarding step update.
 * @param {object} pool
 * @param {string} sql - Full UPDATE SQL with placeholders
 * @param {Array} params - Parameterized values
 */
async function updateOnboardingRaw(pool, sql, params) {
  return pool.query(sql, params);
}

async function setOnboardingCompleted(pool, userId) {
  return pool.query(
    'UPDATE users SET onboarding_completed = TRUE WHERE id = $1',
    [userId]
  );
}

async function setOnboardingCompletedWithStep(pool, userId) {
  return pool.query(
    'UPDATE users SET onboarding_completed = TRUE, onboarding_step = GREATEST(onboarding_step, 5) WHERE id = $1',
    [userId]
  );
}

async function advanceOnboardingStep(pool, userId, step, complete) {
  const suffix = complete ? ', onboarding_completed = TRUE' : '';
  return pool.query(
    `UPDATE users SET onboarding_step = GREATEST(onboarding_step, $2)${suffix} WHERE id = $1`,
    [userId, step]
  );
}

async function createUser(pool, data) {
  const {
    email, password_hash, subscription_status, subscription_plan,
    subscription_expires_at, vessel_limit, plan_type, allowed_canals,
    name,
  } = data;
  const result = await pool.query(
    `INSERT INTO users
       (email, password_hash, subscription_status, subscription_plan, subscription_expires_at,
        subscription_updated_at, vessel_limit, plan_type, allowed_canals, name)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
     RETURNING *`,
    [email, password_hash, subscription_status || 'active', subscription_plan,
     subscription_expires_at, vessel_limit, plan_type, allowed_canals, name || null]
  );
  return result.rows[0];
}

async function updateUserPassword(pool, userId, passwordHash) {
  return pool.query(
    'UPDATE users SET password_hash = $2 WHERE id = $1',
    [userId, passwordHash]
  );
}

async function updatePasswordByEmail(pool, email, passwordHash) {
  return pool.query(
    'UPDATE users SET password_hash = $2 WHERE LOWER(email) = LOWER($1)',
    [email, passwordHash]
  );
}

async function updateUserSubscription(pool, userId, data) {
  const {
    password_hash, name, subscription_status, subscription_plan,
    subscription_expires_at, plan_type, vessel_limit, allowed_canals,
  } = data;
  return pool.query(
    `UPDATE users SET password_hash = COALESCE($2, password_hash),
       name = COALESCE($3, name),
       subscription_status = COALESCE($4, subscription_status),
       subscription_plan = COALESCE($5, subscription_plan),
       subscription_expires_at = COALESCE($6, subscription_expires_at),
       plan_type = COALESCE($7, plan_type),
       vessel_limit = COALESCE($8, vessel_limit),
       allowed_canals = COALESCE($9, allowed_canals),
       subscription_updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [userId, password_hash || null, name || null, subscription_status || null,
     subscription_plan || null, subscription_expires_at || null,
     plan_type || null, vessel_limit, allowed_canals || null]
  );
}

/**
 * Admin user listing with pagination.
 */
async function listUsers(pool, { limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, email, name, subscription_status, subscription_plan, plan_type,
            vessel_limit, allowed_canals, created_at, is_admin
     FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function countUsers(pool) {
  const result = await pool.query('SELECT COUNT(*) AS total FROM users');
  return parseInt(result.rows[0].total, 10);
}

// ── ROUTE-SPECIFIC READS ────────────────────────────────────────────────────

/**
 * Used by checkWaterwayAccess helper in api.js.
 */
async function getUserForWaterwayCheck(pool, userId) {
  const result = await pool.query(
    'SELECT is_admin, allowed_canals, subscription_plan FROM users WHERE id = $1',
    [userId]
  );
  return result;
}

/**
 * Full user row by email — returns raw query result (not unwrapped).
 * Used by post-payment-register and register routes that need result.rows.
 */
async function getUserFullByEmail(pool, email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1',
    [email]
  );
  return result;
}

/**
 * Used by forgot-password to check admin status.
 */
async function getUserAuthByEmail(pool, email) {
  const result = await pool.query(
    'SELECT id, email, is_admin FROM users WHERE LOWER(email) = $1',
    [email]
  );
  return result;
}

/**
 * Used by GET /api/auth/me.
 * Returns raw result (caller checks result.rows).
 */
async function getUserForAuthMe(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, name, subscription_status, subscription_plan, subscription_expires_at,
            is_admin, onboarding_completed, onboarding_step, plan_type
     FROM users WHERE id = $1`,
    [userId]
  );
  return result;
}

/**
 * Used by GET /api/subscription/status.
 * Includes grace_period_started_at and is_admin for grace period + admin checks.
 */
async function getUserSubscriptionFull(pool, userId) {
  const result = await pool.query(
    `SELECT id, subscription_status, subscription_plan, subscription_expires_at,
            plan_type, vessel_limit, grace_period_started_at, allowed_canals, is_admin
     FROM users WHERE id = $1`,
    [userId]
  );
  return result;
}

/**
 * Used by subscription-sync to look up user by email (id only).
 */
async function getUserIdByEmail(pool, email) {
  const result = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1',
    [email]
  );
  return result;
}

/**
 * Used by vessel limit enforcement in POST /api/filings.
 */
async function getUserVesselInfo(pool, userId) {
  const result = await pool.query(
    'SELECT subscription_plan, subscription_status, vessel_limit FROM users WHERE id = $1',
    [userId]
  );
  return result;
}

// ── ROUTE-SPECIFIC WRITES ───────────────────────────────────────────────────

/**
 * Set password and name on an existing user (register flow — user exists but no password).
 */
async function setUserPasswordAndName(pool, passwordHash, name, userId) {
  return pool.query(
    'UPDATE users SET password_hash = $1, name = COALESCE($2, name), updated_at = NOW() WHERE id = $3',
    [passwordHash, name, userId]
  );
}

/**
 * Update existing user with subscription after Stripe payment.
 * Used by post-payment-register when user already exists.
 */
async function updateUserAfterPayment(pool, { passwordHash, name, subscriptionPlan, subscriptionExpiresAt, stripeSubscriptionId, userId, vesselLimit, planType, allowedCanals }) {
  const result = await pool.query(
    `UPDATE users SET
      password_hash = $1,
      name = COALESCE($2, name),
      subscription_status = 'active',
      subscription_plan = $3,
      subscription_expires_at = $4,
      stripe_subscription_id = COALESCE($5, stripe_subscription_id),
      subscription_updated_at = NOW(),
      vessel_limit = $7,
      plan_type = $8,
      allowed_canals = $9,
      updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [passwordHash, name || null, subscriptionPlan, subscriptionExpiresAt, stripeSubscriptionId || null, userId, vesselLimit, planType, allowedCanals]
  );
  return result;
}

/**
 * Insert new user after Stripe payment.
 * Used by post-payment-register when user does not exist.
 */
async function insertUserAfterPayment(pool, { email, name, passwordHash, subscriptionPlan, subscriptionExpiresAt, stripeSubscriptionId, vesselLimit, planType, allowedCanals }) {
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash, subscription_status, subscription_plan, subscription_expires_at, stripe_subscription_id, subscription_updated_at, vessel_limit, plan_type, allowed_canals)
     VALUES ($1, $2, $3, 'active', $4, $5, $6, NOW(), $7, $8, $9)
     RETURNING *`,
    [email, name || null, passwordHash, subscriptionPlan, subscriptionExpiresAt, stripeSubscriptionId || null, vesselLimit, planType, allowedCanals]
  );
  return result;
}

/**
 * Update password by email with updated_at timestamp.
 * Used by reset-password route.
 */
async function updatePasswordByEmailWithTimestamp(pool, passwordHash, email) {
  return pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE LOWER(email) = $2',
    [passwordHash, email]
  );
}

/**
 * Sync subscription data from Stripe webhook (existing user).
 */
async function syncUserSubscription(pool, { mappedStatus, internalPlanKey, expiresAt, subscriptionId, vesselLimit, planType, userId, syncedCanals }) {
  const updateQuery = `
    UPDATE users SET
      subscription_status = $1,
      subscription_plan = COALESCE($2, subscription_plan),
      subscription_expires_at = $3,
      stripe_subscription_id = COALESCE($4, stripe_subscription_id),
      subscription_updated_at = NOW(),
      vessel_limit = CASE
        WHEN $5::integer IS NOT NULL THEN $5::integer
        WHEN $2 IS NOT NULL AND ($2 LIKE 'agent_pro%') THEN NULL
        ELSE vessel_limit
      END,
      plan_type = CASE WHEN $6 <> 'free' THEN $6 ELSE COALESCE(NULLIF(plan_type, 'free'), $6) END,
      grace_period_started_at = CASE WHEN $1 = 'active' THEN NULL ELSE grace_period_started_at END,
      allowed_canals = CASE WHEN $8::text[] IS NOT NULL THEN $8::text[] ELSE allowed_canals END,
      updated_at = NOW()
    WHERE id = $7
    RETURNING id, email, subscription_status, subscription_plan, vessel_limit, plan_type, allowed_canals`;
  const result = await pool.query(updateQuery, [
    mappedStatus,
    internalPlanKey || null,
    expiresAt,
    subscriptionId || null,
    vesselLimit,
    planType,
    userId,
    syncedCanals && syncedCanals.length > 0 ? syncedCanals : null,
  ]);
  return result;
}

/**
 * Create stub user during subscription sync (user doesn't exist yet).
 */
async function insertStubUser(pool, { email, mappedStatus, internalPlanKey, expiresAt, subscriptionId, vesselLimit, planType, syncedCanals }) {
  const result = await pool.query(
    `INSERT INTO users (email, subscription_status, subscription_plan, subscription_expires_at, stripe_subscription_id, subscription_updated_at, vessel_limit, plan_type, allowed_canals)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
     RETURNING id, email, subscription_status, subscription_plan, vessel_limit, plan_type, allowed_canals`,
    [email, mappedStatus, internalPlanKey || null, expiresAt, subscriptionId || null, vesselLimit, planType, syncedCanals.length > 0 ? syncedCanals : null]
  );
  return result;
}

/**
 * Look up a user for admin seeding (id, email, is_admin, password_hash).
 */
async function getAdminSeedCandidate(pool, email) {
  const result = await pool.query(
    'SELECT id, email, is_admin, password_hash FROM users WHERE LOWER(email) = $1',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Create admin user during startup seeding.
 */
async function createAdminUser(pool, email, passwordHash) {
  await pool.query(
    `INSERT INTO users (email, password_hash, subscription_status, subscription_plan, is_admin, onboarding_completed, allowed_canals, plan_type)
     VALUES ($1, $2, 'active', 'enterprise', TRUE, TRUE, $3, 'agent_pro')`,
    [email, passwordHash, ['panama', 'suez', 'bosporus', 'malacca', 'cape']]
  );
}

/**
 * Set password for an existing user by id.
 */
async function setPasswordById(pool, userId, passwordHash) {
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, userId]
  );
}

module.exports = {
  getUserByEmail,
  getUserById,
  getUserFullById,
  getUserSubscriptionById,
  getUserAdminStatus,
  getUserWaterwayAccess,
  getUserAgentStatus,
  getUserSubscriptionPlan,
  getOnboardingState,
  getUserSubscriptionStatus,
  getUserProfile,
  setGracePeriodStarted,
  seedAdminByEmail,
  updateOnboardingRaw,
  setOnboardingCompleted,
  setOnboardingCompletedWithStep,
  advanceOnboardingStep,
  createUser,
  updateUserPassword,
  updatePasswordByEmail,
  updateUserSubscription,
  listUsers,
  countUsers,
  getUserForWaterwayCheck,
  getUserFullByEmail,
  getUserAuthByEmail,
  getUserForAuthMe,
  getUserSubscriptionFull,
  getUserIdByEmail,
  getUserVesselInfo,
  setUserPasswordAndName,
  updateUserAfterPayment,
  insertUserAfterPayment,
  updatePasswordByEmailWithTimestamp,
  syncUserSubscription,
  insertStubUser,
  getAdminSeedCandidate,
  createAdminUser,
  setPasswordById,
};
