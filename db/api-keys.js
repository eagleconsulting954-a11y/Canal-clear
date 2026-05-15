/**
 * db/api-keys.js — SQL query functions for api_keys table.
 *
 * Owns: CRUD for API keys (hashed storage, prefix display, usage tracking).
 * Does NOT own: key generation (handled in route), auth verification (middleware/apiKeyAuth.js).
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

const crypto = require('crypto');

/** Hash a raw API key for safe storage */
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Create a new API key record.
 * Caller generates raw key; this stores only the hash + prefix.
 */
async function createApiKey(pool, userId, rawKey, label = '') {
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);
  const result = await pool.query(`
    INSERT INTO api_keys (user_id, key_hash, key_prefix, label, is_active, created_at)
    VALUES ($1, $2, $3, $4, TRUE, NOW())
    RETURNING id, user_id, key_prefix, label, is_active, last_used_at, request_count, created_at
  `, [userId, keyHash, keyPrefix, label]);
  return result.rows[0];
}

/**
 * Look up a key by hash. Returns null if not found or revoked.
 * Side-effect: updates last_used_at and increments request_count.
 */
async function lookupApiKey(pool, rawKey) {
  const keyHash = hashKey(rawKey);
  const result = await pool.query(`
    UPDATE api_keys
    SET last_used_at = NOW(), request_count = request_count + 1
    WHERE key_hash = $1 AND is_active = TRUE AND revoked_at IS NULL
    RETURNING id, user_id, key_prefix, label, request_count, created_at
  `, [keyHash]);
  return result.rows[0] || null;
}

/**
 * List all active + revoked keys for a user (for management UI).
 */
async function listApiKeys(pool, userId) {
  const result = await pool.query(`
    SELECT id, user_id, key_prefix, label, is_active, last_used_at, request_count, created_at, revoked_at
    FROM api_keys
    WHERE user_id = $1
    ORDER BY created_at DESC
  `, [userId]);
  return result.rows;
}

/**
 * Revoke a key (soft delete). Verifies ownership.
 */
async function revokeApiKey(pool, keyId, userId) {
  const result = await pool.query(`
    UPDATE api_keys
    SET is_active = FALSE, revoked_at = NOW()
    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
    RETURNING id, key_prefix, label, revoked_at
  `, [keyId, userId]);
  return result.rows[0] || null;
}

/**
 * Update a key's label.
 */
async function updateApiKeyLabel(pool, keyId, userId, label) {
  const result = await pool.query(`
    UPDATE api_keys SET label = $3
    WHERE id = $1 AND user_id = $2
    RETURNING id, key_prefix, label
  `, [keyId, userId, label]);
  return result.rows[0] || null;
}

module.exports = { hashKey, createApiKey, lookupApiKey, listApiKeys, revokeApiKey, updateApiKeyLabel };
