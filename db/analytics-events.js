/**
 * db/analytics-events.js — SQL query functions for analytics_events and validation recording.
 *
 * Owns: validation recording for demo endpoints, record-validation telemetry.
 * Does NOT own: validation logic (services/*-validator.js), filing CRUD, or admin stats.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function recordSuezDemoValidation(pool, data) {
  const {
    vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
    cargo_type, has_dangerous_goods,
    overall_status, total_checks, passed_checks, failed_checks, warning_checks,
  } = data;
  return pool.query(
    `INSERT INTO validations
       (vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
        cargo_type, has_dangerous_goods,
        overall_status, total_checks, passed_checks, failed_checks, warning_checks, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'suez')`,
    [
      vessel_name || null,
      imo_number || null,
      flag_state || null,
      vessel_type || null,
      gross_tonnage ? parseInt(gross_tonnage) : null,
      cargo_type || null,
      has_dangerous_goods,
      overall_status || 'unknown',
      total_checks || 0,
      passed_checks || 0,
      failed_checks || 0,
      warning_checks || 0,
    ]
  );
}

async function recordPanamaDemoValidation(pool, data) {
  const {
    vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
    cargo_type, has_dangerous_goods, transit_direction,
    overall_status, total_checks, passed_checks, failed_checks, warning_checks,
  } = data;
  return pool.query(
    `INSERT INTO validations
       (vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
        cargo_type, has_dangerous_goods, transit_direction,
        overall_status, total_checks, passed_checks, failed_checks, warning_checks, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'panama')`,
    [
      vessel_name || null,
      imo_number || null,
      flag_state || null,
      vessel_type || null,
      gross_tonnage ? parseInt(gross_tonnage) : null,
      cargo_type || null,
      !!has_dangerous_goods,
      transit_direction || null,
      overall_status || 'unknown',
      total_checks || 0,
      passed_checks || 0,
      failed_checks || 0,
      warning_checks || 0,
    ]
  );
}

async function recordGenericDemoValidation(pool, data) {
  const {
    vessel_name, imo_number, overall_status,
    total_checks, passed_checks, failed_checks, warning_checks, canal,
  } = data;
  return pool.query(
    `INSERT INTO validations
       (vessel_name, imo_number, overall_status,
        total_checks, passed_checks, failed_checks, warning_checks, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      vessel_name || null,
      imo_number || null,
      overall_status || 'unknown',
      total_checks != null ? parseInt(total_checks) : 0,
      passed_checks != null ? parseInt(passed_checks) : 0,
      failed_checks != null ? parseInt(failed_checks) : 0,
      warning_checks != null ? parseInt(warning_checks) : 0,
      canal,
    ]
  );
}

/**
 * Insert an analytics event (fire-and-forget — caller uses .catch()).
 */
async function insertAnalyticsEvent(pool, {
  event_type, page, properties, ipHash, ua, userId, sessionId,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term, botFlagged,
}) {
  return pool.query(
    `INSERT INTO analytics_events
       (event_type, page_path, properties, ip_hash, user_agent, user_id, session_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, bot_flagged)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      String(event_type).slice(0, 100),
      page ? String(page).slice(0, 500) : null,
      properties ? JSON.stringify(properties) : null,
      ipHash,
      ua ? ua.slice(0, 500) : null,
      userId,
      sessionId,
      utm_source || null,
      utm_medium || null,
      utm_campaign || null,
      utm_content || null,
      utm_term || null,
      botFlagged,
    ]
  );
}

module.exports = {
  recordSuezDemoValidation,
  recordPanamaDemoValidation,
  recordGenericDemoValidation,
  insertAnalyticsEvent,
};
