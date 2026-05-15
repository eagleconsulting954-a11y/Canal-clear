/**
 * db/alert-preferences.js — SQL query functions for alert_preferences table.
 *
 * Owns: user alert preference reads, upserts.
 * Does NOT own: alert delivery logic, email sending, or certificate expiry rules.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getAlertPreferences(pool, userId) {
  const result = await pool.query(
    'SELECT * FROM alert_preferences WHERE user_id = $1',
    [userId]
  );
  return result;
}

async function upsertAlertPreferences(pool, userId, { enabled, certAlerts, filingAlerts, regulatoryAlerts, leadTimes, additionalEmails, frequency }) {
  return pool.query(
    `INSERT INTO alert_preferences
       (user_id, enabled, cert_alerts, filing_alerts, regulatory_alerts, lead_times, additional_emails, frequency, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       enabled            = EXCLUDED.enabled,
       cert_alerts        = EXCLUDED.cert_alerts,
       filing_alerts      = EXCLUDED.filing_alerts,
       regulatory_alerts  = EXCLUDED.regulatory_alerts,
       lead_times         = EXCLUDED.lead_times,
       additional_emails  = EXCLUDED.additional_emails,
       frequency          = EXCLUDED.frequency,
       updated_at         = NOW()`,
    [userId, enabled, certAlerts, filingAlerts, regulatoryAlerts,
     JSON.stringify(leadTimes), additionalEmails, frequency]
  );
}

module.exports = {
  getAlertPreferences,
  upsertAlertPreferences,
};
