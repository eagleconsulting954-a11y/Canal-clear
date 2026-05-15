/**
 * db/approval-workflow.js — Data access for filing approval workflows.
 *
 * Owns: queries against org_approval_settings, filing_audit_log,
 *       filing_review_comments, user_notifications, and workflow_status
 *       columns on sp1_filings / malacca_filings / cape_filings.
 * Does NOT own: workflow state machine logic, email notifications, route handling,
 *               pool construction.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ORG SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

async function getApprovalSettings(pool, userId) {
  const r = await pool.query(
    'SELECT * FROM org_approval_settings WHERE user_id = $1',
    [userId]
  );
  return r.rows[0] || null;
}

async function upsertApprovalSettings(pool, userId, settings) {
  const {
    enabled = false,
    auto_approve_self = false,
    require_admin_batch = false,
    notify_on_submit = true,
    notify_on_approve = true,
    notify_on_reject = true,
    notify_on_changes = true,
    daily_digest = false,
  } = settings;

  const r = await pool.query(
    `INSERT INTO org_approval_settings
       (user_id, enabled, auto_approve_self, require_admin_batch,
        notify_on_submit, notify_on_approve, notify_on_reject,
        notify_on_changes, daily_digest, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       enabled             = EXCLUDED.enabled,
       auto_approve_self   = EXCLUDED.auto_approve_self,
       require_admin_batch = EXCLUDED.require_admin_batch,
       notify_on_submit    = EXCLUDED.notify_on_submit,
       notify_on_approve   = EXCLUDED.notify_on_approve,
       notify_on_reject    = EXCLUDED.notify_on_reject,
       notify_on_changes   = EXCLUDED.notify_on_changes,
       daily_digest        = EXCLUDED.daily_digest,
       updated_at          = NOW()
     RETURNING *`,
    [userId, enabled, auto_approve_self, require_admin_batch,
     notify_on_submit, notify_on_approve, notify_on_reject, notify_on_changes, daily_digest]
  );
  return r.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW STATUS — filing table updates
// ─────────────────────────────────────────────────────────────────────────────

const WORKFLOW_TABLE = {
  sp1:     'sp1_filings',
  malacca: 'malacca_filings',
  cape:    'cape_filings',
};

/**
 * Update workflow_status (and optional timestamp columns) on a filing row.
 *
 * @param {object} pool
 * @param {string} filingType  — 'sp1' | 'malacca' | 'cape'
 * @param {number} filingId
 * @param {object} update      — { workflow_status, submitted_at, reviewed_by, reviewed_at, etc. }
 */
async function updateFilingWorkflowStatus(pool, filingType, filingId, update) {
  const table = WORKFLOW_TABLE[filingType];
  if (!table) throw new Error(`Unknown filing type: ${filingType}`);

  const setClauses = [];
  const values = [];
  let idx = 1;

  const allowed = [
    'workflow_status', 'submitted_at', 'reviewed_by', 'reviewed_at',
    'approved_by', 'approved_at', 'exported_at', 'exported_by',
  ];

  for (const key of allowed) {
    if (update[key] !== undefined) {
      setClauses.push(`${key} = $${idx++}`);
      values.push(update[key]);
    }
  }

  if (setClauses.length === 0) throw new Error('No valid update fields');

  setClauses.push(`updated_at = NOW()`);
  values.push(filingId);

  const r = await pool.query(
    `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return r.rows[0] || null;
}

/**
 * Get a filing row with vessel info (for email notifications).
 * Returns null if not found or soft-deleted.
 */
async function getFilingWithVesselInfo(pool, filingType, filingId) {
  const table = WORKFLOW_TABLE[filingType];
  if (!table) return null;

  const r = await pool.query(
    `SELECT id, user_id, workflow_status, vessel_name, imo_number
     FROM ${table}
     WHERE id = $1 AND deleted_at IS NULL`,
    [filingId]
  );
  return r.rows[0] ? { ...r.rows[0], filing_type: filingType } : null;
}

/**
 * Get a filing row with workflow columns.
 * Returns null if not found or soft-deleted.
 */
async function getFilingWorkflowState(pool, filingType, filingId) {
  const table = WORKFLOW_TABLE[filingType];
  if (!table) throw new Error(`Unknown filing type: ${filingType}`);

  const r = await pool.query(
    `SELECT id, user_id, workflow_status, submitted_at, reviewed_by, reviewed_at,
            approved_by, approved_at, exported_at, exported_by, updated_at
     FROM ${table}
     WHERE id = $1 AND deleted_at IS NULL`,
    [filingId]
  );
  return r.rows[0] || null;
}

/**
 * List filings needing review across all types for a given user's org.
 */
async function listPendingReviewFilings(pool, userId) {
  const results = [];
  for (const [type, table] of Object.entries(WORKFLOW_TABLE)) {
    const r = await pool.query(
      `SELECT id, user_id, workflow_status, submitted_at, updated_at,
              '${type}' AS filing_type,
              COALESCE(vessel_name, '') AS vessel_name,
              COALESCE(imo_number, '') AS imo_number
       FROM ${table}
       WHERE user_id = $1
         AND workflow_status IN ('submitted', 'in_review', 'changes_requested')
         AND deleted_at IS NULL
       ORDER BY submitted_at ASC NULLS LAST`,
      [userId]
    );
    results.push(...r.rows);
  }
  return results.sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0));
}

/**
 * Count pending approvals for notification badge.
 */
async function countPendingApprovals(pool, userId) {
  let total = 0;
  for (const table of Object.values(WORKFLOW_TABLE)) {
    const r = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${table}
       WHERE user_id = $1
         AND workflow_status IN ('submitted', 'in_review')
         AND deleted_at IS NULL`,
      [userId]
    );
    total += parseInt(r.rows[0].cnt, 10);
  }
  return total;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

async function appendAuditEntry(pool, { filing_id, filing_type, action, actor_user_id, actor_role, comment, metadata }) {
  const r = await pool.query(
    `INSERT INTO filing_audit_log
       (filing_id, filing_type, action, actor_user_id, actor_role, comment, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [filing_id, filing_type, action, actor_user_id || null, actor_role || null,
     comment || null, metadata ? JSON.stringify(metadata) : '{}']
  );
  return r.rows[0];
}

async function getAuditLog(pool, filingType, filingId) {
  const r = await pool.query(
    `SELECT al.*, u.email AS actor_email
     FROM filing_audit_log al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.filing_id = $1 AND al.filing_type = $2
     ORDER BY al.created_at ASC`,
    [filingId, filingType]
  );
  return r.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

async function addReviewComment(pool, { filing_id, filing_type, field_name, comment, author_user_id }) {
  const r = await pool.query(
    `INSERT INTO filing_review_comments
       (filing_id, filing_type, field_name, comment, author_user_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [filing_id, filing_type, field_name || null, comment, author_user_id || null]
  );
  return r.rows[0];
}

async function getReviewComments(pool, filingType, filingId) {
  const r = await pool.query(
    `SELECT rc.*, u.email AS author_email
     FROM filing_review_comments rc
     LEFT JOIN users u ON u.id = rc.author_user_id
     WHERE rc.filing_id = $1 AND rc.filing_type = $2
     ORDER BY rc.created_at ASC`,
    [filingId, filingType]
  );
  return r.rows;
}

async function resolveReviewComment(pool, commentId) {
  const r = await pool.query(
    `UPDATE filing_review_comments
     SET resolved = TRUE, resolved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [commentId]
  );
  return r.rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-APP NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

async function createNotification(pool, { user_id, kind, title, body, filing_id, filing_type }) {
  const r = await pool.query(
    `INSERT INTO user_notifications (user_id, kind, title, body, filing_id, filing_type)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [user_id, kind, title, body || null, filing_id || null, filing_type || null]
  );
  return r.rows[0];
}

async function listNotifications(pool, userId, { limit = 30, unreadOnly = false } = {}) {
  const whereUnread = unreadOnly ? 'AND read = FALSE' : '';
  const r = await pool.query(
    `SELECT * FROM user_notifications
     WHERE user_id = $1 ${whereUnread}
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

async function markNotificationsRead(pool, userId, ids) {
  if (!ids || ids.length === 0) {
    // Mark all unread as read
    await pool.query(
      'UPDATE user_notifications SET read = TRUE, read_at = NOW() WHERE user_id = $1 AND read = FALSE',
      [userId]
    );
  } else {
    await pool.query(
      `UPDATE user_notifications SET read = TRUE, read_at = NOW()
       WHERE user_id = $1 AND id = ANY($2::int[])`,
      [userId, ids]
    );
  }
}

async function countUnreadNotifications(pool, userId) {
  const r = await pool.query(
    'SELECT COUNT(*) AS cnt FROM user_notifications WHERE user_id = $1 AND read = FALSE',
    [userId]
  );
  return parseInt(r.rows[0].cnt, 10);
}

module.exports = {
  getApprovalSettings,
  upsertApprovalSettings,
  updateFilingWorkflowStatus,
  getFilingWithVesselInfo,
  getFilingWorkflowState,
  listPendingReviewFilings,
  countPendingApprovals,
  appendAuditEntry,
  getAuditLog,
  addReviewComment,
  getReviewComments,
  resolveReviewComment,
  createNotification,
  listNotifications,
  markNotificationsRead,
  countUnreadNotifications,
};
