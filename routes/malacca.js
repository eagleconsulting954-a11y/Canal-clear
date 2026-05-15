/**
 * routes/malacca.js — Strait of Malacca STRAITREP filing API
 *
 * Owns: all /api/malacca/* endpoint handlers for STRAITREP filings.
 * Does NOT own: validation logic (malacca-validator.js), SQL (db/malacca-filings.js),
 *               vessel lookup (vessel-lookup.js), or auth middleware.
 *
 * Endpoints:
 *   POST   /api/malacca/autofill               — IMO → pre-filled STRAITREP form data
 *   POST   /api/malacca/validate               — validate filing payload, return score
 *   POST   /api/malacca/filings                — create new STRAITREP filing (auth)
 *   GET    /api/malacca/filings                — list filings (auth)
 *   GET    /api/malacca/filings/export         — bulk export all filings (auth)
 *   GET    /api/malacca/filings/:id            — get filing details (auth)
 *   PUT    /api/malacca/filings/:id            — update filing (auth)
 *   DELETE /api/malacca/filings/:id            — soft-delete filing (auth)
 *   GET    /api/malacca/filings/:id/pdf        — download STRAITREP filing PDF (auth)
 *   GET    /api/malacca/filings/:id/pdf/types  — list available PDF types (auth)
 *   GET    /api/malacca/filings/:id/export     — download CSV or Excel (auth)
 */

const express = require('express');
const router  = express.Router();

const { validateMalaccaFiling }  = require('../services/malacca-validator');
const { lookupByIMO, validateIMOChecksum } = require('../services/vessel-lookup');
const {
  createMalaccaFiling,
  getMalaccaFilingById,
  listMalaccaFilings,
  updateMalaccaFiling,
  deleteMalaccaFiling,
} = require('../db/malacca-filings');
const { requireAuth, requireWaterway } = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');
const { requireAgencyVesselCapacity }  = require('../services/vessel-limit-service');
const {
  upsertDeadline,
  updateDeadlineForFiling,
  disableDeadlineForFiling,
} = require('../db/filing-deadlines');
const { generateMalaccaPDF, ALL_DOC_TYPES, DOC_META } = require('../services/malacca-pdf-generator');
const { malaccaFilingsToCSV, malaccaFilingsToXLSX }    = require('../services/filing-export');

// Waterway guard for all authenticated Malacca filing endpoints
const requireMalacca = requireWaterway('malacca');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/malacca/autofill
// IMO → pre-filled STRAITREP form data (no auth — used in demo and live form)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/autofill', (req, res) => {
  try {
    const raw = (req.body.imo || '').toString().trim();
    const imo = raw.replace(/^IMO\s*/i, '').trim();

    if (!imo) {
      return res.status(400).json({ success: false, message: 'IMO number is required.' });
    }

    if (!validateIMOChecksum(imo)) {
      return res.status(400).json({ success: false, message: 'Invalid IMO checksum. Please verify the number.' });
    }

    const vessel = lookupByIMO(imo);
    if (!vessel) {
      return res.json({
        success: true,
        found: false,
        message: 'Vessel not found in database. Please fill in vessel details manually.',
        data: { imo_number: imo },
      });
    }

    // Map vessel-lookup fields to STRAITREP form fields
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
      speed_knots:       null,
      cargo_type:        null,
      cargo_quantity:    null,
      has_dangerous_goods: false,
      dangerous_goods_class: null,
    };

    return res.json({
      success: true,
      found: true,
      vessel: {
        imo:  vessel.imo,
        name: vessel.name,
        flag: vessel.flag,
        type: vessel.type,
        gt:   vessel.gt,
        nt:   vessel.nt,
        loa:  vessel.loa,
        beam: vessel.beam,
        draft: vessel.draft,
        callsign: vessel.callsign,
        mmsi:     vessel.mmsi,
      },
      data: prefilled,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Autofill error: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/malacca/validate
// Validate a STRAITREP filing payload — no auth required (used in demo)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/validate', (req, res) => {
  try {
    const result = validateMalaccaFiling(req.body);
    return res.json({ success: true, validation: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation error: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/malacca/filings — create filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/filings', attachDemoSession, requireAuthOrDemo, requireMalacca, requireAgencyVesselCapacity, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const data = req.body;

    // Run validation to get compliance score
    const validation = validateMalaccaFiling(data);

    const filing = await createMalaccaFiling(pool, {
      ...data,
      user_id: userId,
      compliance_score: validation.compliance_score,
    });

    // Register deadline alert — STRAITREP must be submitted 24h before ETA
    if (data.estimated_arrival && filing && filing.id) {
      try {
        const eta = new Date(data.estimated_arrival);
        const deadlineAt = new Date(eta.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const issues = (validation.failed_checks || []).slice(0, 5).map(c => c.message || c);
        await upsertDeadline(pool, {
          userId,
          waterway: 'malacca',
          filingType: 'STRAITREP Filing',
          vesselName: data.vessel_name || 'Unknown Vessel',
          imoNumber:  data.imo_number || null,
          deadlineAt,
          filingId:   filing.id,
          filingUrl:  `/demo/malacca`,
          complianceIssues: issues,
        });
      } catch (dlErr) {
        console.error('[Malacca/CreateFiling] Deadline registration failed:', dlErr.message);
      }
    }

    return res.status(201).json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings — list filings (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const filings = await listMalaccaFilings(pool, userId, { limit, offset });
    return res.json({ success: true, filings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/:id — get single filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/export?format=csv|xlsx
//
// Bulk export all STRAITREP filings for the authenticated user.
// Defined BEFORE /filings/:id so Express doesn't match "export" as an :id.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/export', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const format = (req.query.format || 'csv').trim().toLowerCase();

    if (!['csv', 'xlsx'].includes(format)) {
      return res.status(400).json({ success: false, message: 'Invalid format. Use csv or xlsx.' });
    }

    const filings = await listMalaccaFilings(pool, userId, { limit: 5000 });
    const dateStr = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csv      = malaccaFilingsToCSV(filings);
      const filename = `canalclear-malacca-all-${dateStr}.csv`;
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send('\uFEFF' + csv); // BOM for Excel compatibility
    }

    const xlsxBuf = malaccaFilingsToXLSX(filings);
    const filename = `canalclear-malacca-all-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Malacca/ExportAll] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/:id — filing details (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filing = await getMalaccaFilingById(pool, req.params.id, userId);

    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });
    return res.json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/malacca/filings/:id — update filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/filings/:id', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const data   = req.body;

    // Re-validate to refresh compliance score
    const validation = validateMalaccaFiling(data);
    data.compliance_score = validation.compliance_score;

    const filing = await updateMalaccaFiling(pool, req.params.id, userId, data);
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });

    // Update deadline alert when ETA changes
    if (data.estimated_arrival && filing.id) {
      try {
        const eta = new Date(data.estimated_arrival);
        const deadlineAt = new Date(eta.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const issues = (validation.failed_checks || []).slice(0, 5).map(c => c.message || c);
        const patched = await updateDeadlineForFiling(pool, {
          filingId: filing.id,
          userId,
          waterway: 'malacca',
          deadlineAt,
          complianceIssues: issues,
        });
        if (!patched) {
          await upsertDeadline(pool, {
            userId,
            waterway: 'malacca',
            filingType: 'STRAITREP Filing',
            vesselName: filing.vessel_name || data.vessel_name || 'Unknown Vessel',
            imoNumber:  filing.imo_number  || data.imo_number  || null,
            deadlineAt,
            filingId:   filing.id,
            filingUrl:  `/demo/malacca`,
            complianceIssues: issues,
          });
        }
      } catch (dlErr) {
        console.error('[Malacca/UpdateFiling] Deadline update failed:', dlErr.message);
      }
    }

    return res.json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/malacca/filings/:id — soft-delete filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/filings/:id', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filingId = parseInt(req.params.id, 10);
    const result = await deleteMalaccaFiling(pool, filingId, userId);

    if (!result) return res.status(404).json({ success: false, message: 'Filing not found.' });

    // Disable deadline alerts for this filing (non-fatal)
    try {
      await disableDeadlineForFiling(pool, { filingId, userId, waterway: 'malacca' });
    } catch (dlErr) {
      console.error('[Malacca/DeleteFiling] Deadline disable failed:', dlErr.message);
    }

    return res.json({ success: true, message: 'Filing deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/:id/pdf?type=[straitrep_notification|marpol_compliance|all]
//
// Download a STRAITREP filing as a PDF document.
// Auth required. Users can only download their own filings.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/pdf', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
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

    const filing = await getMalaccaFilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const pdfBuffer = await generateMalaccaPDF(filing, docType);

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const filename   = `canalclear-malacca-${vesselSlug}-${docType}-${String(id).padStart(6, '0')}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
      'Cache-Control':       'no-store',
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[Malacca/PDF] Error:', err.message);
    return res.status(500).json({ success: false, message: 'PDF generation failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/:id/pdf/types
//
// List available PDF document types for a filing (for the download button UI).
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/pdf/types', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid filing ID.' });
    }

    const filing = await getMalaccaFilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const base = `/api/malacca/filings/${id}/pdf`;

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
    console.error('[Malacca/PDFTypes] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list PDF types: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/malacca/filings/:id/export?format=csv|xlsx
//
// Export a single STRAITREP filing as CSV or Excel.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/export', attachDemoSession, requireAuthOrDemo, requireMalacca, async (req, res) => {
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

    const filing = await getMalaccaFilingById(pool, id, userId);
    if (!filing) {
      return res.status(404).json({ success: false, message: 'Filing not found.' });
    }

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    const dateStr    = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const csv      = malaccaFilingsToCSV([filing]);
      const filename = `canalclear-malacca-${vesselSlug}-${dateStr}.csv`;
      res.set({
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      return res.send('\uFEFF' + csv); // BOM for Excel compatibility
    }

    // xlsx
    const xlsxBuf = malaccaFilingsToXLSX([filing]);
    const filename = `canalclear-malacca-${vesselSlug}-${dateStr}.xlsx`;
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      xlsxBuf.length,
    });
    return res.send(xlsxBuf);
  } catch (err) {
    console.error('[Malacca/ExportOne] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Export failed: ' + err.message });
  }
});

module.exports = router;
