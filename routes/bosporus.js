/**
 * routes/bosporus.js — Bosporus / Turkish Straits SP-1 filing API
 *
 * Owns: all /api/bosporus/* endpoint handlers for SP-1 filings and VTSC submissions.
 * Does NOT own: validation logic (bosporus-validator.js), SQL (db/bosporus-filings.js),
 *               vessel lookup (vessel-lookup.js), auth middleware, or email delivery.
 *
 * Endpoints:
 *   POST   /api/bosporus/autofill               — IMO → pre-filled SP-1 form data
 *   POST   /api/bosporus/validate               — validate a filing payload, return score
 *   POST   /api/bosporus/filings                — create new SP-1 filing
 *   GET    /api/bosporus/filings                — list filings (auth, with filters)
 *   GET    /api/bosporus/filings/:id            — get filing details
 *   PUT    /api/bosporus/filings/:id            — update filing
 *   DELETE /api/bosporus/filings/:id            — soft-delete filing
 *   GET    /api/bosporus/filings/:id/pdf        — download SP-1 filing PDF (?type=sp1_pre_arrival|sp1_compliance_report|all)
 *   GET    /api/bosporus/filings/:id/export     — download CSV or Excel (?format=csv|xlsx)
 *   GET    /api/bosporus/filings/export         — bulk export all user filings (?format=csv|xlsx)
 *   POST   /api/bosporus/submit                 — send SP-1 to VTSC via email; logs submission
 *   GET    /api/bosporus/submissions            — list VTSC submission history
 *   GET    /api/bosporus/submissions/:id        — get single VTSC submission
 *   POST   /api/bosporus/submissions/:id/resubmit — resend a prior VTSC submission
 */

const express = require('express');
const router  = express.Router();

const { validateSP1Filing, calculateDeadlines } = require('../services/bosporus-validator');
const { lookupByIMO }                           = require('../services/vessel-lookup');
const {
  createSP1Filing,
  getSP1FilingById,
  listSP1Filings,
  updateSP1Filing,
  deleteSP1Filing,
  getRecentSP1FilingsForDashboard,
} = require('../db/bosporus-filings');
const { requireAuth, requireWaterway }          = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');
const { requireAgencyVesselCapacity }           = require('../services/vessel-limit-service');
const {
  upsertDeadline,
  updateDeadlineForFiling,
  disableDeadlineForFiling,
} = require('../db/filing-deadlines');

// Waterway guard for all authenticated Bosporus filing endpoints
const requireBosporus = requireWaterway('bosporus');
const { generateBosporusPDF, ALL_DOC_TYPES }   = require('../services/bosporus-sp1-pdf');
const { sp1FilingsToCSV, sp1FilingsToXLSX }    = require('../services/filing-export');
const { sendSP1ToVTSC, generateVtscReference, VTSC_CONTACTS } = require('../services/vtsc-portal');
const vtscDb = require('../db/vtsc-portal');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bosporus/autofill
// IMO → pre-filled SP-1 form data (no auth required — used in demo and live form)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/autofill', async (req, res) => {
  try {
    const { imo } = req.body;
    if (!imo) {
      return res.status(400).json({ success: false, message: 'IMO number is required.' });
    }

    const vessel = lookupByIMO(imo);
    if (!vessel) {
      // IMO not in local DB — return empty template so user can fill manually
      return res.json({
        success: true,
        found: false,
        message: 'Vessel not found in database. Please fill in vessel details manually.',
        data: { imo_number: imo.replace(/^IMO\s*/i, '').trim() },
      });
    }

    // Map vessel-lookup fields to SP-1 form fields
    const prefilled = {
      imo_number:    vessel.imo,
      vessel_name:   vessel.name,
      flag_state:    vessel.flag,
      call_sign:     vessel.callsign,
      mmsi:          vessel.mmsi,
      vessel_type:   vessel.type,
      gross_tonnage: vessel.gt,
      net_tonnage:   vessel.nt,
      loa:           vessel.loa,
      beam:          vessel.beam,
      draft:         vessel.draft,
      // Transit-specific fields left blank for user input
      transit_direction: null,
      last_port:         null,
      next_port:         null,
      estimated_arrival: null,
      cargo_type:        null,
      cargo_quantity:    null,
      dangerous_goods_class: null,
      crew_count:        null,
      passenger_count:   0,
      agent_name:        null,
      agent_contact:     null,
    };

    return res.json({ success: true, found: true, data: prefilled });
  } catch (err) {
    console.error('[Bosporus/Autofill] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Autofill failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bosporus/validate
// Validate a SP-1 filing payload — returns compliance score and checklist.
// No auth required — used from demo and live form preview.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/validate', async (req, res) => {
  try {
    const filing = req.body;
    if (!filing || typeof filing !== 'object') {
      return res.status(400).json({ success: false, message: 'Filing data required in request body.' });
    }

    const result = validateSP1Filing(filing);

    // Include deadline info if estimated_arrival provided
    const deadlines = filing.estimated_arrival
      ? calculateDeadlines(filing.estimated_arrival)
      : null;

    return res.json({
      success:          true,
      canal:            'bosporus',
      overall_status:   result.overall_status,
      compliance_score: result.compliance_score,
      total_checks:     result.total_checks,
      passed_checks:    result.passed_checks,
      failed_checks:    result.failed_checks,
      warning_checks:   result.warning_checks,
      checklist:        result.checklist,
      critical_errors:  result.critical_errors,
      warnings_list:    result.warnings_list,
      passed_list:      result.passed_list,
      deadlines,
    });
  } catch (err) {
    console.error('[Bosporus/Validate] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Validation failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bosporus/filings
// Create a new SP-1 filing. Auth required.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/filings', attachDemoSession, requireAuthOrDemo, requireBosporus, requireAgencyVesselCapacity, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const body   = req.body;

    // Run validation to get compliance score
    const validation = validateSP1Filing(body);

    // Compute deadlines
    const deadlines = body.estimated_arrival
      ? calculateDeadlines(body.estimated_arrival)
      : {};

    const filing = await createSP1Filing(pool, {
      user_id:           userId,
      imo_number:        body.imo_number,
      vessel_name:       body.vessel_name,
      flag_state:        body.flag_state,
      call_sign:         body.call_sign,
      mmsi:              body.mmsi,
      vessel_type:       body.vessel_type,
      gross_tonnage:     body.gross_tonnage,
      net_tonnage:       body.net_tonnage,
      loa:               body.loa,
      beam:              body.beam,
      draft:             body.draft,
      transit_direction: body.transit_direction,
      last_port:         body.last_port,
      next_port:         body.next_port,
      estimated_arrival: body.estimated_arrival,
      cargo_type:        body.cargo_type,
      cargo_quantity:    body.cargo_quantity,
      dangerous_goods_class: body.dangerous_goods_class,
      crew_count:        body.crew_count,
      passenger_count:   body.passenger_count,
      agent_name:        body.agent_name,
      agent_contact:     body.agent_contact,
      insurance_details: body.insurance_details,
      pi_club:           body.pi_club,
      compliance_score:  validation.compliance_score,
      filing_status:     body.filing_status || 'draft',
      document_data:     body.document_data || {},
      deadline_24h:      deadlines?.deadline_24h || null,
      deadline_48h:      deadlines?.deadline_48h || null,
    });

    // Register deadline alert — SP-1 must be submitted 48h before ETA
    if (body.estimated_arrival && filing.id) {
      try {
        const eta = new Date(body.estimated_arrival);
        const deadlineAt = new Date(eta.getTime() - 48 * 60 * 60 * 1000).toISOString();
        const issues = (validation.critical_errors || []).concat(validation.warnings || []).slice(0, 5).map(c => c.message || c);
        await upsertDeadline(pool, {
          userId,
          waterway: 'bosporus',
          filingType: 'SP-1 Pre-Arrival',
          vesselName: body.vessel_name || 'Unknown Vessel',
          imoNumber:  body.imo_number || null,
          deadlineAt,
          filingId:   filing.id,
          filingUrl:  `/demo/bosporus`,
          complianceIssues: issues,
        });
      } catch (dlErr) {
        // Non-fatal — filing saved, deadline registration failed silently
        console.error('[Bosporus/CreateFiling] Deadline registration failed:', dlErr.message);
      }
    }

    return res.status(201).json({
      success:          true,
      filing,
      validation_result: {
        overall_status:   validation.overall_status,
        compliance_score: validation.compliance_score,
        failed_checks:    validation.failed_checks,
        warning_checks:   validation.warning_checks,
      },
    });
  } catch (err) {
    console.error('[Bosporus/CreateFiling] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create filing: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/filings
// List SP-1 filings. Auth required.
// Query params: status, imo_number, date_from, date_to, limit, offset
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.is_admin ? undefined : req.user.id;  // admins see all

    const { status, imo_number, date_from, date_to } = req.query;
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    const { rows, total } = await listSP1Filings(pool, {
      userId,
      status,
      imoNumber:  imo_number,
      dateFrom:   date_from,
      dateTo:     date_to,
      limit,
      offset,
    });

    return res.json({ success: true, filings: rows, total, limit, offset });
  } catch (err) {
    console.error('[Bosporus/ListFilings] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list filings: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/filings/:id
// Get a single SP-1 filing. Auth required.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const id     = parseInt(req.params.id, 10);
    const userId = req.user.is_admin ? null : req.user.id;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const filing = await getSP1FilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    // Include fresh deadline info
    const deadlines = filing.estimated_arrival
      ? calculateDeadlines(filing.estimated_arrival)
      : null;

    return res.json({ success: true, filing, deadlines });
  } catch (err) {
    console.error('[Bosporus/GetFiling] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to get filing: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/bosporus/filings/:id
// Update a SP-1 filing. Auth required. Re-validates on update.
// ─────────────────────────────────────────────────────────────────────────────

router.put('/filings/:id', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const id     = parseInt(req.params.id, 10);
    const userId = req.user.is_admin ? null : req.user.id;
    const body   = req.body;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    // Fetch existing filing to merge for re-validation
    const existing = await getSP1FilingById(pool, id, userId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    // Merge existing + incoming for a full re-validation
    const merged = { ...existing, ...body };

    // Re-run validation on merged state
    const validation = validateSP1Filing(merged);

    // Recompute deadlines if estimated_arrival changed
    const arrivalForDeadlines = body.estimated_arrival || existing.estimated_arrival;
    const deadlines = arrivalForDeadlines ? calculateDeadlines(arrivalForDeadlines) : {};

    // Inject computed fields
    const updateFields = {
      ...body,
      compliance_score: validation.compliance_score,
      deadline_24h:     deadlines?.deadline_24h || existing.deadline_24h,
      deadline_48h:     deadlines?.deadline_48h || existing.deadline_48h,
    };

    // Set submitted_at if status is transitioning to 'submitted'
    if (body.filing_status === 'submitted' && existing.filing_status !== 'submitted') {
      updateFields.submitted_at = new Date().toISOString();
    }

    const updated = await updateSP1Filing(pool, id, updateFields, userId);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Filing not found or update failed.' });
    }

    // Update deadline alert when ETA changes
    const updatedArrival = body.estimated_arrival || existing.estimated_arrival;
    if (updatedArrival && updated && updated.id) {
      try {
        const eta = new Date(updatedArrival);
        const deadlineAt = new Date(eta.getTime() - 48 * 60 * 60 * 1000).toISOString();
        const issues = (validation.critical_errors || []).concat(validation.warnings || []).slice(0, 5).map(c => c.message || c);
        const patched = await updateDeadlineForFiling(pool, {
          filingId: updated.id,
          userId:   req.user.id,
          waterway: 'bosporus',
          deadlineAt,
          complianceIssues: issues,
        });
        // If no existing deadline row (first time edit with ETA), create one
        if (!patched) {
          await upsertDeadline(pool, {
            userId:   req.user.id,
            waterway: 'bosporus',
            filingType: 'SP-1 Pre-Arrival',
            vesselName: updated.vessel_name || body.vessel_name || 'Unknown Vessel',
            imoNumber:  updated.imo_number  || body.imo_number  || null,
            deadlineAt,
            filingId:   updated.id,
            filingUrl:  `/demo/bosporus`,
            complianceIssues: issues,
          });
        }
      } catch (dlErr) {
        console.error('[Bosporus/UpdateFiling] Deadline update failed:', dlErr.message);
      }
    }

    return res.json({
      success: true,
      filing:  updated,
      validation_result: {
        overall_status:   validation.overall_status,
        compliance_score: validation.compliance_score,
        failed_checks:    validation.failed_checks,
        warning_checks:   validation.warning_checks,
        critical_errors:  validation.critical_errors,
      },
    });
  } catch (err) {
    console.error('[Bosporus/UpdateFiling] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update filing: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/bosporus/filings/:id
// Soft-delete a SP-1 filing. Auth required.
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/filings/:id', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const id     = parseInt(req.params.id, 10);
    const userId = req.user.is_admin ? null : req.user.id;

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const deleted = await deleteSP1Filing(pool, id, userId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    // Disable deadline alerts for this filing (non-fatal)
    try {
      await disableDeadlineForFiling(pool, { filingId: id, userId, waterway: 'bosporus' });
    } catch (dlErr) {
      console.error('[Bosporus/DeleteFiling] Deadline disable failed:', dlErr.message);
    }

    return res.json({ success: true, message: 'Filing deleted.' });
  } catch (err) {
    console.error('[Bosporus/DeleteFiling] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete filing: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/dashboard
// Recent SP-1 filings for dashboard widget (admin only).
// ─────────────────────────────────────────────────────────────────────────────

router.get('/dashboard', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const rows = await getRecentSP1FilingsForDashboard(pool);
    return res.json({ success: true, filings: rows });
  } catch (err) {
    console.error('[Bosporus/Dashboard] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Dashboard query failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/filings/:id/pdf?type=[sp1_pre_arrival|sp1_compliance_report|all]
//
// Generate and stream a PDF for a single SP-1 filing.
// Auth required. Users can only download their own filings.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/pdf', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool    = req.app.locals.pool;
    const userId  = req.user.id;
    const id      = parseInt(req.params.id, 10);
    const docType = (req.query.type || 'all').trim().toLowerCase();

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    // Validate docType
    if (docType !== 'all' && !ALL_DOC_TYPES.includes(docType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type "${docType}". Valid types: ${ALL_DOC_TYPES.join(', ')}, all`,
      });
    }

    const filing = await getSP1FilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const pdfBuffer = await generateBosporusPDF(filing, docType);

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const filename   = `canalclear-bosporus-${vesselSlug}-${docType}-${String(id).padStart(6,'0')}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
      'Cache-Control':       'no-store',
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[Bosporus/PDF] Error:', err.message);
    return res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/filings/:id/pdf/types
//
// List available PDF document types for a filing (for the download button UI).
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/pdf/types', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const filing = await getSP1FilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const { DOC_META } = require('../services/bosporus-sp1-pdf');
    const base = `/api/bosporus/filings/${id}/pdf`;

    const document_types = ALL_DOC_TYPES.map(type => ({
      type,
      title:    DOC_META[type].title,
      subtitle: DOC_META[type].subtitle,
      form_ref: DOC_META[type].form,
      url:      `${base}?type=${type}`,
    }));

    return res.json({
      success: true,
      document_types,
      combined_url: `${base}?type=all`,
    });
  } catch (err) {
    console.error('[Bosporus/PDFTypes] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list PDF types: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/filings/:id/export?format=csv|xlsx
//
// Export a single SP-1 filing as CSV or Excel.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/export', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);
    const format = (req.query.format || 'csv').trim().toLowerCase();

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }
    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use csv or xlsx.' });
    }

    const filing = await getSP1FilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const dateStr    = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csv      = sp1FilingsToCSV([filing]);
      const filename = `canalclear-bosporus-${vesselSlug}-${dateStr}.csv`;
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send('\uFEFF' + csv); // BOM for Excel compatibility
    }

    // xlsx
    const xlsxBuf = sp1FilingsToXLSX([filing]);
    const filename = `canalclear-bosporus-${vesselSlug}-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Bosporus/ExportOne] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/export?format=csv|xlsx
//
// Bulk export all SP-1 filings for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/export', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const format = (req.query.format || 'csv').trim().toLowerCase();

    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use csv or xlsx.' });
    }

    const { rows: filings } = await listSP1Filings(pool, { userId, limit: 5000 });
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csv      = sp1FilingsToCSV(filings);
      const filename = `canalclear-bosporus-all-${dateStr}.csv`;
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send('\uFEFF' + csv);
    }

    const xlsxBuf = sp1FilingsToXLSX(filings);
    const filename = `canalclear-bosporus-all-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Bosporus/ExportAll] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bosporus/submit
//
// Send SP-1 pre-arrival notification to Turkish Straits VTS Center via email.
// Body: { filing_id?, vessel_name, imo_number?, transit_direction?, vts_center? }
//   vts_center: 'istanbul' (default) | 'canakkale' | 'both'
//
// If filing_id provided, enriches from stored filing data.
// Always sends via Polsia email proxy; logs to vtsc_submissions + audit trail.
// Updates filing status to 'submitted' if filing_id provided.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/submit', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool  = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, vessel_name, imo_number, transit_direction, vts_center } = req.body;

    if (!vessel_name && !filing_id) {
      return res.status(400).json({ success: false, message: 'vessel_name or filing_id is required.' });
    }

    // Resolve VTS center (default: istanbul)
    const vtsCenterKey = ['istanbul', 'canakkale', 'both'].includes(vts_center) ? vts_center : 'istanbul';

    // Load filing data for email enrichment
    let filingData = { vessel_name, imo_number, transit_direction };
    let resolvedFilingId = filing_id || null;

    if (filing_id) {
      const existing = await getSP1FilingById(pool, parseInt(filing_id, 10), userId);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Filing not found.' });
      }
      filingData = { ...existing, ...req.body };
      resolvedFilingId = existing.id;
    }

    // Send the SP-1 email to VTSC
    const result = await sendSP1ToVTSC(filingData, vtsCenterKey);

    // Store submission record regardless of email outcome
    const status = result.success ? 'submitted' : 'error';
    const submission = await vtscDb.createVtscSubmission(pool, {
      userId,
      filingId: resolvedFilingId,
      vesselName: (filingData.vessel_name || '').trim(),
      imoNumber: filingData.imo_number || null,
      transitDirection: filingData.transit_direction || null,
      vtsCenter: vtsCenterKey,
      recipientEmail: result.recipientEmail,
      emailSubject: result.success ? `SP-1 — ${filingData.vessel_name}` : '(send failed)',
      messageHash: result.messageHash || '',
      status,
      vtscReference: result.vtscRef,
      errorMessage: result.error || null,
    });

    // Update filing status to 'submitted' if we have a filing_id and email succeeded
    if (resolvedFilingId && result.success) {
      try {
        await updateSP1Filing(pool, resolvedFilingId, {
          filing_status: 'submitted',
          submitted_at: new Date().toISOString(),
        }, userId);
      } catch (e) { /* non-fatal — submission record already saved */ }
    }

    // Write audit log entry
    if (resolvedFilingId) {
      try {
        const vtscName = vtsCenterKey === 'both'
          ? 'Istanbul VTS + Çanakkale VTS'
          : VTSC_CONTACTS[vtsCenterKey]?.name || vtsCenterKey;
        await vtscDb.writeVtscAuditEntry(
          pool, resolvedFilingId, `user:${userId}`,
          result.success ? 'submitted_to_vtsc' : 'vtsc_submit_failed',
          result.success
            ? `SP-1 emailed to ${vtscName} — ref: ${result.vtscRef}`
            : `SP-1 email to ${vtscName} failed: ${result.error}`
        );
      } catch (e) { /* audit log write is best-effort */ }
    }

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: `Failed to send SP-1 email to VTSC: ${result.error}`,
        vtsc_reference: result.vtscRef,
        submission: submission.rows[0],
      });
    }

    return res.json({
      success: true,
      message: `SP-1 sent to ${VTSC_CONTACTS[vtsCenterKey === 'both' ? 'istanbul' : vtsCenterKey]?.name || 'Turkish VTS'}. Any changes must be reported immediately via the same channel.`,
      vtsc_reference: result.vtscRef,
      recipient_email: result.recipientEmail,
      vts_center: vtsCenterKey,
      submission: submission.rows[0],
      important_note: 'If vessel particulars (ETA, cargo, draft) change, re-submit updated SP-1 immediately to the same VTS Center.',
    });
  } catch (err) {
    console.error('[Bosporus/Submit] Error:', err.message);
    return res.status(500).json({ success: false, message: 'SP-1 submission failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/submissions
// List VTSC submission history for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/submissions', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const offset = parseInt(req.query.offset || '0', 10);

    const rows  = await vtscDb.listVtscSubmissions(pool, userId, limit, offset);
    const total = await vtscDb.countVtscSubmissions(pool, userId);

    return res.json({
      success: true,
      submissions: rows.rows,
      total: parseInt(total.rows[0].count, 10),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[Bosporus/Submissions] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list submissions: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/bosporus/submissions/:id
// Get a single VTSC submission.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/submissions/:id', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid submission ID.' });
    }

    const result = await vtscDb.getVtscSubmission(pool, id, userId);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    return res.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error('[Bosporus/GetSubmission] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to get submission: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/bosporus/submissions/:id/resubmit
// Re-send a prior VTSC submission (new email, new reference number).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/submissions/:id/resubmit', attachDemoSession, requireAuthOrDemo, requireBosporus, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid submission ID.' });
    }

    const existing = await vtscDb.getVtscSubmissionForResubmit(pool, id, userId);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    const orig = existing.rows[0];

    // Re-load the filing if available
    let filingData = { vessel_name: orig.vessel_name, imo_number: orig.imo_number, transit_direction: orig.transit_direction };
    if (orig.filing_id) {
      try {
        const f = await getSP1FilingById(pool, orig.filing_id, userId);
        if (f) filingData = { ...f };
      } catch (e) { /* fall back to stored meta */ }
    }

    const vtsCenterKey = orig.vts_center || 'istanbul';
    const result = await sendSP1ToVTSC(filingData, vtsCenterKey);

    const newSub = await vtscDb.createVtscSubmission(pool, {
      userId,
      filingId: orig.filing_id,
      vesselName: orig.vessel_name,
      imoNumber: orig.imo_number,
      transitDirection: orig.transit_direction,
      vtsCenter: vtsCenterKey,
      recipientEmail: result.recipientEmail,
      emailSubject: result.success ? `SP-1 Resubmission — ${orig.vessel_name}` : '(send failed)',
      messageHash: result.messageHash || '',
      status: result.success ? 'submitted' : 'error',
      vtscReference: result.vtscRef,
      errorMessage: result.error || null,
    });

    if (orig.filing_id) {
      try {
        await vtscDb.writeVtscAuditEntry(
          pool, orig.filing_id, `user:${userId}`,
          result.success ? 'resubmitted_to_vtsc' : 'vtsc_resubmit_failed',
          result.success
            ? `SP-1 resubmitted to VTSC — new ref: ${result.vtscRef}, original: ${orig.vtsc_reference || 'unknown'}`
            : `SP-1 resubmit failed: ${result.error}`
        );
      } catch (e) { /* best-effort */ }
    }

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: `Resubmission email failed: ${result.error}`,
        submission: newSub.rows[0],
      });
    }

    return res.json({
      success: true,
      message: `SP-1 resubmitted — new reference: ${result.vtscRef}`,
      vtsc_reference: result.vtscRef,
      submission: newSub.rows[0],
    });
  } catch (err) {
    console.error('[Bosporus/Resubmit] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Resubmission failed: ' + err.message });
  }
});

module.exports = router;
