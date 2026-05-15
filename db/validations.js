/**
 * db/validations.js — SQL query functions for the validations table.
 *
 * Owns: recording validation runs (demo + live) and admin validation stats.
 * Does NOT own: validation logic (services/*-validator.js), filing CRUD, or compliance scoring.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function recordValidation(pool, data) {
  const {
    vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
    cargo_type, has_dangerous_goods, overall_status, total_checks,
    passed_checks, failed_checks, warning_checks, canal,
  } = data;
  return pool.query(
    `INSERT INTO validations
       (vessel_name, imo_number, flag_state, vessel_type, gross_tonnage,
        cargo_type, has_dangerous_goods,
        overall_status, total_checks, passed_checks, failed_checks, warning_checks, canal)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      vessel_name || null, imo_number || null, flag_state || null,
      vessel_type || null, gross_tonnage ? parseInt(gross_tonnage) : null,
      cargo_type || null, !!has_dangerous_goods,
      overall_status || 'unknown', total_checks || 0,
      passed_checks || 0, failed_checks || 0, warning_checks || 0,
      canal,
    ]
  );
}

async function checkFilingsTableExists(pool) {
  const result = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'filings' LIMIT 1`
  );
  return result.rows.length > 0;
}

/**
 * Load active Suez validation rules from DB.
 */
async function getActiveSuezValidationRules(pool) {
  const result = await pool.query(
    'SELECT * FROM suez_validation_rules WHERE active = true ORDER BY severity DESC'
  );
  return result;
}

/**
 * Record a full validation with all fields including checklist.
 * Used by POST /api/validate (fire-and-forget).
 */
async function recordFullValidation(pool, data) {
  const {
    vessel_name, imo_number, flag_state, vessel_type,
    loa, beam, draft, gross_tonnage,
    cargo_type, has_dangerous_goods, dangerous_goods_class,
    transit_direction, booking_number, eta,
    overall_status, total_checks, passed_checks, failed_checks, warning_checks, checklist
  } = data;
  return pool.query(`
    INSERT INTO validations (
      vessel_name, imo_number, flag_state, vessel_type,
      loa, beam, draft, gross_tonnage,
      cargo_type, has_dangerous_goods, dangerous_goods_class,
      transit_direction, booking_number, eta,
      overall_status, total_checks, passed_checks, failed_checks, warning_checks, checklist
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    RETURNING id, created_at
  `, [
    vessel_name, imo_number, flag_state, vessel_type,
    loa, beam, draft, gross_tonnage,
    cargo_type, has_dangerous_goods, dangerous_goods_class,
    transit_direction, booking_number, eta,
    overall_status, total_checks, passed_checks, failed_checks, warning_checks, checklist
  ]);
}

/**
 * List validations with pagination.
 */
async function listValidations(pool, limit, offset) {
  const result = await pool.query(`
    SELECT id, vessel_name, imo_number, vessel_type, cargo_type,
           overall_status, total_checks, passed_checks, failed_checks, warning_checks,
           created_at
    FROM validations
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return result;
}

/**
 * Count total validations.
 */
async function countValidations(pool) {
  const result = await pool.query('SELECT COUNT(*) as total FROM validations');
  return result;
}

/**
 * Get a single validation by ID.
 */
async function getValidationById(pool, id) {
  const result = await pool.query('SELECT * FROM validations WHERE id = $1', [id]);
  return result;
}

/**
 * Export validations with user email join, limited to 500.
 */
async function exportValidationsWithUser(pool) {
  const result = await pool.query(`
    SELECT v.id, v.vessel_name, v.imo_number, v.flag_state, v.vessel_type,
           v.cargo_type, v.overall_status, v.total_checks, v.passed_checks,
           v.failed_checks, v.warning_checks, v.booking_number, v.eta,
           v.transit_direction, v.created_at,
           u.email as user_email
    FROM validations v
    LEFT JOIN users u ON v.user_id = u.id
    ORDER BY v.created_at DESC
    LIMIT 500
  `);
  return result;
}

/**
 * Dashboard validation statistics.
 */
async function getValidationStats(pool) {
  const result = await pool.query(`
    SELECT
      COUNT(*) as total_validations,
      COUNT(*) FILTER (WHERE overall_status = 'passed') as passed,
      COUNT(*) FILTER (WHERE overall_status = 'failed') as failed,
      COUNT(*) FILTER (WHERE overall_status = 'warning') as warnings,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d
    FROM validations
  `);
  return result;
}

module.exports = {
  recordValidation,
  checkFilingsTableExists,
  getActiveSuezValidationRules,
  recordFullValidation,
  listValidations,
  countValidations,
  getValidationById,
  exportValidationsWithUser,
  getValidationStats,
};
