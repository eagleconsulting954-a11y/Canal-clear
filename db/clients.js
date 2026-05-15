/**
 * db/clients.js — SQL query functions for the clients table
 *
 * Owns: all SQL queries for client/principal profiles (CRUD, listing, default management).
 * Does NOT own: route handling, auth logic, pool construction, filing queries.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 * Soft deletes: clients filtered by deleted_at IS NULL by default.
 */

/**
 * Create a new client for an agent user.
 */
async function createClient(pool, userId, fields) {
  const { name, short_name, contact_name, contact_email, contact_phone, notes, color } = fields;
  const result = await pool.query(`
    INSERT INTO clients (user_id, name, short_name, contact_name, contact_email, contact_phone, notes, color, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING *
  `, [
    userId,
    name,
    short_name || null,
    contact_name || null,
    contact_email || null,
    contact_phone || null,
    notes || null,
    color || '#4A90E2',
  ]);
  return result.rows[0];
}

/**
 * List all active clients for a user, with filing count per client.
 */
async function listClients(pool, userId) {
  const result = await pool.query(`
    SELECT
      c.*,
      COUNT(DISTINCT f.id)  FILTER (WHERE f.deleted_at IS NULL OR f.deleted_at IS NULL)   AS filing_count,
      COUNT(DISTINCT sp.id) FILTER (WHERE sp.deleted_at IS NULL)                           AS sp1_count,
      COUNT(DISTINCT mf.id) FILTER (WHERE mf.deleted_at IS NULL)                           AS malacca_count,
      COUNT(DISTINCT cf.id) FILTER (WHERE cf.deleted_at IS NULL)                           AS cape_count,
      COUNT(DISTINCT v.id)  FILTER (WHERE v.deleted_at IS NULL)                            AS voyage_count
    FROM clients c
    LEFT JOIN filings f          ON f.client_id  = c.id
    LEFT JOIN sp1_filings sp     ON sp.client_id = c.id
    LEFT JOIN malacca_filings mf ON mf.client_id = c.id
    LEFT JOIN cape_filings cf    ON cf.client_id = c.id
    LEFT JOIN voyages v          ON v.client_id  = c.id
    WHERE c.user_id = $1 AND c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY c.is_default DESC, c.name ASC
  `, [userId]);
  return result.rows;
}

/**
 * Get a single client by id, owned by userId.
 */
async function getClientById(pool, id, userId) {
  const result = await pool.query(`
    SELECT * FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
  `, [id, userId]);
  return result.rows[0] || null;
}

/**
 * Update client fields.
 */
async function updateClient(pool, id, userId, fields) {
  const { name, short_name, contact_name, contact_email, contact_phone, notes, color } = fields;
  const result = await pool.query(`
    UPDATE clients SET
      name          = COALESCE($3, name),
      short_name    = COALESCE($4, short_name),
      contact_name  = COALESCE($5, contact_name),
      contact_email = COALESCE($6, contact_email),
      contact_phone = COALESCE($7, contact_phone),
      notes         = COALESCE($8, notes),
      color         = COALESCE($9, color),
      updated_at    = NOW()
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
    RETURNING *
  `, [id, userId, name || null, short_name || null, contact_name || null, contact_email || null, contact_phone || null, notes || null, color || null]);
  return result.rows[0] || null;
}

/**
 * Soft-delete a client.
 * Does NOT re-assign filings — those keep their client_id for historical accuracy.
 */
async function deleteClient(pool, id, userId) {
  const result = await pool.query(`
    UPDATE clients SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND is_default = FALSE
    RETURNING id, name
  `, [id, userId]);
  return result.rows[0] || null;
}

/**
 * Assign a filing to a client (filings table — Panama/Suez).
 */
async function assignFilingToClient(pool, filingId, clientId, userId) {
  // Verify client ownership before assignment
  const clientCheck = await pool.query(
    'SELECT id FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [clientId, userId]
  );
  if (!clientCheck.rows[0]) return null;

  const result = await pool.query(`
    UPDATE filings SET client_id = $1 WHERE id = $2 AND user_id = $3 RETURNING id
  `, [clientId, filingId, userId]);
  return result.rows[0] || null;
}

/**
 * Assign a voyage to a client.
 */
async function assignVoyageToClient(pool, voyageId, clientId, userId) {
  const clientCheck = await pool.query(
    'SELECT id FROM clients WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [clientId, userId]
  );
  if (!clientCheck.rows[0]) return null;

  const result = await pool.query(`
    UPDATE voyages SET client_id = $1 WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL RETURNING id
  `, [clientId, voyageId, userId]);
  return result.rows[0] || null;
}

/**
 * Get filing counts broken down by client for a user's dashboard summary.
 * Returns [{client_id, client_name, filing_count}]
 */
async function getFilingCountsByClient(pool, userId) {
  const result = await pool.query(`
    SELECT
      c.id   AS client_id,
      c.name AS client_name,
      c.color,
      COUNT(DISTINCT f.id)  AS panama_suez_count,
      COUNT(DISTINCT sp.id) AS bosporus_count,
      COUNT(DISTINCT mf.id) AS malacca_count,
      COUNT(DISTINCT cf.id) AS cape_count,
      COUNT(DISTINCT v.id)  AS voyage_count
    FROM clients c
    LEFT JOIN filings f          ON f.client_id  = c.id
    LEFT JOIN sp1_filings sp     ON sp.client_id = c.id AND sp.deleted_at IS NULL
    LEFT JOIN malacca_filings mf ON mf.client_id = c.id AND mf.deleted_at IS NULL
    LEFT JOIN cape_filings cf    ON cf.client_id = c.id AND cf.deleted_at IS NULL
    LEFT JOIN voyages v          ON v.client_id  = c.id AND v.deleted_at IS NULL
    WHERE c.user_id = $1 AND c.deleted_at IS NULL
    GROUP BY c.id, c.name, c.color
    ORDER BY c.is_default DESC, COUNT(DISTINCT f.id) + COUNT(DISTINCT sp.id) + COUNT(DISTINCT mf.id) + COUNT(DISTINCT cf.id) DESC
  `, [userId]);
  return result.rows;
}

module.exports = {
  createClient,
  listClients,
  getClientById,
  updateClient,
  deleteClient,
  assignFilingToClient,
  assignVoyageToClient,
  getFilingCountsByClient,
};
