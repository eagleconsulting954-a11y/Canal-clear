/**
 * db/site-assets.js — SQL query functions for the site_assets table.
 *
 * Owns: all CRUD against site_assets (PDF storage, founder portrait, R2 references).
 * Does NOT own: PDF generation logic, R2 uploads, or route handling.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function ensureSiteAssetsTable(pool) {
  return pool.query(`CREATE TABLE IF NOT EXISTS site_assets (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/png',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

async function getAssetByKey(pool, key) {
  const result = await pool.query(
    'SELECT data, content_type FROM site_assets WHERE key = $1',
    [key]
  );
  return result.rows[0] || null;
}

async function checkAssetExists(pool, key) {
  const result = await pool.query(
    'SELECT data FROM site_assets WHERE key = $1',
    [key]
  );
  return result.rows[0] || null;
}

async function upsertAsset(pool, key, data, contentType) {
  return pool.query(
    `INSERT INTO site_assets (key, data, content_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET data = $2, content_type = $3, created_at = NOW()`,
    [key, data, contentType]
  );
}

module.exports = {
  ensureSiteAssetsTable,
  getAssetByKey,
  checkAssetExists,
  upsertAsset,
};
