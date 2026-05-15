/**
 * db/leads.js — SQL query functions for the leads table.
 *
 * Owns: lead capture inserts and upserts, admin lead listing.
 * Does NOT own: drip email scheduling, email sending, or compliance scoring.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function upsertLead(pool, { email, company_name, fleet_size, source }) {
  return pool.query(
    `INSERT INTO leads (email, company_name, fleet_size, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
    [email.slice(0, 255), company_name || null, fleet_size || null, source]
  );
}

async function insertLeadIfNew(pool, { email, company_name, fleet_size, source }) {
  return pool.query(
    `INSERT INTO leads (email, company_name, fleet_size, source)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [email.slice(0, 255), company_name || null, fleet_size || null, source]
  );
}

/**
 * Insert a new lead and return the id + created_at.
 * @param {object} pool
 * @param {object} params
 * @returns {Promise<{rows: object[]}>}
 */
async function insertLeadReturning(pool, { email, company_name, fleet_size, source }) {
  return pool.query(
    `INSERT INTO leads (email, company_name, fleet_size, source)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
    [
      email,
      company_name ? company_name.trim().slice(0, 255) : null,
      fleet_size ? String(fleet_size).slice(0, 64) : null,
      source || 'demo_request',
    ]
  );
}

/**
 * Insert a lead funnel submission.
 * @param {object} pool
 * @param {object} params
 * @returns {Promise<{rows: object[]}>}
 */
async function insertLeadFunnel(pool, { canal_selection, fleet_size, name, email, company, phone, source }) {
  return pool.query(
    `INSERT INTO lead_funnel (canal_selection, fleet_size, name, email, company, phone, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
    [canal_selection, fleet_size, name.trim(), email.trim().toLowerCase(),
     company ? company.trim() : null, phone ? phone.trim() : null, source]
  );
}

/**
 * Insert a Suez readiness score lead into lead_funnel.
 * @param {object} pool
 * @param {object} params
 * @returns {Promise<{rows: object[]}>}
 */
async function insertSuezReadinessLead(pool, { name, email, company, vessel_name }) {
  return pool.query(
    `INSERT INTO lead_funnel (canal_selection, fleet_size, name, email, company, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    ['suez', 'score', name.trim(), email.trim().toLowerCase(),
     company ? company.trim() : null, vessel_name ? vessel_name.trim() : null]
  );
}

module.exports = {
  upsertLead,
  insertLeadIfNew,
  insertLeadReturning,
  insertLeadFunnel,
  insertSuezReadinessLead,
};
