/**
 * db/demo-codes.js — SQL query functions for demo_codes and demo_sessions tables.
 *
 * Owns: CRUD for demo codes and demo session lookup/creation.
 * Does NOT own: code generation logic, session cookie handling, or route wiring.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

// ── demo_codes ────────────────────────────────────────────────────────────────

/**
 * Create a new demo code.
 */
async function createDemoCode(pool, { code, expiresAt, maxUses, createdBy, notes }) {
  const result = await pool.query(`
    INSERT INTO demo_codes (code, expires_at, max_uses, created_by, notes, is_active)
    VALUES ($1, $2, $3, $4, $5, TRUE)
    RETURNING *
  `, [
    code,
    expiresAt || null,
    maxUses || 10,
    createdBy || 'admin',
    notes || null,
  ]);
  return result.rows[0];
}

/**
 * Look up a demo code by its code string.
 * Returns null if not found, inactive, or expired.
 * Does NOT increment use_count — call incrementUseCount separately after session creation.
 */
async function getDemoCodeByCode(pool, code) {
  const result = await pool.query(`
    SELECT * FROM demo_codes
    WHERE code = $1
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND use_count < max_uses
  `, [code.toUpperCase().trim()]);
  return result.rows[0] || null;
}

/**
 * Increment use_count on a demo code after a session is created.
 */
async function incrementUseCount(pool, demoCodeId) {
  await pool.query(`
    UPDATE demo_codes SET use_count = use_count + 1 WHERE id = $1
  `, [demoCodeId]);
}

/**
 * List all demo codes (for admin panel).
 */
async function listDemoCodes(pool) {
  const result = await pool.query(`
    SELECT
      dc.*,
      (SELECT MAX(ds.created_at) FROM demo_sessions ds WHERE ds.demo_code_id = dc.id) AS last_used_at
    FROM demo_codes dc
    ORDER BY dc.created_at DESC
  `);
  return result.rows;
}

/**
 * Revoke (soft delete) a demo code and invalidate all its sessions.
 */
async function revokeDemoCode(pool, id) {
  const result = await pool.query(`
    UPDATE demo_codes SET is_active = FALSE WHERE id = $1
    RETURNING *
  `, [id]);
  return result.rows[0] || null;
}

// ── demo_sessions ─────────────────────────────────────────────────────────────

/**
 * Create a demo session for a valid code.
 * Returns the session row with session_token.
 */
async function createDemoSession(pool, { demoCodeId, sessionToken, ipAddress, userAgent }) {
  const result = await pool.query(`
    INSERT INTO demo_sessions (demo_code_id, session_token, ip_address, user_agent, expires_at)
    VALUES ($1, $2, $3, $4, NOW() + INTERVAL '48 hours')
    RETURNING *
  `, [demoCodeId, sessionToken, ipAddress || null, userAgent || null]);
  return result.rows[0];
}

/**
 * Look up an active demo session by its token.
 * Returns null if not found or expired.
 */
async function getDemoSessionByToken(pool, token) {
  const result = await pool.query(`
    SELECT ds.*, dc.code AS demo_code, dc.is_active AS code_is_active
    FROM demo_sessions ds
    JOIN demo_codes dc ON dc.id = ds.demo_code_id
    WHERE ds.session_token = $1
      AND ds.expires_at > NOW()
      AND dc.is_active = TRUE
  `, [token]);
  return result.rows[0] || null;
}

/**
 * Touch last_active_at on an existing demo session.
 */
async function touchDemoSession(pool, token) {
  await pool.query(`
    UPDATE demo_sessions SET last_active_at = NOW() WHERE session_token = $1
  `, [token]);
}

/**
 * Delete (expire) a demo session by token (used on logout).
 */
async function deleteDemoSession(pool, token) {
  await pool.query(`
    DELETE FROM demo_sessions WHERE session_token = $1
  `, [token]);
}

module.exports = {
  createDemoCode,
  getDemoCodeByCode,
  incrementUseCount,
  listDemoCodes,
  revokeDemoCode,
  createDemoSession,
  getDemoSessionByToken,
  touchDemoSession,
  deleteDemoSession,
};
