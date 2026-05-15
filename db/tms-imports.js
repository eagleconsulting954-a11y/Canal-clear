/**
 * db/tms-imports.js — TMS Import Layer persistence.
 * Owns: tms_import_jobs, tms_vessel_records, tms_mapping_templates reads and writes.
 * Does NOT own: Pool construction (server.js), field mapping logic (services/tms-field-mapper.js),
 *   route handling (routes/tms-import.js).
 */

'use strict';

// ── Import Jobs ───────────────────────────────────────────────────────────────

async function createImportJob(pool, { userId, fileName, fileFormat, tmsProvider, rawHeaders }) {
  const result = await pool.query(
    `INSERT INTO tms_import_jobs (user_id, file_name, file_format, tms_provider, raw_headers, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     RETURNING *`,
    [userId, fileName, fileFormat, tmsProvider || null, JSON.stringify(rawHeaders || [])]
  );
  return result.rows[0];
}

async function updateImportJob(pool, jobId, updates) {
  const allowed = ['field_mapping', 'row_count', 'valid_count', 'error_count', 'status'];
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of allowed) {
    if (key in updates) {
      sets.push(`${key} = $${i++}`);
      vals.push(typeof updates[key] === 'object' ? JSON.stringify(updates[key]) : updates[key]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  vals.push(jobId);
  const result = await pool.query(
    `UPDATE tms_import_jobs SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    vals
  );
  return result.rows[0];
}

async function getImportJob(pool, jobId, userId) {
  const result = await pool.query(
    `SELECT * FROM tms_import_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  return result.rows[0] || null;
}

async function listImportJobs(pool, userId, { limit = 20, offset = 0 } = {}) {
  const result = await pool.query(
    `SELECT id, file_name, file_format, tms_provider, row_count, valid_count, error_count,
            status, created_at, updated_at
     FROM tms_import_jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return result.rows;
}

// ── Vessel Records ────────────────────────────────────────────────────────────

async function insertVesselRecords(pool, jobId, userId, rows) {
  // rows: array of canonical vessel objects + { rowNumber, rawRow, validationStatus, validationErrors, validationWarnings }
  if (!rows.length) return [];
  const inserted = [];
  for (const row of rows) {
    const r = await pool.query(
      `INSERT INTO tms_vessel_records (
         job_id, user_id, row_number,
         imo_number, vessel_name, flag_state, gross_tonnage, loa_meters, beam_meters, max_draft_meters, vessel_type,
         port_of_origin, port_of_dest, eta, etd, cargo_type, cargo_quantity, cargo_unit,
         master_name, crew_count,
         pi_club, cofr_number, class_society, class_cert_no,
         validation_status, validation_errors, validation_warnings, raw_row
       ) VALUES (
         $1, $2, $3,
         $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17, $18,
         $19, $20,
         $21, $22, $23, $24,
         $25, $26, $27, $28
       ) RETURNING id`,
      [
        jobId, userId, row.rowNumber,
        row.imo_number || null, row.vessel_name || null, row.flag_state || null,
        row.gross_tonnage || null, row.loa_meters || null, row.beam_meters || null,
        row.max_draft_meters || null, row.vessel_type || null,
        row.port_of_origin || null, row.port_of_dest || null,
        row.eta || null, row.etd || null,
        row.cargo_type || null, row.cargo_quantity || null, row.cargo_unit || null,
        row.master_name || null, row.crew_count || null,
        row.pi_club || null, row.cofr_number || null, row.class_society || null, row.class_cert_no || null,
        row.validationStatus || 'pending',
        JSON.stringify(row.validationErrors || []),
        JSON.stringify(row.validationWarnings || []),
        JSON.stringify(row.rawRow || {}),
      ]
    );
    inserted.push(r.rows[0]);
  }
  return inserted;
}

async function getVesselRecords(pool, jobId, userId, { includeDeleted = false } = {}) {
  const result = await pool.query(
    `SELECT * FROM tms_vessel_records
     WHERE job_id = $1 AND user_id = $2
       ${includeDeleted ? '' : 'AND deleted_at IS NULL'}
     ORDER BY row_number ASC`,
    [jobId, userId]
  );
  return result.rows;
}

async function getVesselRecord(pool, recordId, userId) {
  const result = await pool.query(
    `SELECT * FROM tms_vessel_records WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [recordId, userId]
  );
  return result.rows[0] || null;
}

// ── Mapping Templates ─────────────────────────────────────────────────────────

async function saveMappingTemplate(pool, userId, { templateName, tmsProvider, fieldMapping }) {
  const result = await pool.query(
    `INSERT INTO tms_mapping_templates (user_id, template_name, tms_provider, field_mapping)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, template_name)
     DO UPDATE SET field_mapping = $4, tms_provider = $3, updated_at = NOW()
     RETURNING *`,
    [userId, templateName, tmsProvider || null, JSON.stringify(fieldMapping)]
  );
  return result.rows[0];
}

async function getMappingTemplates(pool, userId) {
  const result = await pool.query(
    `SELECT id, template_name, tms_provider, field_mapping, created_at, updated_at
     FROM tms_mapping_templates
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );
  return result.rows;
}

async function deleteMappingTemplate(pool, templateId, userId) {
  await pool.query(
    `DELETE FROM tms_mapping_templates WHERE id = $1 AND user_id = $2`,
    [templateId, userId]
  );
}

module.exports = {
  createImportJob,
  updateImportJob,
  getImportJob,
  listImportJobs,
  insertVesselRecords,
  getVesselRecords,
  getVesselRecord,
  saveMappingTemplate,
  getMappingTemplates,
  deleteMappingTemplate,
};
