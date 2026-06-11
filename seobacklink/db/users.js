const pool = require('./index');
const { v4: uuidv4 } = require('uuid');

async function createUser({ email, passwordHash, name }) {
  const { rows } = await pool.query(
    `INSERT INTO users (id, email, password_hash, name, plan_type, subscription_status, created_at)
     VALUES ($1, $2, $3, $4, 'free', 'active', NOW())
     RETURNING id, email, name, plan_type, subscription_status, created_at`,
    [uuidv4(), email, passwordHash, name]
  );
  return rows[0];
}

async function getUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, email, name, plan_type, subscription_status, stripe_customer_id, stripe_subscription_id, articles_used_this_month, created_at FROM users WHERE id = $1 LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function updateUser(id, fields) {
  const keys = Object.keys(fields);
  const values = Object.values(fields);
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING id, email, name, plan_type, subscription_status`,
    [id, ...values]
  );
  return rows[0] || null;
}

async function createSession(userId) {
  const token = uuidv4() + uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt]
  );
  return token;
}

async function getSession(token) {
  const { rows } = await pool.query(
    `SELECT s.token, s.user_id, s.expires_at, u.id, u.email, u.name, u.plan_type, u.subscription_status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW() LIMIT 1`,
    [token]
  );
  return rows[0] || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function createPasswordReset(email) {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  if (!rows[0]) return null;
  const token = uuidv4() + uuidv4();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, rows[0].id, expiresAt]
  );
  return token;
}

async function getPasswordReset(token) {
  const { rows } = await pool.query(
    'SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = false LIMIT 1',
    [token]
  );
  return rows[0] || null;
}

async function resetPassword(token, passwordHash) {
  const reset = await getPasswordReset(token);
  if (!reset) return false;
  await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, reset.user_id]);
  await pool.query('UPDATE password_resets SET used = true WHERE token = $1', [token]);
  return true;
}

module.exports = { createUser, getUserByEmail, getUserById, updateUser, createSession, getSession, deleteSession, createPasswordReset, getPasswordReset, resetPassword };
