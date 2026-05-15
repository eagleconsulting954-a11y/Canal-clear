/**
 * routes/cape.js — Cape of Good Hope ISPS pre-arrival filing API
 *
 * Owns: all /api/cape/* endpoint handlers for SAMSA ISPS pre-arrival filings.
 * Does NOT own: validation logic (cape-validator.js), SQL (db/cape-filings.js),
 *               vessel lookup (vessel-lookup.js), PDF generation, or auth middleware.
 *
 * Endpoints:
 *   POST   /api/cape/autofill                    — IMO → pre-filled ISPS form data
 *   POST   /api/cape/validate                    — validate ISPS payload, return score
 *   POST   /api/cape/filings                     — create new ISPS filing (auth)
 *   GET    /api/cape/filings                     — list filings (auth)
 *   GET    /api/cape/filings/export              — bulk CSV export (auth)
 *   GET    /api/cape/filings/:id                 — get filing details (auth)
 *   GET    /api/cape/filings/:id/pdf             — PDF download (auth)
 *   GET    /api/cape/filings/:id/export          — single-filing CSV/xlsx (auth)
 *   PUT    /api/cape/filings/:id                 — update filing (auth)
 *   DELETE /api/cape/filings/:id                 — soft-delete filing (auth)
 *   POST   /api/cape/submit                      — send ISPS to Cape Town Radio (auth)
 *   GET    /api/cape/submissions                 — list SAMSA submission history (auth)
 *   GET    /api/cape/submissions/:id             — get single submission (auth)
 *   POST   /api/cape/submissions/:id/resubmit    — resubmit to Cape Town Radio (auth)
 */

const express = require('express');
const router  = express.Router();

const { validateCapeFiling }             = require('../services/cape-validator');
const { generateCapeISPSPDF }            = require('../services/cape-pdf-generator');
const { capeFilingsToCSV, capeFilingsToXLSX } = require('../services/filing-export');
const { lookupByIMO, validateIMOChecksum }     = require('../services/vessel-lookup');
const {
  createCapeFiling,
  getCapeFilingById,
  listCapeFilings,
  updateCapeFiling,
  deleteCapeFiling,
} = require('../db/cape-filings');
const { requireAuth }                   = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');
const { requireAgencyVesselCapacity }   = require('../services/vessel-limit-service');
const { recordValidation }              = require('../db/validations');
const {
  upsertDeadline,
  updateDeadlineForFiling,
  disableDeadlineForFiling,
} = require('../db/filing-deadlines');
const { sendISPSToCapeRadio }           = require('../services/samsa-portal');
const samsaDb                           = require('../db/samsa-portal');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cape/autofill
// IMO → pre-filled ISPS form data (no auth — used in demo and live form)
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
      // ISPS-specific fields left blank for user input
      port_of_origin:         null,
      next_port:              null,
      estimated_arrival:      null,
      cargo_summary:          null,
      crew_count:             null,
      isps_security_level:    1,
      last_10_ports:          [],
      has_dangerous_goods:    false,
      dangerous_goods_class:  null,
      sso_name:               null,
      sso_contact:            null,
      sso_email:              null,
    };

    return res.json({
      success: true,
      found: true,
      vessel: {
        imo:      vessel.imo,
        name:     vessel.name,
        flag:     vessel.flag,
        type:     vessel.type,
        gt:       vessel.gt,
        nt:       vessel.nt,
        loa:      vessel.loa,
        beam:     vessel.beam,
        draft:    vessel.draft,
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
// POST /api/cape/validate
// Validate an ISPS filing payload — no auth required (used in demo)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/validate', (req, res) => {
  try {
    const data = req.body;
    const result = validateCapeFiling(data);

    // Record demo validation run so admin "Validations Run" counter stays accurate.
    recordValidation(req.app.locals.pool, {
      vessel_name: data.vessel_name,
      imo_number: data.imo_number,
      flag_state: data.flag_state,
      vessel_type: data.vessel_type,
      gross_tonnage: data.gross_tonnage,
      cargo_type: data.cargo_summary,
      has_dangerous_goods: data.has_dangerous_goods,
      overall_status: result.overall_status,
      total_checks: result.total_checks,
      passed_checks: result.passed_checks,
      failed_checks: result.failed_checks,
      warning_checks: result.warning_checks,
      canal: 'cape',
    }).catch(err => console.error('[Cape/Validate] Record error:', err.message));

    return res.json({ success: true, validation: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation error: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cape/filings — create filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.post('/filings', attachDemoSession, requireAuthOrDemo, requireAgencyVesselCapacity, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const data   = req.body;

    const validation = validateCapeFiling(data);

    // Compute 96-hour deadline based on ETA
    let deadline96h = null;
    if (data.estimated_arrival) {
      const eta = new Date(data.estimated_arrival);
      deadline96h = new Date(eta.getTime() - 96 * 60 * 60 * 1000).toISOString();
    }

    const filing = await createCapeFiling(pool, {
      ...data,
      user_id:          userId,
      compliance_score: validation.compliance_score,
      deadline_96h_at:  deadline96h,
    });

    // Register deadline alert — SAMSA ISPS pre-arrival must be filed 96h before ETA
    if (data.estimated_arrival && filing && filing.id) {
      try {
        const eta = new Date(data.estimated_arrival);
        const deadlineAt = new Date(eta.getTime() - 96 * 60 * 60 * 1000).toISOString();
        const issues = (validation.failed_checks || []).slice(0, 5).map(c => c.message || c);
        await upsertDeadline(pool, {
          userId,
          waterway: 'cape',
          filingType: 'ISPS Pre-Arrival (SAMSA)',
          vesselName: data.vessel_name || 'Unknown Vessel',
          imoNumber:  data.imo_number || null,
          deadlineAt,
          filingId:   filing.id,
          filingUrl:  `/demo/cape`,
          complianceIssues: issues,
        });
      } catch (dlErr) {
        console.error('[Cape/CreateFiling] Deadline registration failed:', dlErr.message);
      }
    }

    return res.status(201).json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/filings — list filings (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const filings = await listCapeFilings(pool, userId, { limit, offset });
    return res.json({ success: true, filings });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/filings/export — bulk CSV/xlsx export (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/export', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const format = (req.query.format || 'csv').toLowerCase();

    const filings = await listCapeFilings(pool, userId, { limit: 1000, offset: 0 });

    if (format === 'xlsx') {
      const buf = capeFilingsToXLSX(filings);
      const filename = `cape-isps-filings-${new Date().toISOString().slice(0,10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buf);
    }

    const csv = capeFilingsToCSV(filings);
    const filename = `cape-isps-filings-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/filings/:id — get single filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filing = await getCapeFilingById(pool, req.params.id, userId);

    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });
    return res.json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/filings/:id/pdf — PDF download (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/pdf', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filing = await getCapeFilingById(pool, req.params.id, userId);

    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });

    const validation = validateCapeFiling(filing);
    const pdf = generateCapeISPSPDF(filing, validation);

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/\s+/g, '-');
    const dateSlug   = new Date().toISOString().slice(0, 10);
    const filename   = `${vesselSlug}_IMO${filing.imo_number || 'unknown'}_cape-isps_${dateSlug}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/filings/:id/export — single-filing CSV/xlsx (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/filings/:id/export', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const format = (req.query.format || 'csv').toLowerCase();
    const filing = await getCapeFilingById(pool, req.params.id, userId);

    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });

    const vesselSlug = (filing.vessel_name || 'vessel').toLowerCase().replace(/\s+/g, '-');
    const dateSlug   = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const buf = capeFilingsToXLSX([filing]);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${vesselSlug}_IMO${filing.imo_number || ''}_${dateSlug}.xlsx"`);
      return res.send(buf);
    }

    const csv = capeFilingsToCSV([filing]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${vesselSlug}_IMO${filing.imo_number || ''}_${dateSlug}.csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/cape/filings/:id — update filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.put('/filings/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const data   = req.body;

    const validation = validateCapeFiling(data);
    data.compliance_score = validation.compliance_score;

    if (data.estimated_arrival) {
      const eta = new Date(data.estimated_arrival);
      data.deadline_96h_at = new Date(eta.getTime() - 96 * 60 * 60 * 1000).toISOString();
    }

    const filing = await updateCapeFiling(pool, req.params.id, userId, data);
    if (!filing) return res.status(404).json({ success: false, message: 'Filing not found.' });

    // Update deadline alert when ETA changes
    if (data.estimated_arrival && filing.id) {
      try {
        const eta = new Date(data.estimated_arrival);
        const deadlineAt = new Date(eta.getTime() - 96 * 60 * 60 * 1000).toISOString();
        const issues = (validation.failed_checks || []).slice(0, 5).map(c => c.message || c);
        const patched = await updateDeadlineForFiling(pool, {
          filingId: filing.id,
          userId,
          waterway: 'cape',
          deadlineAt,
          complianceIssues: issues,
        });
        if (!patched) {
          await upsertDeadline(pool, {
            userId,
            waterway: 'cape',
            filingType: 'ISPS Pre-Arrival (SAMSA)',
            vesselName: filing.vessel_name || data.vessel_name || 'Unknown Vessel',
            imoNumber:  filing.imo_number  || data.imo_number  || null,
            deadlineAt,
            filingId:   filing.id,
            filingUrl:  `/demo/cape`,
            complianceIssues: issues,
          });
        }
      } catch (dlErr) {
        console.error('[Cape/UpdateFiling] Deadline update failed:', dlErr.message);
      }
    }

    return res.json({ success: true, filing });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/cape/filings/:id — soft-delete filing (auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/filings/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const filingId = parseInt(req.params.id, 10);
    const result = await deleteCapeFiling(pool, filingId, userId);

    if (!result) return res.status(404).json({ success: false, message: 'Filing not found.' });

    // Disable deadline alerts for this filing (non-fatal)
    try {
      await disableDeadlineForFiling(pool, { filingId, userId, waterway: 'cape' });
    } catch (dlErr) {
      console.error('[Cape/DeleteFiling] Deadline disable failed:', dlErr.message);
    }

    return res.json({ success: true, message: 'Filing deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cape/submit
// Send ISPS pre-arrival notification to Cape Town Radio via email.
// Accepts either a filing ID or inline form data; filing ID preferred.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/submit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, ...inlineData } = req.body;

    // Prefer loading from the database when a filing_id is provided
    let filingData = inlineData;
    if (filing_id) {
      const saved = await getCapeFilingById(pool, filing_id, userId);
      if (!saved) {
        return res.status(404).json({ success: false, message: 'Filing not found.' });
      }
      filingData = { ...saved, ...inlineData };
    }

    if (!filingData.vessel_name && !filingData.imo_number) {
      return res.status(400).json({ success: false, message: 'vessel_name or imo_number required.' });
    }

    const result = await sendISPSToCapeRadio(filingData);

    const submissionRow = await samsaDb.createSamsaSubmission(pool, {
      userId,
      filingId:       filing_id || null,
      vesselName:     filingData.vessel_name || '',
      imoNumber:      filingData.imo_number  || null,
      portOfArrival:  filingData.next_port   || null,
      recipientEmail: result.recipientEmail,
      emailSubject:   result.success ? result.subject || `ISPS Pre-Arrival — ${filingData.vessel_name}` : '(send failed)',
      messageHash:    result.messageHash || '',
      status:         result.success ? 'submitted' : 'error',
      samsaReference: result.samsaRef,
      errorMessage:   result.error || null,
    });

    // Update filing status to 'submitted' if we have a filing record
    if (filing_id && result.success) {
      await updateCapeFiling(pool, filing_id, userId, { filing_status: 'submitted' }).catch(() => {});
    }

    // Audit log entry — best-effort
    if (filing_id) {
      samsaDb.writeSamsaAuditEntry(
        pool, filing_id, `user:${userId}`,
        result.success ? 'submitted_to_samsa' : 'samsa_submit_failed',
        result.success
          ? `ISPS pre-arrival sent to Cape Town Radio — ref: ${result.samsaRef}, recipient: ${result.recipientEmail}`
          : `SAMSA submission failed: ${result.error}`
      ).catch(() => {});
    }

    if (!result.success) {
      return res.status(502).json({
        success: false,
        message: `Email delivery failed: ${result.error}`,
        samsa_reference: result.samsaRef,
        submission: submissionRow.rows[0],
      });
    }

    return res.json({
      success: true,
      message: `ISPS pre-arrival sent to Cape Town Radio — ref: ${result.samsaRef}`,
      samsa_reference: result.samsaRef,
      recipient_email: result.recipientEmail,
      submission: submissionRow.rows[0],
    });
  } catch (err) {
    console.error('[Cape/Submit] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Submission failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/submissions
// List SAMSA submission history for the authenticated user.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/submissions', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await samsaDb.listSamsaSubmissions(pool, userId, limit, offset);
    const count  = await samsaDb.countSamsaSubmissions(pool, userId);

    return res.json({
      success: true,
      submissions: result.rows,
      total: parseInt(count.rows[0].count, 10),
    });
  } catch (err) {
    console.error('[Cape/ListSubmissions] Error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cape/submissions/:id
// Get a single SAMSA submission record.
// ─────────────────────────────────────────────────────────────────────────────

router.get('/submissions/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid submission ID.' });
    }

    const result = await samsaDb.getSamsaSubmission(pool, id, userId);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    return res.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error('[Cape/GetSubmission] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to get submission: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/cape/submissions/:id/resubmit
// Re-send a prior SAMSA submission (new email, new reference number).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/submissions/:id/resubmit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool   = req.app.locals.pool;
    const userId = req.user.id;
    const id     = parseInt(req.params.id, 10);

    if (isNaN(id)) {
      return res.status(400).json({ success: false, message: 'Invalid submission ID.' });
    }

    const existing = await samsaDb.getSamsaSubmissionForResubmit(pool, id, userId);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found.' });
    }

    const orig = existing.rows[0];

    // Re-load the filing if available for the most current data
    let filingData = { vessel_name: orig.vessel_name, imo_number: orig.imo_number, next_port: orig.port_of_arrival };
    if (orig.filing_id) {
      try {
        const f = await getCapeFilingById(pool, orig.filing_id, userId);
        if (f) filingData = { ...f };
      } catch (_) { /* fall back to stored meta */ }
    }

    const result = await sendISPSToCapeRadio(filingData);

    const newSub = await samsaDb.createSamsaSubmission(pool, {
      userId,
      filingId:       orig.filing_id,
      vesselName:     orig.vessel_name,
      imoNumber:      orig.imo_number,
      portOfArrival:  orig.port_of_arrival,
      recipientEmail: result.recipientEmail,
      emailSubject:   result.success ? `ISPS Resubmission — ${orig.vessel_name}` : '(send failed)',
      messageHash:    result.messageHash || '',
      status:         result.success ? 'submitted' : 'error',
      samsaReference: result.samsaRef,
      errorMessage:   result.error || null,
    });

    if (orig.filing_id) {
      samsaDb.writeSamsaAuditEntry(
        pool, orig.filing_id, `user:${userId}`,
        result.success ? 'resubmitted_to_samsa' : 'samsa_resubmit_failed',
        result.success
          ? `ISPS resubmitted to Cape Town Radio — new ref: ${result.samsaRef}, original: ${orig.samsa_reference || 'unknown'}`
          : `ISPS resubmit failed: ${result.error}`
      ).catch(() => {});
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
      message: `ISPS resubmitted to Cape Town Radio — new reference: ${result.samsaRef}`,
      samsa_reference: result.samsaRef,
      submission: newSub.rows[0],
    });
  } catch (err) {
    console.error('[Cape/Resubmit] Error:', err.message);
    return res.status(500).json({ success: false, message: 'Resubmission failed: ' + err.message });
  }
});

module.exports = router;
