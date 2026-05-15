/**
 * db/batch-jobs.js — SQL query functions for the batch_jobs table.
 *
 * Owns: all CRUD for batch filing validation jobs.
 * Does NOT own: CSV/XLSX parsing, validation logic, or filing creation.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function createBatchJob(pool, data) {
  const {
    user_id, waterway, filename, row_count, pass_count,
    fail_count, warn_count, avg_score, result_summary,
  } = data;
  const result = await pool.query(`
    INSERT INTO batch_jobs (user_id, waterway, filename, row_count, pass_count, fail_count, warn_count, avg_score, status, result_summary)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9)
    RETURNING id, created_at
  `, [user_id, waterway, filename, row_count, pass_count, fail_count, warn_count, avg_score, JSON.stringify(result_summary)]);
  return result.rows[0];
}

async function listBatchJobs(pool, userId, { limit = 20 } = {}) {
  const result = await pool.query(`
    SELECT id, waterway, filename, row_count, pass_count, fail_count, warn_count, avg_score, status, created_at
    FROM batch_jobs
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [userId, limit]);
  return result.rows;
}

async function getBatchJobById(pool, id, userId) {
  const result = await pool.query(
    'SELECT * FROM batch_jobs WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createBatchJob,
  listBatchJobs,
  getBatchJobById,
};
