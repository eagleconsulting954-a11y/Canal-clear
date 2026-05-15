/**
 * db/purchase-requests.js — Purchase requests table queries and Suez operational queries
 *
 * Owns: purchase_requests list/count, Suez ISPS notification inserts, convoy booking
 * inserts, user booking/filing lookups, and ACP credential upserts/reads.
 * Does NOT own: route handling, authentication, pool construction.
 *
 * All callers pass pool (from req.app.locals.pool).
 */

/**
 * Create a new purchase request.
 * @param {object} pool
 * @param {string} email
 * @param {string|null} name
 * @param {string} planId
 * @param {string|null} planName
 */
async function createPurchaseRequest(pool, { email, name, plan_id, plan_name }) {
  return pool.query(
    `INSERT INTO purchase_requests (email, name, plan_id, plan_name)
     VALUES ($1, $2, $3, $4)`,
    [email, name || null, plan_id, plan_name || null]
  );
}

/**
 * List purchase requests (paginated, ordered by created_at DESC).
 * @param {object} pool
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{rows: object[]}>}
 */
async function listPurchaseRequests(pool, limit, offset) {
  return pool.query(`
      SELECT id, email, name, plan_id, plan_name, created_at
      FROM purchase_requests
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
}

/**
 * Count total purchase requests.
 * @param {object} pool
 * @returns {Promise<{rows: object[]}>}
 */
async function countPurchaseRequests(pool) {
  return pool.query('SELECT COUNT(*) AS total FROM purchase_requests');
}

/**
 * Look up a filing by id and user_id, returning canal and vessel info.
 * Used to verify filing ownership before ISPS notification insertion.
 * @param {object} pool
 * @param {number} filingId
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getFilingForIsps(pool, filingId, userId) {
  return pool.query(
    'SELECT id, canal, vessel_name, imo_number FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
}

/**
 * Insert a Suez ISPS notification.
 * @param {object} pool
 * @param {object} params
 * @returns {Promise<{rows: object[]}>}
 */
async function insertIspsNotification(pool, { userId, filingId, vesselName, imoNumber, notificationType, specialMeasures, last10Ports }) {
  return pool.query(`
      INSERT INTO suez_isps_notifications
        (user_id, filing_id, vessel_name, imo_number, notification_type, special_measures, last_10_ports, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `, [
    userId, filingId,
    vesselName || 'UNKNOWN', imoNumber || '0000000',
    notificationType,
    specialMeasures || null,
    JSON.stringify(last10Ports || [])
  ]);
}

/**
 * Look up a filing by id and user_id, returning canal and vessel_type.
 * Used to verify filing ownership before convoy booking.
 * @param {object} pool
 * @param {number} filingId
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getFilingForConvoy(pool, filingId, userId) {
  return pool.query(
    'SELECT id, canal, vessel_type FROM filings WHERE id = $1 AND user_id = $2',
    [filingId, userId]
  );
}

/**
 * Get vessel info from a filing by filing id.
 * @param {object} pool
 * @param {number} filingId
 * @returns {Promise<{rows: object[]}>}
 */
async function getFilingVesselInfo(pool, filingId) {
  return pool.query(
    'SELECT vessel_name, imo_number, vessel_type FROM filings WHERE id = $1',
    [filingId]
  );
}

/**
 * Insert a convoy booking into sca_submissions.
 * @param {object} pool
 * @param {object} params
 * @returns {Promise<{rows: object[]}>}
 */
async function insertConvoyBooking(pool, {
  userId, filingId, vesselName, transitDirection, convoyNumber,
  requestedTransitDate, priorityClass, agentName, agentPhone,
  agentEmail, specialRequirements, notes
}) {
  return pool.query(`
      INSERT INTO sca_submissions
        (user_id, filing_id, vessel_name, filing_type, transit_direction, convoy_number, status,
         requested_transit_date, priority_class, agent_name, agent_phone, agent_email, special_requirements, notes)
      VALUES ($1, $2, $3, $4, $5, $6, 'submitted', $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
    userId, filingId,
    vesselName || null,
    'convoy_booking',
    transitDirection,
    convoyNumber || null,
    requestedTransitDate || null,
    priorityClass || null,
    agentName || null,
    agentPhone || null,
    agentEmail || null,
    specialRequirements,
    notes || null
  ]);
}

/**
 * Get user's convoy booking history.
 * @param {object} pool
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getUserConvoyBookings(pool, userId) {
  return pool.query(`
      SELECT
        s.id, s.vessel_name, s.transit_direction, s.convoy_number, s.sca_reference,
        s.status, s.submitted_at, s.requested_transit_date, s.priority_class,
        s.agent_name, s.agent_email, s.agent_phone, s.special_requirements, s.notes,
        f.reference_number AS filing_reference,
        f.vessel_type, f.imo_number
      FROM sca_submissions s
      LEFT JOIN filings f ON f.id = s.filing_id
      WHERE s.user_id = $1 AND s.filing_type = 'convoy_booking'
      ORDER BY s.submitted_at DESC
      LIMIT 50
    `, [userId]);
}

/**
 * Get user's Suez Canal filings.
 * @param {object} pool
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getUserSuezFilings(pool, userId) {
  return pool.query(`
      SELECT id, reference_number, vessel_name, imo_number, vessel_type,
             status, created_at, scnt, draft_forward, draft_aft, air_draft
      FROM filings
      WHERE user_id = $1 AND canal = 'suez'
      ORDER BY created_at DESC
      LIMIT 30
    `, [userId]);
}

/**
 * Upsert ACP credentials (one row per user).
 * @param {object} pool
 * @param {number} userId
 * @param {string} encryptedUsername
 * @param {string} encryptedPassword
 * @returns {Promise<{rows: object[]}>}
 */
async function upsertAcpCredentials(pool, userId, encryptedUsername, encryptedPassword) {
  return pool.query(
    `INSERT INTO acp_credentials (user_id, encrypted_username, encrypted_password, encryption_iv, status, updated_at)
       VALUES ($1, $2, $3, 'v2', 'connected', NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         encrypted_username = EXCLUDED.encrypted_username,
         encrypted_password = EXCLUDED.encrypted_password,
         status = 'connected',
         updated_at = NOW()
       RETURNING id, status, created_at, updated_at`,
    [userId, encryptedUsername, encryptedPassword]
  );
}

/**
 * Get ACP credential status for a user (no plain credentials returned).
 * @param {object} pool
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getAcpCredentialStatus(pool, userId) {
  return pool.query(
    `SELECT id, status, last_tested_at, created_at, updated_at,
              LEFT(encrypted_username, 6) AS username_prefix
       FROM acp_credentials WHERE user_id = $1`,
    [userId]
  );
}

/**
 * Get ACP encrypted username for a user (for display hint decryption).
 * @param {object} pool
 * @param {number} userId
 * @returns {Promise<{rows: object[]}>}
 */
async function getAcpEncryptedUsername(pool, userId) {
  return pool.query(
    'SELECT encrypted_username FROM acp_credentials WHERE user_id = $1',
    [userId]
  );
}

module.exports = {
  createPurchaseRequest,
  listPurchaseRequests,
  countPurchaseRequests,
  getFilingForIsps,
  insertIspsNotification,
  getFilingForConvoy,
  getFilingVesselInfo,
  insertConvoyBooking,
  getUserConvoyBookings,
  getUserSuezFilings,
  upsertAcpCredentials,
  getAcpCredentialStatus,
  getAcpEncryptedUsername,
};
