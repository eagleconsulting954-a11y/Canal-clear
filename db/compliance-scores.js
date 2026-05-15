/**
 * db/compliance-scores.js — SQL query functions for compliance_score_leads table.
 *
 * Owns: compliance score lead capture and email association.
 * Does NOT own: compliance scoring logic, email sending, or lead management.
 *
 * All callers pass `pool` (from req.app.locals.pool).
 */

async function insertComplianceScoreLead(pool, data) {
  const {
    imo_number, vessel_name, flag_state, vessel_type, gross_tonnage,
    transit_date, cargo_type, overall_score, vumpa_score, pcsopep_score,
    docs_score, risk_score, risk_flags,
  } = data;
  const result = await pool.query(
    `INSERT INTO compliance_score_leads
       (imo_number, vessel_name, flag_state, vessel_type, gross_tonnage, transit_date, cargo_type,
        overall_score, vumpa_score, pcsopep_score, docs_score, risk_score, risk_flags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [
      imo_number || null, vessel_name || null, flag_state || null,
      vessel_type || null, gross_tonnage ? parseInt(gross_tonnage) : null,
      transit_date || null, cargo_type || null,
      overall_score != null ? parseInt(overall_score) : null,
      vumpa_score != null ? parseInt(vumpa_score) : null,
      pcsopep_score != null ? parseInt(pcsopep_score) : null,
      docs_score != null ? parseInt(docs_score) : null,
      risk_score != null ? parseInt(risk_score) : null,
      risk_flags ? JSON.stringify(risk_flags) : null,
    ]
  );
  return result.rows[0];
}

async function updateComplianceScoreEmail(pool, leadId, email) {
  return pool.query(
    'UPDATE compliance_score_leads SET email = $1 WHERE id = $2',
    [email.slice(0, 255), parseInt(leadId)]
  );
}

async function insertComplianceScoreWithEmail(pool, data) {
  const { imo_number, vessel_name, overall_score, email } = data;
  return pool.query(
    `INSERT INTO compliance_score_leads (imo_number, vessel_name, overall_score, email, source)
     VALUES ($1, $2, $3, $4, 'compliance_score_email')`,
    [imo_number || null, vessel_name || null,
     overall_score ? parseInt(overall_score) : null, email.slice(0, 255)]
  );
}

module.exports = {
  insertComplianceScoreLead,
  updateComplianceScoreEmail,
  insertComplianceScoreWithEmail,
};
