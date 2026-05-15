/**
 * db/certificates.js — SQL query functions for vessel certificates, ISS, and ISPS queries.
 *
 * Owns: Suez ISPS notification CRUD (suez_isps_notifications table), notification timeline,
 *       overdue notification queries, ETA deadline management, notification templates.
 * Does NOT own: admin ISPS timeline (db/suez-analytics.js), filing CRUD (db/filings.js),
 *               vessel CRUD (db/vessels.js), or approval workflow (db/approval-workflow.js).
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getOverdueNotificationsAdmin(pool, now) {
  const result = await pool.query(`
    SELECT n.*, u.email AS user_email,
           f.reference_number AS filing_reference, f.canal
    FROM suez_isps_notifications n
    JOIN users u ON u.id = n.user_id
    JOIN filings f ON f.id = n.filing_id
    WHERE n.sent_at IS NULL
      AND n.status != 'sent'
      AND (
        (n.notification_type = '72h' AND n.deadline_72h IS NOT NULL AND n.deadline_72h < $1)
        OR (n.notification_type = '48h' AND n.deadline_48h IS NOT NULL AND n.deadline_48h < $1)
        OR (n.notification_type = '24h' AND n.deadline_24h IS NOT NULL AND n.deadline_24h < $1)
      )
    ORDER BY n.filing_id, n.notification_type
  `, [now]);
  return result;
}

async function getOverdueNotificationsUser(pool, userId, now) {
  const result = await pool.query(`
    SELECT n.*, f.reference_number AS filing_reference, f.canal
    FROM suez_isps_notifications n
    JOIN filings f ON f.id = n.filing_id
    WHERE n.user_id = $1
      AND n.sent_at IS NULL
      AND n.status != 'sent'
      AND (
        (n.notification_type = '72h' AND n.deadline_72h IS NOT NULL AND n.deadline_72h < $2)
        OR (n.notification_type = '48h' AND n.deadline_48h IS NOT NULL AND n.deadline_48h < $2)
        OR (n.notification_type = '24h' AND n.deadline_24h IS NOT NULL AND n.deadline_24h < $2)
      )
    ORDER BY n.filing_id, n.notification_type
  `, [userId, now]);
  return result;
}

async function getFilingBasicById(pool, filingId) {
  const result = await pool.query(
    'SELECT id, vessel_name, imo_number, canal, reference_number FROM filings WHERE id = $1',
    [filingId]
  );
  return result;
}

async function checkFilingOwnership(pool, filingId, userId) {
  const result = await pool.query(
    'SELECT id FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return result;
}

async function updateIspsDeadlines(pool, eta, deadline72h, deadline48h, deadline24h, filingId, userId) {
  return pool.query(`
    UPDATE suez_isps_notifications
    SET eta_arrival = $1, deadline_72h = $2, deadline_48h = $3, deadline_24h = $4, updated_at = NOW()
    WHERE filing_id = $5 AND user_id = $6
  `, [eta, deadline72h, deadline48h, deadline24h, filingId, userId]);
}

async function getNotificationsByFiling(pool, filingId) {
  const result = await pool.query(
    `SELECT * FROM suez_isps_notifications
     WHERE filing_id = $1
     ORDER BY CASE notification_type WHEN '72h' THEN 1 WHEN '48h' THEN 2 WHEN '24h' THEN 3 ELSE 4 END`,
    [filingId]
  );
  return result;
}

async function getFilingForNotification(pool, filingId, userId) {
  const result = await pool.query(
    'SELECT id, vessel_name, imo_number FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return result;
}

async function getExistingNotification(pool, filingId, userId, stage) {
  const result = await pool.query(
    'SELECT * FROM suez_isps_notifications WHERE filing_id = $1 AND user_id = $2 AND notification_type = $3',
    [filingId, userId, stage]
  );
  return result;
}

async function updateNotification(pool, params) {
  const {
    vesselSecurityLevel, isscNumber, isscExpiry, isscIssuer,
    last10Ports, specialMeasures, threatReported, scaReference,
    contentData, sentAt, acknowledgedAt, status,
    etaArrival, deadline72h, deadline48h, deadline24h, id,
  } = params;
  const result = await pool.query(`
    UPDATE suez_isps_notifications SET
      vessel_security_level = $1,
      issc_number   = COALESCE($2, issc_number),
      issc_expiry   = COALESCE($3::date, issc_expiry),
      issc_issuer   = COALESCE($4, issc_issuer),
      last_10_ports = $5,
      special_measures = COALESCE($6, special_measures),
      threat_reported  = $7,
      sca_reference = COALESCE($8, sca_reference),
      content_data  = $9,
      sent_at       = $10,
      acknowledged_at = $11,
      status        = $12,
      eta_arrival   = COALESCE($13, eta_arrival),
      deadline_72h  = COALESCE($14, deadline_72h),
      deadline_48h  = COALESCE($15, deadline_48h),
      deadline_24h  = COALESCE($16, deadline_24h),
      updated_at    = NOW()
    WHERE id = $17
    RETURNING *
  `, [
    vesselSecurityLevel,
    isscNumber, isscExpiry, isscIssuer,
    last10Ports,
    specialMeasures, threatReported, scaReference,
    contentData,
    sentAt, acknowledgedAt, status,
    etaArrival,
    deadline72h, deadline48h, deadline24h,
    id,
  ]);
  return result;
}

async function insertNotification(pool, params) {
  const {
    userId, filingId, vesselName, imoNumber,
    stage, vesselSecurityLevel,
    isscNumber, isscExpiry, isscIssuer,
    last10Ports, specialMeasures, threatReported,
    scaReference, status, contentData,
    sentAt, acknowledgedAt,
    etaArrival, deadline72h, deadline48h, deadline24h,
  } = params;
  const result = await pool.query(`
    INSERT INTO suez_isps_notifications (
      user_id, filing_id, vessel_name, imo_number,
      notification_type, vessel_security_level,
      issc_number, issc_expiry, issc_issuer,
      last_10_ports, special_measures, threat_reported,
      sca_reference, status, content_data,
      sent_at, acknowledged_at,
      eta_arrival, deadline_72h, deadline_48h, deadline_24h,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6,
      $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15,
      $16, $17,
      $18, $19, $20, $21,
      NOW(), NOW()
    ) RETURNING *
  `, [
    userId, filingId, vesselName, imoNumber,
    stage, vesselSecurityLevel,
    isscNumber, isscExpiry || null, isscIssuer,
    last10Ports, specialMeasures, threatReported,
    scaReference, status, contentData,
    sentAt, acknowledgedAt,
    etaArrival,
    deadline72h, deadline48h, deadline24h,
  ]);
  return result;
}

async function updateSiblingDeadlines(pool, etaArrival, deadline72h, deadline48h, deadline24h, filingId, userId, excludeStage) {
  return pool.query(`
    UPDATE suez_isps_notifications
    SET eta_arrival = $1, deadline_72h = $2, deadline_48h = $3, deadline_24h = $4, updated_at = NOW()
    WHERE filing_id = $5 AND user_id = $6 AND notification_type != $7
  `, [etaArrival, deadline72h, deadline48h, deadline24h, filingId, userId, excludeStage]);
}

async function getFilingForTemplate(pool, filingId, userId) {
  const result = await pool.query(
    'SELECT id, vessel_name, imo_number, gross_tonnage, draft_forward, draft_aft, document_data FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return result;
}

async function getUserIspsFilings(pool, userId) {
  const result = await pool.query(`
    SELECT
      f.id, f.vessel_name, f.imo_number, f.reference_number,
      f.created_at, f.status,
      (SELECT COUNT(*) FROM suez_isps_notifications n WHERE n.filing_id = f.id) AS notif_count,
      (SELECT COUNT(*) FROM suez_isps_notifications n WHERE n.filing_id = f.id AND n.status IN ('sent','confirmed')) AS notif_sent_count,
      (SELECT n.eta_arrival FROM suez_isps_notifications n WHERE n.filing_id = f.id AND n.eta_arrival IS NOT NULL LIMIT 1) AS eta_arrival
    FROM filings f
    WHERE f.user_id = $1 AND f.canal = 'suez'
    ORDER BY f.created_at DESC
    LIMIT 50
  `, [userId]);
  return result;
}

module.exports = {
  getOverdueNotificationsAdmin,
  getOverdueNotificationsUser,
  getFilingBasicById,
  checkFilingOwnership,
  updateIspsDeadlines,
  getNotificationsByFiling,
  getFilingForNotification,
  getExistingNotification,
  updateNotification,
  insertNotification,
  updateSiblingDeadlines,
  getFilingForTemplate,
  getUserIspsFilings,
};
