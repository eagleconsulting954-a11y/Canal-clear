/**
 * db/notifications.js — SQL query functions for filing workflow notifications and support queries.
 *
 * Owns: filing lookups for PDF generation and export, ISPS notification supplementary queries,
 *       SCA submission lookups, lead funnel inserts.
 * Does NOT own: filing CRUD (db/filings.js), approval workflow (db/approval-workflow.js),
 *               ISPS notification lifecycle (db/certificates.js), or user CRUD (db/users.js).
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function getFilingForPdf(pool, filingId, userId) {
  const { rows } = await pool.query(
    `SELECT f.*,
            f.canal,
            f.scnt,
            f.air_draft,
            f.draft_forward,
            f.draft_aft
     FROM filings f
     WHERE f.id = $1 AND f.user_id = $2`,
    [filingId, userId]
  );
  return rows;
}

async function getIspsNotificationsByFiling(pool, filingId) {
  const result = await pool.query(
    `SELECT * FROM suez_isps_notifications
     WHERE filing_id = $1
     ORDER BY notification_type ASC`,
    [filingId]
  );
  return result.rows;
}

async function getScaSubmissionByFiling(pool, filingId) {
  const result = await pool.query(
    `SELECT convoy_number, transit_direction, sca_reference
     FROM sca_submissions
     WHERE filing_id = $1
     ORDER BY submitted_at DESC LIMIT 1`,
    [filingId]
  );
  return result.rows[0] || null;
}

async function getFilingBasicForPdfTypes(pool, filingId, userId) {
  const { rows } = await pool.query(
    'SELECT id, document_type, status, canal, reference_number, vessel_name FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return rows;
}

async function getFilingById(pool, filingId, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
  return rows;
}

async function getUserFilings(pool, userId, canal) {
  const params = [userId];
  let whereExtra = '';
  if (canal) {
    params.push(canal);
    whereExtra = ` AND canal = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT * FROM filings WHERE user_id = $1${whereExtra} ORDER BY created_at DESC LIMIT 5000`,
    params
  );
  return rows;
}

async function insertLeadFunnel(pool, { canalSelection, fleetSize, name, email, company }) {
  return pool.query(
    `INSERT INTO lead_funnel (canal_selection, fleet_size, name, email, company)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [canalSelection, fleetSize, name, email, company]
  );
}

module.exports = {
  getFilingForPdf,
  getIspsNotificationsByFiling,
  getScaSubmissionByFiling,
  getFilingBasicForPdfTypes,
  getFilingById,
  getUserFilings,
  insertLeadFunnel,
};
