/**
 * validator.js — Compliance Validator API routes (all 5 waterways)
 *
 * Owns: POST /api/validate/:waterway — runs the appropriate validator
 *       and returns structured pass/fail results.
 * Does NOT own: filing CRUD, PDF generation, auth, or vessel lookup.
 *
 * Supported waterways: panama, suez, bosporus, malacca, cape
 */

const express = require('express');
const router = express.Router();

const { validateVUMPA } = require('../services/vumpa-validator');
const { validateSuezFiling: validateSuez } = require('../services/suez-validator');
const { validateSP1Filing: validateBosporus } = require('../services/bosporus-validator');
const { validateMalaccaFiling: validateMalacca } = require('../services/malacca-validator');
const { validateCapeFiling: validateCape } = require('../services/cape-validator');

// ── Normalize result to consistent shape ─────────────────────────────────────
function normalizeResult(raw, waterway) {
  // All validators produce slightly different shapes — normalize here.
  // Output: { waterway, overall_status, compliance_score, passed_checks, failed_checks,
  //           warning_checks, total_checks, checklist }

  if (!raw) return { waterway, overall_status: 'failed', compliance_score: 0, checklist: [] };

  const checklist = raw.checklist || [];
  const passed = raw.passed_checks ?? checklist.filter(c => c.status === 'pass').length;
  const failed = raw.failed_checks ?? checklist.filter(c => c.status === 'fail').length;
  const warnings = raw.warning_checks ?? checklist.filter(c => c.status === 'warning').length;

  const score = raw.compliance_score ??
    (failed === 0 && warnings === 0 ? 100 :
      Math.max(0, Math.round(100 - (failed * 15) - (warnings * 5))));

  return {
    waterway,
    overall_status: raw.overall_status || (failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed'),
    compliance_score: score,
    passed_checks: passed,
    failed_checks: failed,
    warning_checks: warnings,
    total_checks: raw.total_checks ?? checklist.length,
    checklist,
  };
}

// ── POST /api/validate/:waterway ─────────────────────────────────────────────
router.post('/:waterway', (req, res) => {
  const { waterway } = req.params;
  const data = req.body || {};

  try {
    let raw;

    switch (waterway) {
      case 'panama':
        // vumpa-validator expects flat object
        raw = validateVUMPA(data);
        return res.json(normalizeResult(raw, waterway));

      case 'suez':
        raw = validateSuez(data);
        return res.json(normalizeResult(raw, waterway));

      case 'bosporus':
        raw = validateBosporus(data);
        return res.json(normalizeResult(raw, waterway));

      case 'malacca':
        raw = validateMalacca(data);
        return res.json(normalizeResult(raw, waterway));

      case 'cape':
        raw = validateCape(data);
        return res.json(normalizeResult(raw, waterway));

      default:
        return res.status(400).json({ error: `Unknown waterway: ${waterway}` });
    }
  } catch (err) {
    console.error('[validator] error waterway=%s err=%s', waterway, err.message);
    return res.status(500).json({ error: 'Validation failed', detail: err.message });
  }
});

module.exports = router;
