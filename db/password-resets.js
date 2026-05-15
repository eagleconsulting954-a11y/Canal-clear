/**
 * db/password-resets.js — SQL query functions for the password_resets table.
 *
 * Owns: DDL for password_resets table (ensure table + index exist).
 * Does NOT own: reset token generation, email sending, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function ensurePasswordResetsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token)`);
}

/**
 * Insert a new password reset token.
 */
async function createPasswordReset(pool, email, token, expiresAt) {
  return pool.query(
    'INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)',
    [email, token, expiresAt]
  );
}

/**
 * Look up a valid (unused, not expired) password reset token.
 */
async function getValidPasswordReset(pool, token) {
  const result = await pool.query(
    'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
    [token]
  );
  return result;
}

/**
 * Mark a password reset token as used.
 */
async function markPasswordResetUsed(pool, resetId) {
  return pool.query(
    'UPDATE password_resets SET used = TRUE WHERE id = $1',
    [resetId]
  );
}

module.exports = {
  ensurePasswordResetsTable,
  createPasswordReset,
  getValidPasswordReset,
  markPasswordResetUsed,
};
