/**
 * db/fleet-compliance.js — SQL query functions for fleet compliance dashboard.
 *
 * Owns: fleet-wide compliance summary, per-vessel compliance detail (certs + filings + ACP).
 * Does NOT own: vessel CRUD (db/vessels.js), filing CRUD (db/filings.js), or validation logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getVesselsWithCertSummary(pool, userId) {
  const { rows } = await pool.query(`
    SELECT
      v.id,
      v.name,
      v.imo,
      v.flag,
      v.type,
      v.created_at,
      COUNT(vc.id)::int                                                                         AS cert_count,
      COUNT(CASE WHEN vc.expiry_date < NOW()                                            THEN 1 END)::int AS certs_expired,
      COUNT(CASE WHEN vc.expiry_date >= NOW() AND vc.expiry_date < NOW() + INTERVAL '7 days'   THEN 1 END)::int AS certs_expiring_7d,
      COUNT(CASE WHEN vc.expiry_date >= NOW() + INTERVAL '7 days' AND vc.expiry_date < NOW() + INTERVAL '30 days' THEN 1 END)::int AS certs_expiring_30d,
      MIN(vc.expiry_date) AS next_expiry
    FROM vessels v
    LEFT JOIN vessel_certificates vc ON vc.vessel_id = v.id
    WHERE v.user_id = $1 AND v.status = 'active'
    GROUP BY v.id
    ORDER BY v.created_at DESC
  `, [userId]);
  return rows;
}

async function getFilingSummaryByVessel(pool, userId) {
  const { rows } = await pool.query(`
    SELECT
      LOWER(vessel_name) AS vname,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected,
      COUNT(CASE WHEN status = 'submitted' THEN 1 END)::int AS submitted,
      COUNT(CASE WHEN status = 'approved'  THEN 1 END)::int AS approved,
      MAX(created_at) AS last_filing_at
    FROM filings
    WHERE user_id = $1
    GROUP BY LOWER(vessel_name)
  `, [userId]);
  return rows;
}

async function getAcpSummaryByVessel(pool, userId) {
  const { rows } = await pool.query(`
    SELECT
      LOWER(vessel_name) AS vname,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status = 'rejected' THEN 1 END)::int AS rejected,
      COUNT(CASE WHEN status = 'submitted' THEN 1 END)::int AS submitted,
      COUNT(CASE WHEN status = 'approved'  THEN 1 END)::int AS approved,
      MAX(submitted_at) AS last_acp_at
    FROM acp_submissions
    WHERE user_id = $1
    GROUP BY LOWER(vessel_name)
  `, [userId]);
  return rows;
}

async function getVesselByIdAndUser(pool, vesselId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM vessels WHERE id = $1 AND user_id = $2 AND status = $3',
    [vesselId, userId, 'active']
  );
  return rows;
}

async function getVesselCertificates(pool, vesselId, userId) {
  const { rows } = await pool.query(`
    SELECT *, EXTRACT(DAY FROM (expiry_date::timestamptz - NOW()))::int AS days_until_expiry
    FROM vessel_certificates
    WHERE vessel_id = $1 AND user_id = $2
    ORDER BY expiry_date ASC
  `, [vesselId, userId]);
  return rows;
}

async function getFilingsByVesselName(pool, userId, vesselName) {
  const { rows } = await pool.query(`
    SELECT id, document_type, status, reference_number, notes, submitted_at, created_at, updated_at
    FROM filings
    WHERE user_id = $1 AND LOWER(vessel_name) = LOWER($2)
    ORDER BY created_at DESC
    LIMIT 25
  `, [userId, vesselName]);
  return rows;
}

async function getAcpByVesselName(pool, userId, vesselName) {
  const { rows } = await pool.query(`
    SELECT id, filing_type, status, submitted_at, created_at, updated_at
    FROM acp_submissions
    WHERE user_id = $1 AND LOWER(vessel_name) = LOWER($2)
    ORDER BY COALESCE(submitted_at, created_at) DESC
    LIMIT 25
  `, [userId, vesselName]);
  return rows;
}

module.exports = {
  getVesselsWithCertSummary,
  getFilingSummaryByVessel,
  getAcpSummaryByVessel,
  getVesselByIdAndUser,
  getVesselCertificates,
  getFilingsByVesselName,
  getAcpByVesselName,
};
