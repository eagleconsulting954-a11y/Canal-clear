/**
 * db/calculator-leads.js — SQL query functions for calculator_leads table.
 *
 * Owns: lead capture for the Rejection Exposure Calculator, admin listing.
 * Does NOT own: email sending, PDF generation, calculation logic.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function insertCalculatorLead(pool, {
  email, company, fleet_size, monthly_transits, cargo_type,
  primary_waterway, filing_method, annual_exposure, with_canalclear,
  savings, ip_address,
}) {
  const { rows } = await pool.query(
    `INSERT INTO calculator_leads
       (email, company, fleet_size, monthly_transits, cargo_type,
        primary_waterway, filing_method, annual_exposure, with_canalclear,
        savings, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, created_at`,
    [
      email, company || null, fleet_size, monthly_transits, cargo_type,
      primary_waterway, filing_method,
      annual_exposure != null ? annual_exposure : null,
      with_canalclear != null ? with_canalclear : null,
      savings != null ? savings : null,
      ip_address || null,
    ]
  );
  return rows[0];
}

async function markPdfSent(pool, id) {
  await pool.query(
    `UPDATE calculator_leads SET pdf_sent = TRUE WHERE id = $1`,
    [id]
  );
}

async function listCalculatorLeads(pool, { limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, email, company, fleet_size, monthly_transits, cargo_type,
            primary_waterway, filing_method, annual_exposure, with_canalclear,
            savings, pdf_sent, created_at
       FROM calculator_leads
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

async function countCalculatorLeads(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM calculator_leads`);
  return rows[0].total;
}

module.exports = {
  insertCalculatorLead,
  markPdfSent,
  listCalculatorLeads,
  countCalculatorLeads,
};
