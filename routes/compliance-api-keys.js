const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { hashKey } = require('../middleware/compliance-api-auth');

const ALLOWED_SCOPES = ['passport:read','voyage:read','regulations:read'];

router.get('/', requireAuth, async (req, res) => {
  try {
    const q = await req.app.locals.pool.query(`SELECT id,key_prefix,name,scopes,last_used_at,expires_at,revoked_at,created_at FROM compliance_api_keys WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
    res.json({ success: true, keys: q.rows, allowed_scopes: ALLOWED_SCOPES });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/', requireAuth, async (req, res) => {
  const { name, scopes = [], expires_at = null } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
  const normalizedScopes = Array.from(new Set((Array.isArray(scopes) ? scopes : []).map(String)));
  const invalid = normalizedScopes.filter(s => !ALLOWED_SCOPES.includes(s));
  if (invalid.length) return res.status(400).json({ success: false, message: `Invalid scopes: ${invalid.join(', ')}` });
  if (!normalizedScopes.length) return res.status(400).json({ success: false, message: 'At least one scope is required' });

  const rawKey = `cc_live_${crypto.randomBytes(24).toString('hex')}`;
  const prefix = rawKey.slice(0, 16);
  try {
    const q = await req.app.locals.pool.query(
      `INSERT INTO compliance_api_keys(user_id,key_prefix,key_hash,name,scopes,expires_at)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,key_prefix,name,scopes,expires_at,created_at`,
      [req.user.id, prefix, hashKey(rawKey), String(name).trim(), normalizedScopes, expires_at]
    );
    res.json({ success: true, api_key: rawKey, key: q.rows[0], warning: 'Store this key now. CanalClear only stores its hash and cannot show the full key again.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/:id/revoke', requireAuth, async (req, res) => {
  try {
    const q = await req.app.locals.pool.query(`UPDATE compliance_api_keys SET revoked_at=NOW() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING id,key_prefix,name,scopes,revoked_at`, [Number(req.params.id), req.user.id]);
    if (!q.rows[0]) return res.status(404).json({ success: false, message: 'Active API key not found' });
    res.json({ success: true, key: q.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
