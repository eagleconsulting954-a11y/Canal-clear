/**
 * routes/v1-keys.js — API key management endpoints (fleet dashboard).
 *
 * Owns: CRUD for api_keys scoped to authenticated user, webhook delivery log viewer,
 *       activity feed, webhook mapping template management.
 * Does NOT own: raw key generation algo (crypto in this file), v1 API endpoints (routes/v1.js).
 *
 * All endpoints require JWT auth (requireAuth middleware).
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { requireAuth }     = require('../middleware/auth');
const { createApiKey, listApiKeys, revokeApiKey, updateApiKeyLabel } = require('../db/api-keys');
const { listWebhookLogs, getWebhookLog, listWebhookMappings, createWebhookMapping } = require('../db/webhook-logs');
const { listRecentActivity } = require('../db/inbound-data');

// All routes require JWT session auth
router.use(requireAuth);

// ── API Key CRUD ──────────────────────────────────────────────────────────────

/**
 * POST /api/developer/keys
 * Generate a new API key. Returns raw key ONCE — not stored.
 * Body: { label: string }
 */
router.post('/keys', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const label  = (req.body.label || '').trim().slice(0, 80);

  // Generate a cryptographically random key: cc_live_ + 32 hex chars
  const rawKey = 'cc_live_' + crypto.randomBytes(16).toString('hex');

  try {
    const keyRow = await createApiKey(pool, userId, rawKey, label);
    return res.json({
      success: true,
      key: rawKey,          // returned ONCE — cannot be retrieved again
      key_prefix: keyRow.key_prefix,
      id: keyRow.id,
      label: keyRow.label,
      created_at: keyRow.created_at,
      note: 'Store this key securely — it will not be shown again.',
    });
  } catch (err) {
    console.error('[v1-keys POST /keys]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to generate key' });
  }
});

/**
 * GET /api/developer/keys
 * List all API keys for current user (prefix only, never raw).
 */
router.get('/keys', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;

  try {
    const keys = await listApiKeys(pool, userId);
    return res.json({ success: true, keys });
  } catch (err) {
    console.error('[v1-keys GET /keys]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list keys' });
  }
});

/**
 * PATCH /api/developer/keys/:id
 * Update a key's label.
 */
router.patch('/keys/:id', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const keyId  = parseInt(req.params.id, 10);
  const label  = (req.body.label || '').trim().slice(0, 80);

  try {
    const updated = await updateApiKeyLabel(pool, keyId, userId, label);
    if (!updated) return res.status(404).json({ success: false, message: 'Key not found' });
    return res.json({ success: true, key: updated });
  } catch (err) {
    console.error('[v1-keys PATCH /keys/:id]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update key' });
  }
});

/**
 * DELETE /api/developer/keys/:id
 * Revoke a key. Irreversible.
 */
router.delete('/keys/:id', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const keyId  = parseInt(req.params.id, 10);

  try {
    const revoked = await revokeApiKey(pool, keyId, userId);
    if (!revoked) return res.status(404).json({ success: false, message: 'Key not found or already revoked' });
    return res.json({ success: true, revoked });
  } catch (err) {
    console.error('[v1-keys DELETE /keys/:id]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to revoke key' });
  }
});

// ── Webhook delivery log ──────────────────────────────────────────────────────

/**
 * GET /api/developer/webhook-logs
 * List recent webhook deliveries with status.
 */
router.get('/webhook-logs', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  try {
    const logs = await listWebhookLogs(pool, userId, { limit, offset });
    return res.json({ success: true, count: logs.length, logs });
  } catch (err) {
    console.error('[v1-keys GET /webhook-logs]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list webhook logs' });
  }
});

/**
 * GET /api/developer/webhook-logs/:id
 * Full payload inspection for a single delivery.
 */
router.get('/webhook-logs/:id', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const logId  = parseInt(req.params.id, 10);

  try {
    const log = await getWebhookLog(pool, userId, logId);
    if (!log) return res.status(404).json({ success: false, message: 'Log entry not found' });
    return res.json({ success: true, log });
  } catch (err) {
    console.error('[v1-keys GET /webhook-logs/:id]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve log' });
  }
});

// ── Webhook mapping templates ─────────────────────────────────────────────────

/**
 * GET /api/developer/webhook-mappings
 */
router.get('/webhook-mappings', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  try {
    const mappings = await listWebhookMappings(pool, userId);
    return res.json({ success: true, mappings });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list mappings' });
  }
});

/**
 * POST /api/developer/webhook-mappings
 * Body: { name, source_name, mapping: { "target_field": "source.nested.path" } }
 */
router.post('/webhook-mappings', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const { name, source_name, mapping } = req.body;

  if (!name) return res.status(422).json({ success: false, message: 'name is required' });
  if (!mapping || typeof mapping !== 'object') {
    return res.status(422).json({ success: false, message: 'mapping must be an object' });
  }

  try {
    const template = await createWebhookMapping(pool, userId, { name, source_name, mapping });
    return res.json({ success: true, mapping: template });
  } catch (err) {
    console.error('[v1-keys POST /webhook-mappings]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create mapping' });
  }
});

// ── Activity feed ─────────────────────────────────────────────────────────────

/**
 * GET /api/developer/activity
 * Last 50 inbound pushes (vessels + voyages + crew) with status.
 */
router.get('/activity', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 50, 200);

  try {
    const activity = await listRecentActivity(pool, userId, limit);
    return res.json({ success: true, count: activity.length, activity });
  } catch (err) {
    console.error('[v1-keys GET /activity]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve activity' });
  }
});

module.exports = router;
