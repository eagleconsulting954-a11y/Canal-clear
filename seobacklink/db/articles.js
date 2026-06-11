const pool = require('./index');
const { v4: uuidv4 } = require('uuid');

async function createArticle({ userId, keyword, title, meta, slug, content, wordCount }) {
  const { rows } = await pool.query(
    `INSERT INTO articles (id, user_id, keyword, title, meta_description, slug, content, word_count, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'generating', NOW())
     RETURNING *`,
    [uuidv4(), userId, keyword, title || null, meta || null, slug || null, content || null, wordCount || null]
  );
  return rows[0];
}

async function getArticlesByUser(userId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, keyword, title, slug, word_count, status, created_at
     FROM articles WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

async function getArticleById(id, userId) {
  const { rows } = await pool.query(
    'SELECT * FROM articles WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL LIMIT 1',
    [id, userId]
  );
  return rows[0] || null;
}

async function updateArticle(id, userId, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClauses = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE articles SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId, ...values]
  );
  return rows[0] || null;
}

async function countArticlesThisMonth(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt FROM articles
     WHERE user_id = $1 AND deleted_at IS NULL
       AND created_at >= date_trunc('month', NOW())`,
    [userId]
  );
  return parseInt(rows[0].cnt, 10);
}

async function deleteArticle(id, userId) {
  await pool.query(
    'UPDATE articles SET deleted_at = NOW() WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
}

module.exports = { createArticle, getArticlesByUser, getArticleById, updateArticle, countArticlesThisMonth, deleteArticle };
