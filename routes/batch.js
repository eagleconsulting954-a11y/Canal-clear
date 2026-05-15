/**
 * routes/batch.js — Multi-vessel batch filing API
 *
 * Owns: all /api/batch/* endpoints for CSV upload, bulk validation,
 *   template download, results retrieval, and bulk export.
 * Does NOT own: validation logic (services/batch-validator.js),
 *   SQL (delegated to db/batch-jobs.js, db/bosporus-filings.js,
 *   db/malacca-filings.js, db/cape-filings.js; generic filings table
 *   still uses inline pool.query), PDF generation.
 *
 * Endpoints:
 *   GET  /api/batch/template/:waterway  — download CSV template for a waterway
 *   POST /api/batch/validate            — upload CSV, validate all rows, store batch_job
 *   GET  /api/batch/jobs                — list past batch jobs for current user
 *   GET  /api/batch/jobs/:id            — get full result_summary for a batch job
 *   GET  /api/batch/jobs/:id/export     — download batch results as CSV or XLSX
 *   POST /api/batch/jobs/:id/save       — save validated rows as individual filings
 */

'use strict';

const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const router  = express.Router();

const { requireAuth, requireSubscription } = require('../middleware/auth');
const { validateBatch, generateTemplate, SUPPORTED_WATERWAYS } = require('../services/batch-validator');
const { createBatchJob, listBatchJobs, getBatchJobById } = require('../db/batch-jobs');
const { createDraftFiling }    = require('../db/filings');
const { createSP1Filing }     = require('../db/bosporus-filings');
const { createMalaccaFiling } = require('../db/malacca-filings');
const { createCapeFiling }    = require('../db/cape-filings');

// Multer: in-memory storage, 5 MB limit, CSV/XLSX only
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(csv|xlsx)$/i.test(file.originalname) ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    cb(null, ok);
  },
});

// ── GET /api/batch/template/:waterway ─────────────────────────────────────────
// Download a CSV template with correct headers + one sample row.
// No auth required — useful for marketing and onboarding.

router.get('/template/:waterway', (req, res) => {
  const waterway = req.params.waterway.toLowerCase();
  if (!SUPPORTED_WATERWAYS.includes(waterway)) {
    return res.status(400).json({
      success: false,
      message: `Unsupported waterway "${waterway}". Valid: ${SUPPORTED_WATERWAYS.join(', ')}`,
    });
  }

  try {
    const csv      = generateTemplate(waterway);
    const filename = `canalclear-batch-template-${waterway}.csv`;
    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return res.send('\uFEFF' + csv); // BOM for Excel
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/batch/validate ──────────────────────────────────────────────────
// Upload a CSV or XLSX, validate all vessels, persist a batch_job record.
// Auth + subscription required.

router.post('/validate', requireAuth, requireSubscription, upload.single('file'), async (req, res) => {
  try {
    const pool     = req.app.locals.pool;
    const userId   = req.user.id;
    const waterway = (req.body.waterway || '').toLowerCase();
    const file     = req.file;

    if (!file) {
      return res.status(400).json({ success: false, message: 'No file uploaded. Send multipart/form-data with field "file".' });
    }
    if (!SUPPORTED_WATERWAYS.includes(waterway)) {
      return res.status(400).json({
        success: false,
        message: `Waterway required. Valid values: ${SUPPORTED_WATERWAYS.join(', ')}`,
      });
    }

    // Parse file into rows
    let rows;
    const ext = file.originalname.toLowerCase().split('.').pop();

    if (ext === 'xlsx') {
      const wb   = XLSX.read(file.buffer, { type: 'buffer' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      // CSV — parse manually using XLSX (handles BOM, quoting)
      const wb   = XLSX.read(file.buffer, { type: 'buffer' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'File is empty or has no data rows.' });
    }

    if (rows.length > 500) {
      return res.status(400).json({ success: false, message: 'Maximum 500 vessels per batch. Split into smaller files.' });
    }

    // Run batch validation
    const results = validateBatch(rows, waterway);

    // Compute summary stats
    const passCount = results.filter(r => r.overall_status === 'passed').length;
    const failCount = results.filter(r => r.overall_status === 'failed' || r.overall_status === 'error').length;
    const warnCount = results.filter(r => r.overall_status === 'warning').length;
    const avgScore  = results.length > 0
      ? Math.round(results.reduce((s, r) => s + (r.compliance_score || 0), 0) / results.length)
      : 0;

    // Strip checklist from stored result_summary (keep it lean; full checklists served on demand)
    const summary = results.map(r => ({
      row:              r.row,
      vessel_name:      r.vessel_name,
      imo_number:       r.imo_number,
      waterway:         r.waterway,
      compliance_score: r.compliance_score,
      overall_status:   r.overall_status,
      passed_checks:    r.passed_checks,
      failed_checks:    r.failed_checks,
      warning_checks:   r.warning_checks,
      critical_errors:  r.critical_errors,
      warnings:         r.warnings,
      error:            r.error,
      // Store normalized data so /save endpoint can create filings later
      normalized:       r.normalized,
    }));

    // Persist batch_job
    const job = await createBatchJob(pool, {
      user_id:        userId,
      waterway,
      filename:       file.originalname,
      row_count:      results.length,
      pass_count:     passCount,
      fail_count:     failCount,
      warn_count:     warnCount,
      avg_score:      avgScore,
      result_summary: summary,
    });

    return res.json({
      success:     true,
      job_id:      job.id,
      created_at:  job.created_at,
      waterway,
      filename:    file.originalname,
      row_count:   results.length,
      pass_count:  passCount,
      fail_count:  failCount,
      warn_count:  warnCount,
      avg_score:   avgScore,
      results:     summary,
    });
  } catch (err) {
    console.error('[Batch/Validate] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Batch validation failed: ' + err.message });
  }
});

// ── GET /api/batch/jobs ───────────────────────────────────────────────────────
// List past batch jobs for the authenticated user (newest first).

router.get('/jobs', requireAuth, requireSubscription, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit || '20', 10), 100);

    const rows = await listBatchJobs(pool, userId, { limit });

    return res.json({ success: true, jobs: rows });
  } catch (err) {
    console.error('[Batch/ListJobs] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list batch jobs: ' + err.message });
  }
});

// ── GET /api/batch/jobs/:id ───────────────────────────────────────────────────
// Get full result_summary for a batch job.

router.get('/jobs/:id', requireAuth, requireSubscription, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch job ID.' });
    }

    const job = await getBatchJobById(pool, id, userId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Batch job not found.' });
    }

    return res.json({ success: true, job });
  } catch (err) {
    console.error('[Batch/GetJob] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to get batch job: ' + err.message });
  }
});

// ── GET /api/batch/jobs/:id/export?format=csv|xlsx ───────────────────────────
// Export batch results as CSV or Excel.

router.get('/jobs/:id/export', requireAuth, requireSubscription, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);
    const format = (req.query.format || 'csv').toLowerCase();

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch job ID.' });
    }
    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Use format=csv or format=xlsx.' });
    }

    const job = await getBatchJobById(pool, id, userId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Batch job not found.' });
    }
    const summary = job.result_summary || [];
    const dateStr = new Date().toISOString().slice(0, 10);

    // Build flat export rows (omit normalized filing data)
    const exportRows = summary.map(r => ({
      'Row':              r.row,
      'Vessel Name':      r.vessel_name || '',
      'IMO Number':       r.imo_number || '',
      'Waterway':         r.waterway || '',
      'Status':           r.overall_status || '',
      'Compliance Score': r.compliance_score ?? '',
      'Passed Checks':    r.passed_checks ?? '',
      'Failed Checks':    r.failed_checks ?? '',
      'Warnings':         r.warning_checks ?? '',
      'Critical Issues':  (r.critical_errors || []).join('; '),
      'Warnings Detail':  (r.warnings || []).join('; '),
    }));

    if (format === 'csv') {
      // Manual CSV build
      const headers = Object.keys(exportRows[0] || {});
      const csvLines = [
        headers.join(','),
        ...exportRows.map(r =>
          headers.map(h => {
            const v = String(r[h] ?? '');
            return v.includes(',') || v.includes('"') || v.includes('\n')
              ? `"${v.replace(/"/g, '""')}"` : v;
          }).join(',')
        ),
      ];
      const filename = `canalclear-batch-${job.waterway}-${dateStr}.csv`;
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send('\uFEFF' + csvLines.join('\r\n'));
    }

    // XLSX
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Batch Results');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `canalclear-batch-${job.waterway}-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      buf.length,
    });
    return res.send(buf);
  } catch (err) {
    console.error('[Batch/Export] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ── POST /api/batch/jobs/:id/save ─────────────────────────────────────────────
// Save one or all validated rows from a batch job as individual waterway filings.
// Body: { row_indices: [0, 1, 2] } — if omitted, saves all passing rows.

router.post('/jobs/:id/save', requireAuth, requireSubscription, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid batch job ID.' });
    }

    const job = await getBatchJobById(pool, id, userId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Batch job not found.' });
    }
    const waterway = job.waterway;
    const summary  = job.result_summary || [];

    // Determine which rows to save
    let toSave = summary;
    if (req.body && Array.isArray(req.body.row_indices) && req.body.row_indices.length > 0) {
      toSave = req.body.row_indices
        .map(i => summary[i])
        .filter(Boolean);
    } else {
      // Default: save all rows that passed or warned (skip errors)
      toSave = summary.filter(r => r.overall_status !== 'error');
    }

    if (toSave.length === 0) {
      return res.json({ success: true, saved_count: 0, message: 'No eligible rows to save.' });
    }

    // Route to the correct filing table based on waterway
    const savedIds = [];
    for (const row of toSave) {
      if (!row.normalized) continue;
      const n = row.normalized;
      let insertResult;

      if (waterway === 'bosporus') {
        const created = await createSP1Filing(pool, {
          user_id:              userId,
          imo_number:           n.imo_number,
          vessel_name:          n.vessel_name,
          flag_state:           n.flag_state,
          vessel_type:          n.vessel_type,
          gross_tonnage:        n.gross_tonnage,
          net_tonnage:          n.net_tonnage,
          loa:                  n.loa,
          beam:                 n.beam,
          draft:                n.draft,
          transit_direction:    n.transit_direction,
          last_port:            n.last_port,
          next_port:            n.next_port,
          estimated_arrival:    n.estimated_arrival,
          cargo_type:           n.cargo_type,
          cargo_quantity:       n.cargo_quantity,
          dangerous_goods_class: n.dangerous_goods_class,
          crew_count:           n.crew_count,
          agent_name:           n.agent_name,
          agent_contact:        n.agent_contact,
          compliance_score:     row.compliance_score,
          filing_status:        'draft',
          document_data:        n.document_data || {},
        });
        insertResult = created ? { rows: [created] } : { rows: [] };
      } else if (waterway === 'malacca') {
        const created = await createMalaccaFiling(pool, {
          user_id:              userId,
          imo_number:           n.imo_number,
          vessel_name:          n.vessel_name,
          flag_state:           n.flag_state,
          vessel_type:          n.vessel_type,
          gross_tonnage:        n.gross_tonnage,
          net_tonnage:          n.net_tonnage,
          loa:                  n.loa,
          beam:                 n.beam,
          draft:                n.draft,
          transit_direction:    n.transit_direction,
          last_port:            n.last_port,
          next_port:            n.next_port,
          estimated_arrival:    n.estimated_arrival,
          cargo_type:           n.cargo_type,
          cargo_quantity:       n.cargo_quantity,
          dangerous_goods_class: n.dangerous_goods_class,
          crew_count:           n.crew_count,
          speed_knots:          n.speed_knots,
          vhf_watch:            n.vhf_watch,
          pilotage_booked:      n.pilotage_booked,
          isps_compliant:       n.isps_compliant,
          has_dangerous_goods:  n.has_dangerous_goods,
          compliance_score:     row.compliance_score,
          filing_status:        'draft',
          document_data:        n.document_data || {},
        });
        insertResult = created ? { rows: [created] } : { rows: [] };
      } else if (waterway === 'cape') {
        const created = await createCapeFiling(pool, {
          user_id:              userId,
          imo_number:           n.imo_number,
          vessel_name:          n.vessel_name,
          flag_state:           n.flag_state,
          vessel_type:          n.vessel_type,
          gross_tonnage:        n.gross_tonnage,
          loa:                  n.loa,
          beam:                 n.beam,
          draft:                n.draft,
          estimated_arrival:    n.estimated_arrival,
          port_of_origin:       n.port_of_origin,
          next_port:            n.next_port,
          cargo_summary:        n.cargo_summary,
          crew_count:           n.crew_count,
          isps_security_level:  n.isps_security_level || 1,
          has_dangerous_goods:  n.has_dangerous_goods || false,
          dangerous_goods_class: n.dangerous_goods_class || null,
          sso_name:             n.sso_name,
          sso_contact:          n.sso_contact,
          compliance_score:     row.compliance_score,
          filing_status:        'draft',
          document_data:        n.document_data || {},
        });
        insertResult = created ? { rows: [created] } : { rows: [] };
      } else {
        // Panama / Suez → generic filings table
        const created = await createDraftFiling(pool, {
          user_id: userId, canal: waterway,
          vessel_name: n.vessel_name, imo_number: n.imo_number,
          flag_state: n.flag_state, vessel_type: n.vessel_type,
          loa: n.loa, beam: n.beam, draft: n.draft,
          gross_tonnage: n.gross_tonnage,
        });
        insertResult = created ? { rows: [created] } : { rows: [] };
      }

      if (insertResult && insertResult.rows[0]) {
        savedIds.push(insertResult.rows[0].id);
      }
    }

    return res.json({
      success:     true,
      saved_count: savedIds.length,
      filing_ids:  savedIds,
      message:     `${savedIds.length} filing(s) created as drafts in your ${waterway} dashboard.`,
    });
  } catch (err) {
    console.error('[Batch/Save] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save filings: ' + err.message });
  }
});

module.exports = router;
