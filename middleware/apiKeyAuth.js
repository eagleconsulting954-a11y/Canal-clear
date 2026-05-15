/**
 * middleware/apiKeyAuth.js — Bearer API key authentication for /api/v1/*.
 *
 * Owns: extracting + validating API keys from Authorization header.
 *       In-memory rate limiting (100 req/min per key).
 * Does NOT own: key generation, key storage (db/api-keys.js), user auth (auth.js).
 *
 * Sets req.apiKey and req.user (compatible shape with JWT req.user) on success.
 */

const { lookupApiKey } = require('../db/api-keys');

// In-memory rate limit store: keyId -> { count, windowStart }
// Simple sliding-window per minute. Resets automatically as windows expire.
const rateLimitStore = new Map();
const WINDOW_MS = 60 * 1000;       // 1 minute
const MAX_REQUESTS = 100;          // per window per key

function checkRateLimit(keyId) {
  const now = Date.now();
  const entry = rateLimitStore.get(keyId);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    rateLimitStore.set(keyId, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetAt = entry.windowStart + WINDOW_MS;
    return { allowed: false, remaining: 0, resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetAt: entry.windowStart + WINDOW_MS };
}

// Periodically purge expired entries to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [keyId, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart >= WINDOW_MS * 2) rateLimitStore.delete(keyId);
  }
}, 5 * 60 * 1000);

/**
 * Middleware: require a valid API key in Authorization: Bearer <key> header.
 * On success: sets req.apiKey (DB row) and req.user.id (for downstream queries).
 */
async function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'missing_auth',
      message: 'Authorization: Bearer <api_key> header required',
    });
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return res.status(401).json({ success: false, error: 'missing_auth', message: 'API key is empty' });
  }

  try {
    const pool = req.app.locals.pool;
    const keyRow = await lookupApiKey(pool, rawKey);
    if (!keyRow) {
      return res.status(401).json({
        success: false,
        error: 'invalid_key',
        message: 'API key not found or revoked',
      });
    }

    // Rate limiting
    const rl = checkRateLimit(keyRow.id);
    res.set({
      'X-RateLimit-Limit': MAX_REQUESTS,
      'X-RateLimit-Remaining': rl.remaining,
      'X-RateLimit-Reset': Math.floor(rl.resetAt / 1000),
    });

    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        error: 'rate_limited',
        message: 'Rate limit exceeded: 100 requests/minute per API key',
        retry_after: Math.ceil((rl.resetAt - Date.now()) / 1000),
      });
    }

    req.apiKey = keyRow;
    // Provide req.user compatible shape so db functions work
    req.user = { id: keyRow.user_id };
    next();
  } catch (err) {
    console.error('[apiKeyAuth] error:', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Auth check failed' });
  }
}

module.exports = { requireApiKey };
