/**
 * db/alert-history.js — SQL query functions for alert_history table.
 *
 * Owns: deduplication checks and inserts for filing, certificate, and digest alerts.
 * Does NOT own: alert logic, email sending, or certificate expiry rules.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function checkAlertSent(pool, alertKey, recipientEmail) {
  const result = await pool.query(
    'SELECT id FROM alert_history WHERE alert_key = $1 AND recipient_email = $2',
    [alertKey, recipientEmail]
  );
  return result.rows.length > 0;
}

async function insertAlert(pool, { user_id, alert_key, alert_category, recipient_email, subject, metadata }) {
  return pool.query(
    `INSERT INTO alert_history (user_id, alert_key, alert_category, recipient_email, subject, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (alert_key, recipient_email) DO NOTHING`,
    [user_id, alert_key, alert_category, recipient_email, subject, metadata ? JSON.stringify(metadata) : null]
  );
}

async function getRecentFilingStatusChanges(pool) {
  const result = await pool.query(`
    SELECT f.id, f.user_id, f.document_type, f.status, f.vessel_name, f.imo_number,
           f.reference_number, f.updated_at,
           u.email AS user_email, u.name AS user_name,
           ap.enabled, ap.filing_alerts, ap.additional_emails
    FROM filings f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN alert_preferences ap ON ap.user_id = f.user_id
    WHERE f.document_type = 'vumpa_pre_arrival'
      AND f.status IN ('submitted', 'approved', 'rejected', 'needs_revision')
      AND f.updated_at >= NOW() - INTERVAL '25 hours'
      AND (ap.enabled IS NULL OR ap.enabled = TRUE)
      AND (ap.filing_alerts IS NULL OR ap.filing_alerts = TRUE)
    ORDER BY f.updated_at DESC
  `);
  return result.rows;
}

async function getCertificatesNearExpiry(pool) {
  const result = await pool.query(`
    SELECT vc.id AS cert_id, vc.cert_type, vc.cert_number, vc.expiry_date, vc.issuing_body,
           v.id AS vessel_id, v.name AS vessel_name, v.imo AS vessel_imo, v.flag AS vessel_flag,
           u.id AS user_id, u.email AS user_email, u.name AS user_name,
           ap.enabled, ap.cert_alerts, ap.lead_times, ap.additional_emails, ap.frequency
    FROM vessel_certificates vc
    JOIN vessels v ON v.id = vc.vessel_id
    JOIN users u ON u.id = vc.user_id
    LEFT JOIN alert_preferences ap ON ap.user_id = vc.user_id
    WHERE vc.expiry_date >= NOW() - INTERVAL '1 day'
      AND v.status = 'active'
      AND (ap.enabled IS NULL OR ap.enabled = TRUE)
      AND (ap.cert_alerts IS NULL OR ap.cert_alerts = TRUE)
    ORDER BY vc.expiry_date ASC
  `);
  return result.rows;
}

async function getDailyDigestCerts(pool) {
  const result = await pool.query(`
    SELECT vc.id AS cert_id, vc.cert_type, vc.cert_number, vc.expiry_date, vc.issuing_body,
           v.name AS vessel_name, v.imo AS vessel_imo, v.flag AS vessel_flag,
           u.id AS user_id, u.email AS user_email, u.name AS user_name,
           ap.enabled, ap.cert_alerts, ap.additional_emails, ap.frequency
    FROM vessel_certificates vc
    JOIN vessels v ON v.id = vc.vessel_id
    JOIN users u ON u.id = vc.user_id
    LEFT JOIN alert_preferences ap ON ap.user_id = vc.user_id
    WHERE vc.expiry_date <= NOW() + INTERVAL '90 days'
      AND v.status = 'active'
      AND (ap.enabled IS NULL OR ap.enabled = TRUE)
      AND (ap.cert_alerts IS NULL OR ap.cert_alerts = TRUE)
      AND (ap.frequency = 'daily')
    ORDER BY u.id, vc.expiry_date ASC
  `);
  return result.rows;
}

async function getPendingIspsNotifications(pool) {
  const result = await pool.query(`
    SELECT n.id, n.user_id, n.filing_id, n.vessel_name, n.imo_number,
           n.notification_type, n.status, n.sent_at,
           n.deadline_72h, n.deadline_48h, n.deadline_24h,
           n.alert_6h_sent, n.alert_overdue_sent,
           u.email AS user_email, u.name AS user_name,
           f.reference_number AS filing_reference
    FROM suez_isps_notifications n
    JOIN users u ON u.id = n.user_id
    JOIN filings f ON f.id = n.filing_id
    WHERE n.sent_at IS NULL AND n.status NOT IN ('sent', 'confirmed')
      AND (n.deadline_72h IS NOT NULL OR n.deadline_48h IS NOT NULL OR n.deadline_24h IS NOT NULL)
    ORDER BY n.filing_id, n.notification_type
  `);
  return result.rows;
}

async function markIspsAlert6hSent(pool, id) {
  return pool.query(
    'UPDATE suez_isps_notifications SET alert_6h_sent = TRUE, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

async function markIspsAlertOverdueSent(pool, id) {
  return pool.query(
    'UPDATE suez_isps_notifications SET alert_overdue_sent = TRUE, updated_at = NOW() WHERE id = $1',
    [id]
  );
}

async function listAlertHistory(pool, userId, { limit = 50, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, alert_key, alert_category, recipient_email, subject, sent_at, metadata
     FROM alert_history WHERE user_id = $1
     ORDER BY sent_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

module.exports = {
  checkAlertSent,
  insertAlert,
  getRecentFilingStatusChanges,
  getCertificatesNearExpiry,
  getDailyDigestCerts,
  getPendingIspsNotifications,
  markIspsAlert6hSent,
  markIspsAlertOverdueSent,
  listAlertHistory,
};
