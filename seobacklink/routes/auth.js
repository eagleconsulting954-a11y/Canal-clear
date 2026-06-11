const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { createUser, getUserByEmail, createSession, deleteSession, createPasswordReset, resetPassword } = require('../db/users');
const { sendWelcome, sendPasswordReset } = require('../services/email');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const existing = await getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ email, passwordHash, name });
    const token = await createSession(user.id);
    res.cookie('sb_session', token, COOKIE_OPTS);
    await sendWelcome(email, name).catch(() => {});
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan_type: user.plan_type } });
  } catch (err) {
    console.error('register error', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = await createSession(user.id);
    res.cookie('sb_session', token, COOKIE_OPTS);
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan_type: user.plan_type } });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.sb_session;
  if (token) await deleteSession(token).catch(() => {});
  res.clearCookie('sb_session');
  res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const token = await createPasswordReset(email);
    if (token) await sendPasswordReset(email, token).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const passwordHash = await bcrypt.hash(password, 12);
    const ok = await resetPassword(token, passwordHash);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired reset token' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.get('/me', require('../middleware/requireAuth'), (req, res) => {
  const { id, email, name, plan_type, subscription_status } = req.user;
  res.json({ id, email, name, plan_type, subscription_status });
});

module.exports = router;
