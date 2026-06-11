const pool = require('./index');
const { v4: uuidv4 } = require('uuid');

async function createVisibilityCheck({ userId, brand, keyword, score, mentions, analysis }) {
  const { rows } = await pool.query(
    `INSERT INTO visibility_checks (id, user_id, brand, keyword, score, mentions, analysis, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [uuidv4(), userId, brand, keyword, score, mentions || 0, analysis || null]
  );
  return rows[0];
}

async function getVisibilityByUser(userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, brand, keyword, score, mentions, created_at
     FROM visibility_checks WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

async function getVisibilityStats(userId) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) AS total_checks,
       ROUND(AVG(score), 1) AS avg_score,
       MAX(score) AS best_score,
       SUM(mentions) AS total_mentions
     FROM visibility_checks WHERE user_id = $1`,
    [userId]
  );
  return rows[0];
}

module.exports = { createVisibilityCheck, getVisibilityByUser, getVisibilityStats };
