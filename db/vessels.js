/**
 * db/vessels.js — SQL query functions for vessels and vessel_certificates tables.
 *
 * Owns: vessel CRUD, certificate management, fleet dashboard queries.
 * Does NOT own: AIS position data (db/ais-positions.js), filing queries, or auth logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getFleetDashboard(pool, userId, clientId) {
  const clientClause = clientId ? 'AND v.client_id = $2' : '';
  const params = clientId ? [userId, clientId] : [userId];

  const result = await pool.query(`
    SELECT
      v.id, v.name, v.imo, v.flag, v.type, v.class_society, v.status,
      v.client_id, v.created_at,
      json_agg(
        json_build_object(
          'id',           vc.id,
          'cert_type',    vc.cert_type,
          'cert_number',  vc.cert_number,
          'issuing_body', vc.issuing_body,
          'expiry_date',  vc.expiry_date,
          'days_left',    EXTRACT(DAY FROM (vc.expiry_date::timestamptz - NOW()))::int
        ) ORDER BY vc.expiry_date ASC
      ) FILTER (WHERE vc.id IS NOT NULL) AS certificates_raw
    FROM vessels v
    LEFT JOIN vessel_certificates vc ON vc.vessel_id = v.id
    WHERE v.user_id = $1 AND v.status = 'active' ${clientClause}
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `, params);
  return result.rows;
}

async function checkClientOwnership(pool, clientId, userId) {
  const result = await pool.query(
    'SELECT id FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [clientId, userId]
  );
  return result.rows[0] || null;
}

async function assignVesselToClient(pool, vesselId, clientId, userId) {
  const result = await pool.query(
    'UPDATE vessels SET client_id = $1 WHERE id = $2 AND user_id = $3 RETURNING id',
    [clientId, vesselId, userId]
  );
  return result.rows[0] || null;
}

// ── Vessel CRUD ─────────────────────────────────────────────────────────────

async function listVesselsWithCertCount(pool, userId) {
  const result = await pool.query(
    `SELECT
       v.id,
       v.name,
       v.imo,
       v.flag,
       v.type,
       v.class_society,
       v.status,
       v.created_at,
       COUNT(vc.id)::int              AS cert_count,
       MIN(vc.expiry_date)            AS next_expiry
     FROM vessels v
     LEFT JOIN vessel_certificates vc ON vc.vessel_id = v.id
     WHERE v.user_id = $1 AND v.status = 'active'
     GROUP BY v.id
     ORDER BY v.created_at DESC`,
    [userId]
  );
  return result;
}

async function createVessel(pool, userId, { name, imo, flag, type, classSociety }) {
  const result = await pool.query(
    `INSERT INTO vessels (user_id, name, imo, flag, type, class_society, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING *`,
    [userId, name, imo || null, flag || null, type || null, classSociety || null]
  );
  return result;
}

async function checkVesselOwnership(pool, vesselId, userId) {
  const result = await pool.query('SELECT id FROM vessels WHERE id = $1 AND user_id = $2', [vesselId, userId]);
  return result;
}

async function updateVessel(pool, vesselId, userId, { name, imo, flag, type, classSociety }) {
  const result = await pool.query(
    `UPDATE vessels
     SET name = COALESCE($1, name),
         imo  = COALESCE($2, imo),
         flag = COALESCE($3, flag),
         type = COALESCE($4, type),
         class_society = COALESCE($5, class_society),
         updated_at = NOW()
     WHERE id = $6 AND user_id = $7
     RETURNING *`,
    [name || null, imo || null, flag || null, type || null, classSociety || null, vesselId, userId]
  );
  return result;
}

async function softDeleteVessel(pool, vesselId, userId) {
  const result = await pool.query(
    'UPDATE vessels SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
    ['deleted', vesselId, userId]
  );
  return result;
}

async function checkVesselOwnershipActive(pool, vesselId, userId) {
  const result = await pool.query(
    'SELECT id FROM vessels WHERE id = $1 AND user_id = $2 AND status != $3',
    [vesselId, userId, 'deleted']
  );
  return result;
}

// ── Certificate CRUD ────────────────────────────────────────────────────────

async function listVesselCertificates(pool, vesselId, userId) {
  const result = await pool.query(
    `SELECT
       id,
       cert_type,
       cert_number,
       issued_date,
       expiry_date,
       issuing_body,
       notes,
       created_at,
       EXTRACT(DAY FROM (expiry_date::timestamptz - NOW()))::int AS days_until_expiry
     FROM vessel_certificates
     WHERE vessel_id = $1 AND user_id = $2
     ORDER BY expiry_date ASC`,
    [vesselId, userId]
  );
  return result;
}

async function addVesselCertificate(pool, vesselId, userId, { certType, certNumber, issuedDate, expiryDate, issuingBody, notes }) {
  const result = await pool.query(
    `INSERT INTO vessel_certificates
       (vessel_id, user_id, cert_type, cert_number, issued_date, expiry_date, issuing_body, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [vesselId, userId, certType, certNumber || null, issuedDate || null, expiryDate, issuingBody || null, notes || null]
  );
  return result;
}

async function deleteVesselCertificate(pool, certId, vesselId, userId) {
  const result = await pool.query(
    'DELETE FROM vessel_certificates WHERE id = $1 AND vessel_id = $2 AND user_id = $3',
    [certId, vesselId, userId]
  );
  return result;
}

// ── Fleet Summary ───────────────────────────────────────────────────────────

async function getDistinctFilingVessels(pool, userId) {
  const result = await pool.query(
    `SELECT imo_number,
            MAX(vessel_name)  AS vessel_name,
            MAX(vessel_type)  AS vessel_type,
            MAX(flag_state)   AS flag_state,
            MAX(created_at)   AS last_filing_at
     FROM filings
     WHERE user_id = $1 AND imo_number IS NOT NULL AND imo_number <> ''
     GROUP BY imo_number
     ORDER BY MAX(created_at) DESC`,
    [userId]
  );
  return result;
}

// ── Notifications ───────────────────────────────────────────────────────────

async function getRecentNotifications(pool, userId) {
  const result = await pool.query(
    `SELECT id, alert_category, subject, sent_at, metadata
     FROM alert_history
     WHERE user_id = $1
     ORDER BY sent_at DESC
     LIMIT 10`,
    [userId]
  );
  return result;
}

// ── Admin Alert Deliveries ──────────────────────────────────────────────────

async function getAdminAlertDeliveries(pool, limit) {
  const result = await pool.query(
    `SELECT
       ah.id,
       ah.alert_category,
       ah.recipient_email,
       ah.subject,
       ah.sent_at,
       ah.metadata,
       u.email AS user_email,
       u.name  AS user_name
     FROM alert_history ah
     JOIN users u ON u.id = ah.user_id
     ORDER BY ah.sent_at DESC
     LIMIT $1`,
    [limit]
  );
  return result;
}

module.exports = {
  getFleetDashboard,
  checkClientOwnership,
  assignVesselToClient,
  listVesselsWithCertCount,
  createVessel,
  checkVesselOwnership,
  updateVessel,
  softDeleteVessel,
  checkVesselOwnershipActive,
  listVesselCertificates,
  addVesselCertificate,
  deleteVesselCertificate,
  getDistinctFilingVessels,
  getRecentNotifications,
  getAdminAlertDeliveries,
};
