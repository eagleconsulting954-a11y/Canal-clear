/**
 * db/filing-deadlines.js — Deadline tracking & alert log queries.
 * Owns: filing_deadlines, deadline_alert_log, waterway_alert_prefs tables.
 * Does NOT own: email sending, scheduling, or waterway-specific business rules.
 */
'use strict';

/**
 * Create tables if they don't exist (called at server start).
 */
async function ensureDeadlineTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS filing_deadlines (
      id                SERIAL PRIMARY KEY,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      waterway          TEXT    NOT NULL CHECK (waterway IN ('panama', 'suez', 'bosporus', 'malacca', 'cape')),
      filing_type       TEXT    NOT NULL,
      vessel_name       TEXT    NOT NULL,
      imo_number        TEXT,
      deadline_at       TIMESTAMPTZ NOT NULL,
      filing_id         INTEGER,
      filing_url        TEXT,
      compliance_issues JSONB   DEFAULT '[]',
      alerts_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_filing_deadlines_user_id  ON filing_deadlines(user_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_filing_deadlines_deadline ON filing_deadlines(deadline_at) WHERE alerts_enabled = TRUE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_filing_deadlines_waterway ON filing_deadlines(waterway)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS deadline_alert_log (
      id            SERIAL PRIMARY KEY,
      deadline_id   INTEGER NOT NULL REFERENCES filing_deadlines(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL,
      recipient     TEXT    NOT NULL,
      alert_window  TEXT    NOT NULL,
      subject       TEXT    NOT NULL,
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (deadline_id, recipient, alert_window)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deadline_alert_log_deadline ON deadline_alert_log(deadline_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deadline_alert_log_sent_at  ON deadline_alert_log(sent_at)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS waterway_alert_prefs (
      id           SERIAL PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      waterway     TEXT    NOT NULL CHECK (waterway IN ('panama', 'suez', 'bosporus', 'malacca', 'cape')),
      enabled      BOOLEAN NOT NULL DEFAULT TRUE,
      alert_windows TEXT[] NOT NULL DEFAULT ARRAY['48h','24h','6h'],
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, waterway)
    )
  `);
}

/**
 * Upsert a filing deadline. Returns the created/updated row.
 */
async function upsertDeadline(pool, { userId, waterway, filingType, vesselName, imoNumber, deadlineAt, filingId, filingUrl, complianceIssues }) {
  const result = await pool.query(
    `INSERT INTO filing_deadlines
       (user_id, waterway, filing_type, vessel_name, imo_number, deadline_at, filing_id, filing_url, compliance_issues)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [userId, waterway, filingType, vesselName, imoNumber || null, deadlineAt, filingId || null, filingUrl || null, JSON.stringify(complianceIssues || [])]
  );
  return result.rows[0] || null;
}

/**
 * Update an existing deadline record linked to a filing_id.
 * Used when a filing is edited and the ETA changes.
 * Returns the updated row, or null if not found.
 */
async function updateDeadlineForFiling(pool, { filingId, userId, waterway, deadlineAt, complianceIssues }) {
  const result = await pool.query(
    `UPDATE filing_deadlines
     SET deadline_at = $1,
         compliance_issues = $2,
         alerts_enabled = TRUE,
         updated_at = NOW()
     WHERE filing_id = $3
       AND user_id = $4
       AND waterway = $5
     RETURNING *`,
    [deadlineAt, JSON.stringify(complianceIssues || []), filingId, userId, waterway]
  );
  return result.rows[0] || null;
}

/**
 * Disable alerts for a deadline linked to a filing_id (soft-cancel).
 * Called when a filing is deleted.
 */
async function disableDeadlineForFiling(pool, { filingId, userId, waterway }) {
  await pool.query(
    `UPDATE filing_deadlines
     SET alerts_enabled = FALSE, updated_at = NOW()
     WHERE filing_id = $1
       AND user_id = $2
       AND waterway = $3`,
    [filingId, userId, waterway]
  );
}

/**
 * Get all deadlines that need alert checks:
 * deadline_at is in the future but within `maxHoursAhead` hours,
 * and alerts_enabled = true.
 */
async function getUpcomingDeadlines(pool, maxHoursAhead) {
  const { rows } = await pool.query(
    `SELECT
       d.*,
       u.email AS user_email,
       u.name  AS user_name
     FROM filing_deadlines d
     JOIN users u ON u.id = d.user_id
     WHERE d.alerts_enabled = TRUE
       AND d.deadline_at > NOW()
       AND d.deadline_at <= NOW() + ($1 || ' hours')::INTERVAL
     ORDER BY d.deadline_at ASC`,
    [maxHoursAhead]
  );
  return rows;
}

/**
 * Check if an alert has already been sent for (deadline_id, recipient, alert_window).
 */
async function hasAlertBeenSent(pool, deadlineId, recipient, alertWindow) {
  const { rows } = await pool.query(
    `SELECT 1 FROM deadline_alert_log
     WHERE deadline_id = $1 AND recipient = $2 AND alert_window = $3`,
    [deadlineId, recipient, alertWindow]
  );
  return rows.length > 0;
}

/**
 * Record a sent alert to prevent duplicate sends.
 */
async function recordAlertSent(pool, { deadlineId, userId, recipient, alertWindow, subject }) {
  await pool.query(
    `INSERT INTO deadline_alert_log (deadline_id, user_id, recipient, alert_window, subject)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (deadline_id, recipient, alert_window) DO NOTHING`,
    [deadlineId, userId, recipient, alertWindow, subject]
  );
}

/**
 * Get alert preferences for a user and waterway.
 * Returns { enabled, alert_windows } or defaults if not set.
 */
async function getUserWaterwayPrefs(pool, userId, waterway) {
  const { rows } = await pool.query(
    `SELECT enabled, alert_windows FROM waterway_alert_prefs
     WHERE user_id = $1 AND waterway = $2`,
    [userId, waterway]
  );
  if (!rows.length) {
    // Defaults: enabled, standard windows per waterway
    return { enabled: true, alert_windows: defaultWindowsFor(waterway) };
  }
  return rows[0];
}

/**
 * Upsert user alert preferences for a waterway.
 */
async function setUserWaterwayPrefs(pool, userId, waterway, { enabled, alertWindows }) {
  await pool.query(
    `INSERT INTO waterway_alert_prefs (user_id, waterway, enabled, alert_windows)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, waterway) DO UPDATE
       SET enabled = $3, alert_windows = $4, updated_at = NOW()`,
    [userId, waterway, enabled, alertWindows]
  );
}

/**
 * Get alert log entries for the admin panel (most recent first).
 */
async function getAlertLog(pool, { waterway, limit = 100, offset = 0 } = {}) {
  let whereClauses = [];
  let params = [];

  if (waterway) {
    params.push(waterway);
    whereClauses.push(`d.waterway = $${params.length}`);
  }

  const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       al.id, al.recipient, al.alert_window, al.subject, al.sent_at,
       d.waterway, d.filing_type, d.vessel_name, d.imo_number, d.deadline_at,
       u.email AS user_email
     FROM deadline_alert_log al
     JOIN filing_deadlines d ON d.id = al.deadline_id
     JOIN users u ON u.id = al.user_id
     ${where}
     ORDER BY al.sent_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/**
 * Count total alerts sent (optionally filtered by waterway).
 */
async function countAlertsSent(pool, waterway) {
  const { rows } = await pool.query(
    waterway
      ? `SELECT COUNT(*) AS cnt FROM deadline_alert_log al JOIN filing_deadlines d ON d.id = al.deadline_id WHERE d.waterway = $1`
      : `SELECT COUNT(*) AS cnt FROM deadline_alert_log`,
    waterway ? [waterway] : []
  );
  return parseInt(rows[0]?.cnt || '0', 10);
}

/**
 * Default alert windows per waterway (task spec).
 */
function defaultWindowsFor(waterway) {
  const MAP = {
    panama:   ['48h', '24h', '6h'],
    suez:     ['72h', '48h', '24h'],
    bosporus: ['48h', '24h', '6h'],
    malacca:  ['24h', '12h', '6h'],
    cape:     ['96h', '48h', '24h'],
  };
  return MAP[waterway] || ['48h', '24h', '6h'];
}

module.exports = {
  ensureDeadlineTables,
  upsertDeadline,
  updateDeadlineForFiling,
  disableDeadlineForFiling,
  getUpcomingDeadlines,
  hasAlertBeenSent,
  recordAlertSent,
  getUserWaterwayPrefs,
  setUserWaterwayPrefs,
  getAlertLog,
  countAlertsSent,
  defaultWindowsFor,
};
