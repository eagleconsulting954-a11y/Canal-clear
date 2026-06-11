const pool = require('./index');
const { v4: uuidv4 } = require('uuid');

async function createBacklink({ userId, targetUrl, anchorText, sourceUrl, domainAuthority, status }) {
  const { rows } = await pool.query(
    `INSERT INTO backlinks (id, user_id, target_url, anchor_text, source_url, domain_authority, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [uuidv4(), userId, targetUrl, anchorText, sourceUrl || null, domainAuthority || null, status || 'pending']
  );
  return rows[0];
}

async function getBacklinksByUser(userId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM backlinks WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

async function updateBacklinkStatus(id, userId, status) {
  const { rows } = await pool.query(
    `UPDATE backlinks SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *`,
    [status, id, userId]
  );
  return rows[0] || null;
}

async function getBacklinkStats(userId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active') AS active,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'lost') AS lost,
       ROUND(AVG(domain_authority) FILTER (WHERE domain_authority IS NOT NULL), 1) AS avg_da
     FROM backlinks WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

module.exports = { createBacklink, getBacklinksByUser, updateBacklinkStatus, getBacklinkStats };
