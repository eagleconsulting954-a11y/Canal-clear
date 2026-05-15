/**
 * db/submission-attempts.js — SQL query functions for the submission_attempts table.
 *
 * Owns: unified audit log for all automated filing submissions across all 5 authorities
 *       (ACP VUMPA, SCA, SAMSA, Turkish VTSC, MPA Singapore).
 * Does NOT own: business logic, actual submission execution, encryption, email sending.
 *
 * Key contract: `record()` is the single entry point that the 5 integration tasks call.
 * All callers pass `pool` (from req.app.locals.pool).
 */

const VALID_WATERWAYS  = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
const VALID_AUTHORITIES = ['acp_vumpa', 'sca', 'samsa', 'turkish_vtsc', 'mpa_singapore'];
const VALID_CHANNELS   = ['email', 'api', 'portal_assist'];
const VALID_DIRECTIONS = ['outbound', 'inbound_ack'];
const VALID_STATUSES   = ['queued', 'sent', 'delivered', 'acknowledged', 'failed', 'manual_required'];

/**
 * record() — the single helper that every integration task calls to log a submission attempt.
 *
 * Required:  userId, waterway, authority, channel, status
 * Optional:  vesselId, direction, payload, responseBody, responseStatus,
 *            authorityReference, errorMessage, sentAt, acknowledgedAt
 *
 * Returns the inserted row.
 */
async function record(pool, {
  userId,
  vesselId        = null,
  waterway,
  authority,
  channel,
  direction       = 'outbound',
  payload         = null,
  responseBody    = null,
  responseStatus  = null,
  status,
  authorityReference = null,
  errorMessage    = null,
  sentAt          = null,
  acknowledgedAt  = null,
}) {
  // Sanitize payload: remove any credential-like keys before persisting
  const safePayload = sanitizePayload(payload);

  // Truncate response body to avoid bloat (8 KB cap)
  const safeResponse = responseBody
    ? String(responseBody).slice(0, 8192)
    : null;

  const result = await pool.query(
    `INSERT INTO submission_attempts
       (user_id, vessel_id, waterway, authority, channel, direction,
        payload, response_body, response_status, status,
        authority_reference, error_message, sent_at, acknowledged_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      userId, vesselId, waterway, authority, channel, direction,
      safePayload ? JSON.stringify(safePayload) : null,
      safeResponse, responseStatus, status,
      authorityReference, errorMessage,
      sentAt, acknowledgedAt,
    ]
  );
  return result.rows[0];
}

/**
 * updateStatus() — update status + optional authority reference after async acknowledgement.
 * Used when a Postmark delivery webhook fires, or an API poll confirms delivery.
 */
async function updateStatus(pool, id, status, { authorityReference, errorMessage, acknowledgedAt } = {}) {
  const result = await pool.query(
    `UPDATE submission_attempts
     SET status = $2,
         authority_reference = COALESCE($3, authority_reference),
         error_message       = COALESCE($4, error_message),
         acknowledged_at     = COALESCE($5, acknowledged_at),
         sent_at             = CASE WHEN $2 IN ('sent','delivered') AND sent_at IS NULL THEN NOW() ELSE sent_at END
     WHERE id = $1
     RETURNING *`,
    [id, status, authorityReference || null, errorMessage || null, acknowledgedAt || null]
  );
  return result.rows[0] || null;
}

// ── Admin viewer queries ──────────────────────────────────────────────────────

const PAGE_SIZE = 50;

/**
 * list() — paginated list with optional filters for the admin /admin/submissions viewer.
 */
async function list(pool, { waterway, authority, status, vesselId, userId, dateFrom, dateTo, offset = 0, limit = PAGE_SIZE } = {}) {
  const conditions = [];
  const params = [];

  const addParam = (val) => { params.push(val); return `$${params.length}`; };

  if (waterway)  conditions.push(`sa.waterway  = ${addParam(waterway)}`);
  if (authority) conditions.push(`sa.authority = ${addParam(authority)}`);
  if (status)    conditions.push(`sa.status    = ${addParam(status)}`);
  if (vesselId)  conditions.push(`sa.vessel_id = ${addParam(parseInt(vesselId, 10))}`);
  if (userId)    conditions.push(`sa.user_id   = ${addParam(parseInt(userId, 10))}`);
  if (dateFrom)  conditions.push(`sa.created_at >= ${addParam(dateFrom)}`);
  if (dateTo)    conditions.push(`sa.created_at <= ${addParam(dateTo)}`);

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM submission_attempts sa ${where}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  params.push(limit, offset);
  const rows = await pool.query(
    `SELECT sa.id, sa.user_id, sa.vessel_id, sa.waterway, sa.authority, sa.channel,
            sa.direction, sa.status, sa.authority_reference, sa.error_message,
            sa.response_status, sa.created_at, sa.sent_at, sa.acknowledged_at,
            u.email AS user_email,
            v.name  AS vessel_name, v.imo AS vessel_imo
     FROM submission_attempts sa
     LEFT JOIN users   u ON u.id = sa.user_id
     LEFT JOIN vessels v ON v.id = sa.vessel_id
     ${where}
     ORDER BY sa.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows: rows.rows, total };
}

/**
 * getById() — full row including payload + response_body for detail expansion.
 * Admin-only; caller must verify admin session before calling.
 */
async function getById(pool, id) {
  const result = await pool.query(
    `SELECT sa.*,
            u.email AS user_email,
            v.name  AS vessel_name, v.imo AS vessel_imo
     FROM submission_attempts sa
     LEFT JOIN users   u ON u.id = sa.user_id
     LEFT JOIN vessels v ON v.id = sa.vessel_id
     WHERE sa.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * getByVessel() — per-vessel filing history for the customer-facing vessel detail page.
 * Scoped to userId so customers only see their own.
 */
async function getByVessel(pool, vesselId, userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, waterway, authority, channel, direction, status,
            authority_reference, error_message, response_status,
            created_at, sent_at, acknowledged_at
     FROM submission_attempts
     WHERE vessel_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [vesselId, userId, limit, offset]
  );

  const count = await pool.query(
    'SELECT COUNT(*) FROM submission_attempts WHERE vessel_id = $1 AND user_id = $2',
    [vesselId, userId]
  );

  return { rows: result.rows, total: parseInt(count.rows[0].count, 10) };
}

/**
 * stats() — summary counts + 7-day trend for the admin viewer header.
 */
async function stats(pool) {
  const totals = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM submission_attempts
     GROUP BY status`
  );

  const trend = await pool.query(
    `SELECT DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status IN ('delivered','acknowledged')) AS succeeded,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed
     FROM submission_attempts
     WHERE created_at >= NOW() - INTERVAL '7 days'
     GROUP BY day
     ORDER BY day`
  );

  const byAuthority = await pool.query(
    `SELECT authority, COUNT(*) AS count
     FROM submission_attempts
     WHERE created_at >= NOW() - INTERVAL '30 days'
     GROUP BY authority
     ORDER BY count DESC`
  );

  return {
    totals:      totals.rows,
    trend:       trend.rows,
    byAuthority: byAuthority.rows,
  };
}

/**
 * csvRows() — full export for CSV download (no pagination, no sensitive fields).
 */
async function csvRows(pool, filters = {}) {
  const { rows } = await list(pool, { ...filters, limit: 10000, offset: 0 });
  return rows;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Strip credential-like keys from a payload object before persisting.
 * Covers password/token/secret/key field names (case-insensitive).
 */
function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const BLOCKED = /password|secret|token|apikey|api_key|credential|auth/i;
  const clean = {};
  for (const [k, v] of Object.entries(payload)) {
    if (BLOCKED.test(k)) {
      clean[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      clean[k] = sanitizePayload(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

module.exports = {
  record,
  updateStatus,
  list,
  getById,
  getByVessel,
  stats,
  csvRows,
  VALID_WATERWAYS,
  VALID_AUTHORITIES,
  VALID_CHANNELS,
  VALID_STATUSES,
};
