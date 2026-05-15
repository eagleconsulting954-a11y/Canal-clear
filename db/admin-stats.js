/**
 * db/admin-stats.js — Admin dashboard statistics and listing queries
 *
 * Owns: all read queries powering the admin dashboard panels (stats, user list,
 * filing list, lead list, signups chart, Suez analytics, ISPS timeline, convoy status).
 * Does NOT own: route handling, authentication, pool construction.
 *
 * All callers pass pool (from req.app.locals.pool).
 */

/**
 * Get aggregated admin dashboard stats across all waterways.
 * Single optimized query with subselect aggregations.
 * @param {object} pool
 * @returns {Promise<object>} stats row
 */
async function getDashboardStats(pool) {
  const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE subscription_status IN ('active','trialing')) AS active_users,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days') AS new_users_week,
        (SELECT COUNT(*) FROM filings) + (SELECT COUNT(*) FROM sp1_filings WHERE deleted_at IS NULL) + (SELECT COUNT(*) FROM malacca_filings WHERE deleted_at IS NULL) + (SELECT COUNT(*) FROM cape_filings WHERE deleted_at IS NULL) AS total_filings_all,
        (SELECT COUNT(*) FROM filings WHERE status = 'submitted') AS submitted_filings,
        (SELECT COUNT(*) FROM filings WHERE created_at > NOW() - INTERVAL '7 days') AS new_filings_week,
        (SELECT COUNT(*) FROM purchase_requests) AS total_purchases,
        (SELECT COUNT(*) FROM purchase_requests WHERE created_at > NOW() - INTERVAL '7 days') AS new_purchases_week,
        (SELECT COUNT(*) FROM validations) AS total_validations,
        (SELECT COUNT(*) FROM leads) + (SELECT COUNT(*) FROM lead_funnel) AS total_leads,
        (SELECT COUNT(*) FROM leads WHERE created_at > NOW() - INTERVAL '7 days') + (SELECT COUNT(*) FROM lead_funnel WHERE created_at > NOW() - INTERVAL '7 days') AS new_leads_week,
        -- Per-waterway validation breakdowns
        (SELECT COUNT(*) FROM validations WHERE canal = 'panama') AS panama_validations_total,
        (SELECT COUNT(*) FROM validations WHERE canal = 'panama' AND overall_status = 'pass') AS panama_validations_pass,
        (SELECT COUNT(*) FROM validations WHERE canal = 'suez') AS suez_validations_total,
        (SELECT COUNT(*) FROM validations WHERE canal = 'suez' AND overall_status = 'pass') AS suez_validations_pass,
        (SELECT COUNT(*) FROM validations WHERE canal = 'bosporus') AS bosporus_validations_total,
        (SELECT COUNT(*) FROM validations WHERE canal = 'bosporus' AND overall_status = 'pass') AS bosporus_validations_pass,
        (SELECT COUNT(*) FROM validations WHERE canal = 'malacca') AS malacca_validations_total,
        (SELECT COUNT(*) FROM validations WHERE canal = 'malacca' AND overall_status = 'pass') AS malacca_validations_pass,
        (SELECT COUNT(*) FROM validations WHERE canal = 'cape') AS cape_validations_total,
        (SELECT COUNT(*) FROM validations WHERE canal = 'cape' AND overall_status = 'pass') AS cape_validations_pass,
        -- Per-waterway filing counts (Panama+Suez in filings table; others in dedicated tables)
        (SELECT COUNT(*) FROM filings WHERE canal = 'panama') AS panama_filings_total,
        (SELECT COUNT(*) FROM filings WHERE canal = 'panama' AND created_at > DATE_TRUNC('month', NOW())) AS panama_filings_month,
        (SELECT COUNT(*) FROM filings WHERE canal = 'suez') AS suez_filings_total,
        (SELECT COUNT(*) FROM filings WHERE canal = 'suez' AND created_at > DATE_TRUNC('month', NOW())) AS suez_filings_month,
        (SELECT COUNT(*) FROM filings WHERE canal = 'suez' AND created_at > NOW() - INTERVAL '7 days') AS suez_filings_week,
        (SELECT COUNT(*) FROM sp1_filings WHERE deleted_at IS NULL) AS bosporus_filings_total,
        (SELECT COUNT(*) FROM sp1_filings WHERE deleted_at IS NULL AND created_at > DATE_TRUNC('month', NOW())) AS bosporus_filings_month,
        (SELECT COUNT(*) FROM malacca_filings WHERE deleted_at IS NULL) AS malacca_filings_total,
        (SELECT COUNT(*) FROM malacca_filings WHERE deleted_at IS NULL AND created_at > DATE_TRUNC('month', NOW())) AS malacca_filings_month,
        (SELECT COUNT(*) FROM cape_filings WHERE deleted_at IS NULL) AS cape_filings_total,
        (SELECT COUNT(*) FROM cape_filings WHERE deleted_at IS NULL AND created_at > DATE_TRUNC('month', NOW())) AS cape_filings_month,
        -- Per-waterway lead attribution (leads table uses source, lead_funnel uses canal_selection)
        (SELECT COUNT(*) FROM leads WHERE source ILIKE '%panama%') + (SELECT COUNT(*) FROM lead_funnel WHERE canal_selection = 'panama') AS panama_leads,
        (SELECT COUNT(*) FROM leads WHERE source ILIKE '%suez%') + (SELECT COUNT(*) FROM lead_funnel WHERE canal_selection = 'suez') AS suez_leads,
        (SELECT COUNT(*) FROM leads WHERE source ILIKE '%bosporus%') + (SELECT COUNT(*) FROM lead_funnel WHERE canal_selection = 'bosporus') AS bosporus_leads,
        (SELECT COUNT(*) FROM leads WHERE source ILIKE '%malacca%') + (SELECT COUNT(*) FROM lead_funnel WHERE canal_selection = 'malacca') AS malacca_leads,
        (SELECT COUNT(*) FROM leads WHERE source ILIKE '%cape%') + (SELECT COUNT(*) FROM lead_funnel WHERE canal_selection = 'cape') AS cape_leads,
        -- Suez-specific operational data
        (SELECT COUNT(*) FROM suez_isps_notifications WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours') AS overdue_isps_count,
        (SELECT COUNT(*) FROM sca_submissions WHERE status = 'submitted') AS active_sca_submissions
    `);
  return result.rows[0];
}

/**
 * List admin users with filing stats (paginated, optional search).
 * @param {object} pool
 * @param {number} limit
 * @param {number} offset
 * @param {string|null} search
 * @returns {Promise<{rows: object[]}>}
 */
async function listAdminUsers(pool, limit, offset, search) {
  const baseWhere = search ? 'WHERE LOWER(u.email) LIKE LOWER($3) OR LOWER(u.name) LIKE LOWER($3)' : '';
  const params = search ? [limit, offset, search] : [limit, offset];

  return pool.query(`
      SELECT u.id, u.email, u.name, u.subscription_status, u.subscription_plan,
             u.subscription_expires_at, u.is_admin, u.created_at,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT f.canal), NULL) AS canals_used,
             COUNT(DISTINCT CASE WHEN f.canal = 'panama' THEN f.id END) AS panama_filings,
             COUNT(DISTINCT CASE WHEN f.canal = 'suez'   THEN f.id END) AS suez_filings
      FROM users u
      LEFT JOIN filings f ON f.user_id = u.id
      ${baseWhere}
      GROUP BY u.id, u.email, u.name, u.subscription_status, u.subscription_plan,
               u.subscription_expires_at, u.is_admin, u.created_at
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);
}

/**
 * Count total users (optionally filtered by search).
 * @param {object} pool
 * @param {string|null} search
 * @returns {Promise<{rows: object[]}>}
 */
async function countAdminUsers(pool, search) {
  const countWhere = search ? 'WHERE LOWER(email) LIKE LOWER($1) OR LOWER(name) LIKE LOWER($1)' : '';
  return pool.query(
    `SELECT COUNT(*) AS total FROM users ${countWhere}`,
    search ? [search] : []
  );
}

/**
 * List admin filings with validation + SCA submission data (paginated, optional filters).
 * @param {object} pool
 * @param {number} limit
 * @param {number} offset
 * @param {string|null} status
 * @param {string|null} canal
 * @returns {Promise<{rows: object[]}>}
 */
async function listAdminFilings(pool, limit, offset, status, canal) {
  const conditions = [];
  const params = [limit, offset];
  let p = 3;

  if (status) { conditions.push(`f.status = $${p++}`); params.push(status); }
  if (canal)  { conditions.push(`f.canal = $${p++}`); params.push(canal); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  return pool.query(`
      SELECT f.id, f.document_type, f.canal, f.status, f.vessel_name, f.imo_number,
             f.flag_state, f.vessel_type, f.reference_number, f.created_at, f.updated_at,
             u.email AS user_email, u.name AS user_name,
             v.overall_status AS validation_status,
             v.passed_checks, v.failed_checks, v.total_checks,
             (SELECT ARRAY_AGG(n.notification_type ORDER BY n.created_at)
              FROM suez_isps_notifications n
              WHERE n.filing_id = f.id AND n.status = 'sent') AS isps_stages_sent,
             (SELECT COUNT(*) FROM suez_isps_notifications n
              WHERE n.filing_id = f.id) AS isps_notification_count,
             ss.status AS sca_submission_status, ss.convoy_number, ss.sca_reference
      FROM filings f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN LATERAL (
        SELECT overall_status, passed_checks, failed_checks, total_checks
        FROM validations
        WHERE imo_number = f.imo_number AND canal = f.canal
        ORDER BY created_at DESC LIMIT 1
      ) v ON true
      LEFT JOIN LATERAL (
        SELECT status, convoy_number, sca_reference
        FROM sca_submissions
        WHERE filing_id = f.id
        ORDER BY submitted_at DESC LIMIT 1
      ) ss ON true
      ${where}
      ORDER BY f.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);
}

/**
 * Count admin filings (optional status/canal filters).
 * @param {object} pool
 * @param {string|null} status
 * @param {string|null} canal
 * @returns {Promise<{rows: object[]}>}
 */
async function countAdminFilings(pool, status, canal) {
  const cParams = [];
  let cp = 1;
  const cConds = [];
  if (status) { cConds.push(`status = $${cp++}`); cParams.push(status); }
  if (canal)  { cConds.push(`canal = $${cp++}`);  cParams.push(canal); }
  const cWhere = cConds.length ? 'WHERE ' + cConds.join(' AND ') : '';
  return pool.query(
    `SELECT COUNT(*) AS total FROM filings ${cWhere}`,
    cParams
  );
}

/**
 * Get Suez vs Panama filing breakdown + validation rates.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getSuezFilingBreakdown(pool) {
  return pool.query(`
        SELECT
          COUNT(CASE WHEN canal = 'suez' THEN 1 END)   AS suez_total,
          COUNT(CASE WHEN canal = 'panama' THEN 1 END) AS panama_total,
          COUNT(CASE WHEN canal = 'suez'   AND created_at > DATE_TRUNC('month', NOW()) THEN 1 END) AS suez_month,
          COUNT(CASE WHEN canal = 'panama' AND created_at > DATE_TRUNC('month', NOW()) THEN 1 END) AS panama_month,
          COUNT(CASE WHEN canal = 'suez'   AND created_at > NOW() - INTERVAL '7 days' THEN 1 END) AS suez_week,
          COUNT(CASE WHEN canal = 'suez' AND status = 'submitted' THEN 1 END) AS suez_submitted,
          COUNT(CASE WHEN canal = 'suez' AND status = 'draft'     THEN 1 END) AS suez_draft,
          COUNT(CASE WHEN canal = 'suez' AND status = 'approved'  THEN 1 END) AS suez_approved,
          COUNT(CASE WHEN canal = 'suez' AND status = 'rejected'  THEN 1 END) AS suez_rejected
        FROM filings
      `);
}

/**
 * Get most common Suez validation failures from checklist JSON.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getSuezCommonValidationErrors(pool) {
  return pool.query(`
        SELECT
          chk->>'rule_key'   AS rule_key,
          chk->>'check_name' AS check_name,
          COUNT(*)           AS fail_count
        FROM validations,
             jsonb_array_elements(checklist) AS chk
        WHERE canal = 'suez'
          AND (chk->>'status' = 'fail' OR chk->>'result' = 'fail')
        GROUP BY chk->>'rule_key', chk->>'check_name'
        ORDER BY fail_count DESC
        LIMIT 10
      `);
}

/**
 * Get SCA submissions summary stats.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getScaSubmissionsSummary(pool) {
  return pool.query(`
        SELECT
          COUNT(*)                             AS total_submissions,
          COUNT(CASE WHEN status = 'submitted' THEN 1 END) AS submitted_count,
          COUNT(DISTINCT user_id)              AS unique_users,
          COUNT(DISTINCT convoy_number)        AS unique_convoys
        FROM sca_submissions
      `);
}

/**
 * Count Suez validations that passed.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function countSuezValidationsPass(pool) {
  return pool.query(
    `SELECT COUNT(*) AS c FROM validations WHERE canal = 'suez' AND overall_status = 'pass'`
  );
}

/**
 * Count total Suez validations.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function countSuezValidationsTotal(pool) {
  return pool.query(
    `SELECT COUNT(*) AS c FROM validations WHERE canal = 'suez'`
  );
}

/**
 * Get Suez ISPS timeline — active filings with notification state.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getSuezIspsTimeline(pool) {
  return pool.query(`
      SELECT
        f.id, f.vessel_name, f.imo_number, f.status, f.reference_number, f.created_at,
        u.email AS user_email,
        -- Which ISPS stages have been sent
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT n.notification_type ORDER BY n.notification_type), NULL) AS stages_sent,
        COUNT(n.id) AS notif_count,
        MAX(n.created_at) AS last_notif_at,
        -- Latest ISPS notification status
        (SELECT ni.status FROM suez_isps_notifications ni
         WHERE ni.filing_id = f.id ORDER BY ni.created_at DESC LIMIT 1) AS latest_notif_status
      FROM filings f
      JOIN users u ON u.id = f.user_id
      LEFT JOIN suez_isps_notifications n ON n.filing_id = f.id
      WHERE f.canal = 'suez'
      GROUP BY f.id, f.vessel_name, f.imo_number, f.status, f.reference_number, f.created_at, u.email
      ORDER BY f.created_at DESC
      LIMIT 100
    `);
}

/**
 * Get overdue Suez ISPS notifications (pending > 24h).
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getSuezIspsOverdue(pool) {
  return pool.query(`
      SELECT
        n.id, n.vessel_name, n.imo_number, n.notification_type, n.status,
        n.created_at, n.filing_id,
        u.email AS user_email
      FROM suez_isps_notifications n
      JOIN filings f ON f.id = n.filing_id
      JOIN users u ON u.id = n.user_id
      WHERE n.status = 'pending'
        AND n.created_at < NOW() - INTERVAL '24 hours'
      ORDER BY n.created_at ASC
      LIMIT 50
    `);
}

/**
 * Get all SCA submissions with convoy info.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getScaConvoySubmissions(pool) {
  return pool.query(`
        SELECT
          ss.id, ss.vessel_name, ss.filing_type, ss.transit_direction,
          ss.convoy_number, ss.status, ss.sca_reference,
          ss.submitted_at, ss.notes,
          u.email AS user_email,
          f.reference_number AS filing_ref
        FROM sca_submissions ss
        JOIN users u ON u.id = ss.user_id
        LEFT JOIN filings f ON f.id = ss.filing_id
        ORDER BY ss.submitted_at DESC
        LIMIT 100
      `);
}

/**
 * Get SCA fee tier usage by vessel_category.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getScaFeeTierUsage(pool) {
  return pool.query(`
        SELECT vessel_category, COUNT(*) AS count
        FROM sca_submissions
        WHERE filing_type = 'transit_application'
        GROUP BY vessel_category
        ORDER BY count DESC
      `);
}

/**
 * Daily signups for the past 30 days.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function getSignupsChart(pool) {
  return pool.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS signups
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day
      ORDER BY day ASC
    `);
}

/**
 * List admin leads (union of leads + lead_funnel tables, paginated).
 * @param {object} pool
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{rows: object[]}>}
 */
async function listAdminLeads(pool, limit, offset) {
  return pool.query(
    `SELECT id, email, company_name, fleet_size, source, created_at, 'leads' AS origin
       FROM leads
       UNION ALL
       SELECT id, email, company AS company_name,
              fleet_size,
              COALESCE(source, 'demo_' || COALESCE(canal_selection, 'unknown')) AS source,
              created_at,
              'lead_funnel' AS origin
       FROM lead_funnel
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
}

/**
 * Count total leads across both leads + lead_funnel tables.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function countAdminLeads(pool) {
  return pool.query(
    `SELECT (SELECT COUNT(*) FROM leads) + (SELECT COUNT(*) FROM lead_funnel) AS total`
  );
}

module.exports = {
  getDashboardStats,
  listAdminUsers,
  countAdminUsers,
  listAdminFilings,
  countAdminFilings,
  getSuezFilingBreakdown,
  getSuezCommonValidationErrors,
  getScaSubmissionsSummary,
  countSuezValidationsPass,
  countSuezValidationsTotal,
  getSuezIspsTimeline,
  getSuezIspsOverdue,
  getScaConvoySubmissions,
  getScaFeeTierUsage,
  getSignupsChart,
  listAdminLeads,
  countAdminLeads,
};
