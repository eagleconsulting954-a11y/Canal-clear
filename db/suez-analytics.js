/**
 * db/suez-analytics.js — SQL query functions for Suez canal analytics, convoy, and fee audit.
 *
 * Owns: admin Suez stats, ISPS timeline (admin), overdue alerts (admin), convoy status,
 *       fee audit, fee tier lookup, user Suez filing lists, convoy booking CRUD.
 * Does NOT own: ISPS notification lifecycle (db/certificates.js), filing CRUD (db/filings.js),
 *               validation logic, or PDF generation.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getFilingAnalyticsCounts(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(CASE WHEN canal = 'suez'   THEN 1 END) AS suez_total,
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
  return result;
}

async function getTopValidationErrors(pool) {
  const result = await pool.query(`
    SELECT
      chk->>'rule_key'   AS rule_key,
      chk->>'check_name' AS check_name,
      COUNT(*) AS fail_count
    FROM validations,
         jsonb_array_elements(checklist) AS chk
    WHERE canal = 'suez'
      AND (chk->>'status' = 'fail' OR chk->>'result' = 'fail')
    GROUP BY chk->>'rule_key', chk->>'check_name'
    ORDER BY fail_count DESC
    LIMIT 10
  `);
  return result;
}

async function getScaSubmissionStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*)                             AS total_submissions,
      COUNT(CASE WHEN status = 'submitted' THEN 1 END) AS submitted_count,
      COUNT(DISTINCT user_id)              AS unique_users,
      COUNT(DISTINCT convoy_number)        AS unique_convoys
    FROM sca_submissions
  `);
  return result;
}

async function getSuezValidationPassCount(pool) {
  const result = await pool.query(
    `SELECT COUNT(*) AS c FROM validations WHERE canal = 'suez' AND overall_status = 'pass'`
  );
  return parseInt(result.rows[0].c) || 0;
}

async function getSuezValidationTotalCount(pool) {
  const result = await pool.query(
    `SELECT COUNT(*) AS c FROM validations WHERE canal = 'suez'`
  );
  return parseInt(result.rows[0].c) || 0;
}

async function getAdminIspsTimeline(pool) {
  const result = await pool.query(`
    SELECT
      f.id, f.vessel_name, f.imo_number, f.status, f.reference_number, f.created_at,
      u.email AS user_email,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT n.notification_type ORDER BY n.notification_type), NULL) AS stages_sent,
      COUNT(n.id) AS notif_count,
      MAX(n.created_at) AS last_notif_at,
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
  return result;
}

async function getAdminOverdueAlerts(pool) {
  const result = await pool.query(`
    SELECT
      n.id, n.notification_type, n.status, n.vessel_name, n.imo_number,
      n.created_at, n.filing_id,
      u.email AS user_email
    FROM suez_isps_notifications n
    JOIN filings f ON f.id = n.filing_id
    JOIN users u ON u.id = n.user_id
    WHERE n.status = 'pending'
      AND n.created_at < NOW() - INTERVAL '24 hours'
    ORDER BY n.created_at ASC
  `);
  return result;
}

async function getConvoyStatus(pool) {
  const result = await pool.query(`
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
    LIMIT 200
  `);
  return result;
}

async function getFeeAudit(pool) {
  const result = await pool.query(`
    SELECT
      ss.id, ss.vessel_name, ss.transit_direction, ss.status,
      ss.submitted_at AS calculated_at,
      u.email AS user_email,
      f.scnt, f.vessel_type,
      NULL::numeric AS total_usd,
      NULL::text AS rebate_applied
    FROM sca_submissions ss
    JOIN users u ON u.id = ss.user_id
    LEFT JOIN filings f ON f.id = ss.filing_id
    ORDER BY ss.submitted_at DESC
    LIMIT 100
  `);
  return result;
}

async function getUserSuezFilings(pool, userId) {
  const result = await pool.query(
    `SELECT id, vessel_name, imo_number, vessel_type, reference_number, status
     FROM filings
     WHERE user_id = $1 AND canal = 'suez'
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return result;
}

async function getFilingVesselInfo(pool, filingId, userId) {
  const result = await pool.query(
    `SELECT vessel_name, reference_number FROM filings WHERE id = $1 AND user_id = $2`,
    [filingId, userId]
  );
  return result;
}

async function insertConvoyBooking(pool, params) {
  const {
    userId, filingId, vesselName, transitDirection, convoyNumber,
    scaReference, notes, requestedTransitDate, priorityClass,
    agentName, agentPhone, agentEmail, specialRequirements,
  } = params;
  const result = await pool.query(
    `INSERT INTO sca_submissions (
      user_id, filing_id, vessel_name, filing_type,
      transit_direction, convoy_number, status, sca_reference, notes,
      requested_transit_date, priority_class, agent_name, agent_phone, agent_email,
      special_requirements
    ) VALUES ($1,$2,$3,'convoy_booking',$4,$5,'submitted',$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING id, status, submitted_at`,
    [
      userId,
      filingId || null,
      vesselName,
      transitDirection,
      convoyNumber || null,
      scaReference || null,
      notes || null,
      requestedTransitDate || null,
      priorityClass,
      agentName,
      agentPhone || null,
      agentEmail || null,
      specialRequirements && specialRequirements.length > 0 ? specialRequirements : null,
    ]
  );
  return result;
}

async function getUserConvoyBookings(pool, userId) {
  const result = await pool.query(
    `SELECT
       ss.id, ss.vessel_name, ss.transit_direction, ss.convoy_number,
       ss.status, ss.sca_reference, ss.notes, ss.submitted_at,
       ss.requested_transit_date, ss.priority_class,
       ss.agent_name, ss.agent_phone, ss.agent_email,
       ss.special_requirements,
       f.imo_number,
       f.reference_number AS filing_reference
     FROM sca_submissions ss
     LEFT JOIN filings f ON f.id = ss.filing_id
     WHERE ss.user_id = $1 AND ss.filing_type = 'convoy_booking'
     ORDER BY ss.submitted_at DESC
     LIMIT 100`,
    [userId]
  );
  return result;
}

async function lookupFeeTier(pool, vesselType, scnt) {
  const result = await pool.query(`
    SELECT base_rate_sdr, minimum_toll_sdr
    FROM suez_fee_tiers
    WHERE vessel_category = $1
      AND active = TRUE
      AND tariff_version = '2024'
      AND scnt_min <= $2
      AND (scnt_max IS NULL OR scnt_max >= $2)
    ORDER BY scnt_min DESC
    LIMIT 1
  `, [vesselType, scnt]);
  return result;
}

module.exports = {
  getFilingAnalyticsCounts,
  getTopValidationErrors,
  getScaSubmissionStats,
  getSuezValidationPassCount,
  getSuezValidationTotalCount,
  getAdminIspsTimeline,
  getAdminOverdueAlerts,
  getConvoyStatus,
  getFeeAudit,
  getUserSuezFilings,
  getFilingVesselInfo,
  insertConvoyBooking,
  getUserConvoyBookings,
  lookupFeeTier,
};
