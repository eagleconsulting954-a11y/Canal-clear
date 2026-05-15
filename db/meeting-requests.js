/**
 * db/meeting-requests.js — SQL query functions for meeting_requests table.
 *
 * Owns: meeting request CRUD, admin listing/stats, status updates.
 * Does NOT own: email sending, route handling, chatbot logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function createMeetingRequest(pool, { name, email, company, fleetSize, preferredDate, preferredTime, timezone, message }) {
  const result = await pool.query(
    `INSERT INTO meeting_requests (name, email, company, fleet_size, preferred_date, preferred_time, timezone, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [name, email, company, fleetSize, preferredDate, preferredTime, timezone, message]
  );
  return result;
}

async function listMeetingRequests(pool, { status, limit, offset }) {
  let where = '';
  const params = [];
  if (status) { params.push(status); where = `WHERE status = $1`; }

  const result = await pool.query(
    `SELECT * FROM meeting_requests ${where} ORDER BY created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
    [...params, limit, offset]
  );
  return result;
}

async function countMeetingRequests(pool, { status }) {
  let where = '';
  const params = [];
  if (status) { params.push(status); where = `WHERE status = $1`; }

  const result = await pool.query(`SELECT COUNT(*) FROM meeting_requests ${where}`, params);
  return result;
}

async function getMeetingRequestStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_this_week
    FROM meeting_requests
  `);
  return result;
}

async function updateMeetingRequest(pool, id, updates, params) {
  const result = await pool.query(
    `UPDATE meeting_requests SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result;
}

module.exports = {
  createMeetingRequest,
  listMeetingRequests,
  countMeetingRequests,
  getMeetingRequestStats,
  updateMeetingRequest,
};
