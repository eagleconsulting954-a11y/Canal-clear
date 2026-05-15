/**
 * db/webhook-logs.js — SQL query functions for webhook_logs and webhook_mappings.
 *
 * Owns: webhook delivery logging, field mapping template CRUD.
 * Does NOT own: field mapping logic (handled in routes/v1.js), pool construction.
 */

/**
 * Insert a new webhook log entry. Returns the stored row.
 */
async function logWebhook(pool, fields) {
  const {
    user_id, api_key_id, source_name, method = 'POST',
    headers, payload, status = 'received',
  } = fields;
  const result = await pool.query(`
    INSERT INTO webhook_logs (
      user_id, api_key_id, source_name, method, headers, payload,
      status, received_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    RETURNING id, received_at, status
  `, [
    user_id || null, api_key_id || null, source_name || null, method,
    headers ? JSON.stringify(headers) : null,
    payload ? JSON.stringify(payload) : null,
    status,
  ]);
  return result.rows[0];
}

/**
 * Update a webhook log entry after processing.
 */
async function updateWebhookLog(pool, logId, { status, mapped_entities, mapping_id, error_detail }) {
  const result = await pool.query(`
    UPDATE webhook_logs SET
      status          = COALESCE($2, status),
      mapped_entities = COALESCE($3::jsonb, mapped_entities),
      mapping_id      = COALESCE($4, mapping_id),
      error_detail    = COALESCE($5, error_detail),
      processed_at    = NOW()
    WHERE id = $1
    RETURNING id, status, processed_at
  `, [
    logId,
    status || null,
    mapped_entities ? JSON.stringify(mapped_entities) : null,
    mapping_id || null,
    error_detail || null,
  ]);
  return result.rows[0] || null;
}

/**
 * List recent webhook deliveries for a user.
 */
async function listWebhookLogs(pool, userId, { limit = 50, offset = 0 } = {}) {
  const result = await pool.query(`
    SELECT id, source_name, status, error_detail, received_at, processed_at,
           LEFT(payload::text, 200) AS payload_preview
    FROM webhook_logs
    WHERE user_id = $1
    ORDER BY received_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);
  return result.rows;
}

/**
 * Get full details of a single webhook log (including payload).
 */
async function getWebhookLog(pool, userId, logId) {
  const result = await pool.query(`
    SELECT * FROM webhook_logs WHERE id = $1 AND user_id = $2
  `, [logId, userId]);
  return result.rows[0] || null;
}

/**
 * List webhook mapping templates for a user.
 */
async function listWebhookMappings(pool, userId) {
  const result = await pool.query(`
    SELECT id, name, source_name, mapping, is_active, created_at
    FROM webhook_mappings WHERE user_id = $1 ORDER BY created_at DESC
  `, [userId]);
  return result.rows;
}

/**
 * Create a webhook mapping template.
 */
async function createWebhookMapping(pool, userId, { name, source_name, mapping }) {
  const result = await pool.query(`
    INSERT INTO webhook_mappings (user_id, name, source_name, mapping, created_at, updated_at)
    VALUES ($1,$2,$3,$4,NOW(),NOW())
    RETURNING *
  `, [userId, name, source_name || null, JSON.stringify(mapping || {})]);
  return result.rows[0];
}

module.exports = {
  logWebhook,
  updateWebhookLog,
  listWebhookLogs,
  getWebhookLog,
  listWebhookMappings,
  createWebhookMapping,
};
