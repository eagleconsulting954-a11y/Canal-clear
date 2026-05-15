/**
 * routes/tms-import.js — TMS Universal Import Layer API.
 * Owns: all /api/tms-import/* endpoints — file upload, auto-detect, field mapping,
 *       per-row validation, import history, mapping template CRUD.
 * Does NOT own: Pool construction (server.js), canonical schema definition
 *   (services/tms-field-mapper.js), DB persistence (db/tms-imports.js).
 *
 * Endpoints:
 *   POST   /api/tms-import/upload              — parse file; return headers + auto-detected mapping
 *   POST   /api/tms-import/validate            — apply mapping, validate all rows, persist job + records
 *   GET    /api/tms-import/jobs                — list import history for user
 *   GET    /api/tms-import/jobs/:id            — get job + all vessel records
 *   GET    /api/tms-import/jobs/:id/vessel/:rid — get single vessel record
 *   GET    /api/tms-import/schema              — canonical field definitions (for UI)
 *   GET    /api/tms-import/templates           — list saved mapping templates
 *   POST   /api/tms-import/templates           — save a mapping template
 *   DELETE /api/tms-import/templates/:id       — delete a mapping template
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const router  = express.Router();

const { requireAuth, requireSubscription } = require('../middleware/auth');
const {
  CANONICAL_FIELDS,
  parseFile,
  autoDetectMapping,
  applyMapping,
  validateAll,
  detectFormat,
} = require('../services/tms-field-mapper');
const {
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
} = require('../db/tms-imports');

const BATCH_LIMIT = 500; // max rows per import

// Multer: in-memory, 10 MB, CSV / XLSX / JSON only
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx|json)$/i.test(file.originalname) ||
      ['text/csv', 'application/json',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/octet-stream'].includes(file.mimetype);
    cb(null, ok);
  },
});

// ── GET /api/tms-import/schema ─────────────────────────────────────────────
// Returns the canonical field definitions for the UI to build the mapping UI.
// Public — no auth required (needed before login for demo).
router.get('/schema', (req, res) => {
  res.json({ success: true, fields: CANONICAL_FIELDS });
});

// ── POST /api/tms-import/upload ────────────────────────────────────────────
// Parse uploaded file, return column headers + auto-suggested mapping.
// Auth required; subscription NOT required (allows mapping step before checkout).
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded. Send multipart/form-data with field "file".' });
  }

  try {
    const format = detectFormat(file.mimetype, file.originalname);
    let headers, rows;
    try {
      ({ headers, rows } = parseFile(file.buffer, file.mimetype, file.originalname));
    } catch (parseErr) {
      return res.status(422).json({ success: false, message: `Could not parse file: ${parseErr.message}` });
    }

    if (!rows.length) {
      return res.status(422).json({ success: false, message: 'File is empty or contains no data rows.' });
    }

    if (rows.length > BATCH_LIMIT) {
      return res.status(422).json({
        success: false,
        message: `File contains ${rows.length} rows, exceeding the ${BATCH_LIMIT}-row limit. Split and re-upload.`,
      });
    }

    const suggestedMapping = autoDetectMapping(headers);
    const tmsProvider = (req.body.tms_provider || '').trim() || null;

    // Persist the job record (status: pending — not yet validated)
    const pool = req.app.locals.pool;
    const job  = await createImportJob(pool, {
      userId:      req.user.id,
      fileName:    file.originalname,
      fileFormat:  format,
      tmsProvider,
      rawHeaders:  headers,
    });

    // Stash the raw rows in the job temporarily — we need them for the /validate step.
    // We encode rows as base64 JSON in the response; client sends back on /validate.
    // This avoids storing raw file data in DB while keeping stateless parse.
    const rawRowsB64 = Buffer.from(JSON.stringify(rows)).toString('base64');

    return res.json({
      success:         true,
      job_id:          job.id,
      file_name:       file.originalname,
      format,
      row_count:       rows.length,
      headers,
      suggested_mapping: suggestedMapping,
      raw_rows_token:  rawRowsB64,  // sent back to /validate
    });
  } catch (err) {
    console.error('[tms-import] upload error:', err.message);
    return res.status(500).json({ success: false, message: 'Upload processing failed — please try again.' });
  }
});

// ── POST /api/tms-import/validate ──────────────────────────────────────────
// Apply field mapping to raw rows, validate, persist vessel records, return results.
// Auth + subscription required.
router.post('/validate', requireAuth, requireSubscription, async (req, res) => {
  const { job_id, field_mapping, raw_rows_token, save_template, template_name, tms_provider } = req.body;

  if (!job_id || !field_mapping || !raw_rows_token) {
    return res.status(400).json({ success: false, message: 'job_id, field_mapping, and raw_rows_token are required.' });
  }

  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;

    // Verify job belongs to this user
    const job = await getImportJob(pool, job_id, userId);
    if (!job) return res.status(404).json({ success: false, message: 'Import job not found.' });

    // Decode raw rows from token
    let rows;
    try {
      rows = JSON.parse(Buffer.from(raw_rows_token, 'base64').toString('utf8'));
    } catch {
      return res.status(422).json({ success: false, message: 'Invalid raw_rows_token — re-upload the file.' });
    }

    // Apply mapping → canonical vessel objects
    const mapped   = applyMapping(rows, field_mapping);
    // Validate each vessel
    const validated = validateAll(mapped);

    const validCount = validated.filter(v => v.validationStatus !== 'error').length;
    const errorCount = validated.filter(v => v.validationStatus === 'error').length;

    // Persist vessel records
    await insertVesselRecords(pool, job_id, userId, validated);

    // Update job with mapping + stats
    await updateImportJob(pool, job_id, {
      field_mapping,
      row_count:   rows.length,
      valid_count: validCount,
      error_count: errorCount,
      status:      'validated',
    });

    // Optionally save mapping template
    if (save_template && template_name) {
      await saveMappingTemplate(pool, userId, {
        templateName: template_name.trim(),
        tmsProvider:  tms_provider || null,
        fieldMapping: field_mapping,
      }).catch(err => console.error('[tms-import] template save error:', err.message));
    }

    return res.json({
      success:     true,
      job_id,
      row_count:   rows.length,
      valid_count: validCount,
      error_count: errorCount,
      vessels:     validated.map(v => ({
        row_number:          v.rowNumber,
        vessel_name:         v.vessel_name,
        imo_number:          v.imo_number,
        validation_status:   v.validationStatus,
        validation_errors:   v.validationErrors,
        validation_warnings: v.validationWarnings,
      })),
    });
  } catch (err) {
    console.error('[tms-import] validate error:', err.message);
    return res.status(500).json({ success: false, message: 'Validation failed — please try again.' });
  }
});

// ── GET /api/tms-import/jobs ───────────────────────────────────────────────
// Import history for the authenticated user.
router.get('/jobs', requireAuth, async (req, res) => {
  const pool   = req.app.locals.pool;
  const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    const jobs = await listImportJobs(pool, req.user.id, { limit, offset });
    return res.json({ success: true, jobs });
  } catch (err) {
    console.error('[tms-import] jobs list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load import history.' });
  }
});

// ── GET /api/tms-import/jobs/:id ──────────────────────────────────────────
// Full job detail with all vessel records.
router.get('/jobs/:id', requireAuth, async (req, res) => {
  const pool   = req.app.locals.pool;
  const jobId  = parseInt(req.params.id, 10);
  if (isNaN(jobId)) return res.status(400).json({ success: false, message: 'Invalid job ID.' });
  try {
    const job = await getImportJob(pool, jobId, req.user.id);
    if (!job) return res.status(404).json({ success: false, message: 'Import job not found.' });
    const records = await getVesselRecords(pool, jobId, req.user.id);
    return res.json({ success: true, job, records });
  } catch (err) {
    console.error('[tms-import] job detail error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load job.' });
  }
});

// ── GET /api/tms-import/jobs/:id/vessel/:rid ──────────────────────────────
// Single vessel record — used by filing wizard auto-fill.
router.get('/jobs/:id/vessel/:rid', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const rid  = parseInt(req.params.rid, 10);
  if (isNaN(rid)) return res.status(400).json({ success: false, message: 'Invalid record ID.' });
  try {
    const record = await getVesselRecord(pool, rid, req.user.id);
    if (!record) return res.status(404).json({ success: false, message: 'Vessel record not found.' });
    return res.json({ success: true, vessel: record });
  } catch (err) {
    console.error('[tms-import] vessel detail error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load vessel record.' });
  }
});

// ── GET /api/tms-import/templates ─────────────────────────────────────────
// Saved mapping templates for authenticated user.
router.get('/templates', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const templates = await getMappingTemplates(pool, req.user.id);
    return res.json({ success: true, templates });
  } catch (err) {
    console.error('[tms-import] templates list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load templates.' });
  }
});

// ── POST /api/tms-import/templates ────────────────────────────────────────
// Save or update a mapping template (upsert on user_id + template_name).
router.post('/templates', requireAuth, async (req, res) => {
  const { template_name, tms_provider, field_mapping } = req.body;
  if (!template_name || !field_mapping) {
    return res.status(400).json({ success: false, message: 'template_name and field_mapping are required.' });
  }
  const pool = req.app.locals.pool;
  try {
    const tpl = await saveMappingTemplate(pool, req.user.id, {
      templateName: template_name.trim(),
      tmsProvider:  tms_provider || null,
      fieldMapping: field_mapping,
    });
    return res.json({ success: true, template: tpl });
  } catch (err) {
    console.error('[tms-import] template save error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save template.' });
  }
});

// ── DELETE /api/tms-import/templates/:id ──────────────────────────────────
router.delete('/templates/:id', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const tid  = parseInt(req.params.id, 10);
  if (isNaN(tid)) return res.status(400).json({ success: false, message: 'Invalid template ID.' });
  try {
    await deleteMappingTemplate(pool, tid, req.user.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('[tms-import] template delete error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete template.' });
  }
});

module.exports = router;
