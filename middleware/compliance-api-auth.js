const crypto = require('crypto');

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

function parseBearer(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  return auth.slice(7).trim();
}

function hasScope(scopes, required) {
  if (!required) return true;
  const list = Array.isArray(scopes) ? scopes : [];
  return list.includes('*') || list.includes(required);
}

function requireComplianceApiKey(requiredScope = null) {
  return async (req, res, next) => {
    const key = parseBearer(req) || req.headers['x-canalclear-api-key'];
    if (!key) return res.status(401).json({ success: false, message: 'API key required' });
    try {
      const p = req.app.locals.pool;
      const q = await p.query(
        `SELECT id,user_id,key_prefix,name,scopes,expires_at,revoked_at
         FROM compliance_api_keys
         WHERE key_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())
         LIMIT 1`,
        [hashKey(key)]
      );
      const row = q.rows[0];
      if (!row) return res.status(401).json({ success: false, message: 'Invalid or expired API key' });
      if (!hasScope(row.scopes, requiredScope)) return res.status(403).json({ success: false, message: `API key missing required scope: ${requiredScope}` });
      req.complianceApi = { keyId: row.id, userId: row.user_id, scopes: row.scopes, name: row.name };
      p.query(`UPDATE compliance_api_keys SET last_used_at=NOW() WHERE id=$1`, [row.id]).catch(() => {});
      next();
    } catch (err) {
      console.error('[compliance-api-auth]', err.message);
      res.status(500).json({ success: false, message: 'API authentication unavailable' });
    }
  };
}

module.exports = { requireComplianceApiKey, hashKey };
