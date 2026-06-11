const { getSession } = require('../db/users');

module.exports = async function requireAuth(req, res, next) {
  const token = req.cookies?.sb_session;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const session = await getSession(token);
  if (!session) return res.status(401).json({ error: 'Session expired' });
  req.user = session;
  next();
};
