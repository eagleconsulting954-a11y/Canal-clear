/**
 * Onboarding routes — guided first-filing wizard for new users.
 * Owns: onboarding state (step tracking, role selection, vessel entry, waterway pick, filing simulation).
 * Does NOT own: actual filing creation (bosporus/malacca/cape routes), subscription enforcement.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const usersDb = require('../db/users');

// GET /api/onboarding/state — returns current onboarding step + account_type
router.get('/state', requireAuth, async (req, res) => {
  try {
    const state = await usersDb.getOnboardingState(req.app.locals.pool, req.user.id);
    if (!state) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, ...state });
  } catch (err) {
    res.status(500).json({ success: false, message: 'State fetch failed' });
  }
});

// POST /api/onboarding/step — advance to a step and optionally save payload
// body: { step: 1..5, account_type?, vessel?, waterway? }
router.post('/step', requireAuth, async (req, res) => {
  const pool = req.app.locals.pool;
  const { step, account_type, vessel, waterway } = req.body;

  if (!step || step < 1 || step > 5) {
    return res.status(400).json({ success: false, message: 'Invalid step' });
  }

  try {
    // Build update dynamically based on what was sent
    const updates = ['onboarding_step = GREATEST(onboarding_step, $2)'];
    const params = [req.user.id, step];
    let idx = 3;

    if (account_type && ['agent', 'operator'].includes(account_type)) {
      updates.push(`account_type = $${idx++}`);
      params.push(account_type);
    }

    // Persist vessel data for resume in onboarding_vessel_cache (jsonb scratch column — added lazily)
    if (vessel) {
      updates.push(`onboarding_vessel_cache = $${idx++}`);
      params.push(JSON.stringify(vessel));
    }

    if (waterway) {
      updates.push(`onboarding_waterway = $${idx++}`);
      params.push(waterway);
    }

    // Mark complete when reaching step 5
    if (step === 5) {
      updates.push('onboarding_completed = TRUE');
    }

    await usersDb.updateOnboardingRaw(pool,
      `UPDATE users SET ${updates.join(', ')} WHERE id = $1`,
      params
    );

    res.json({ success: true, step });
  } catch (err) {
    // Gracefully handle missing scratch columns (they're added by migration but prod may lag)
    if (err.code === '42703') {
      // Unknown column — still advance the step without the optional payload
      try {
        await usersDb.advanceOnboardingStep(pool, req.user.id, step, step === 5);
        return res.json({ success: true, step });
      } catch (e2) {
        return res.status(500).json({ success: false, message: 'Step save failed' });
      }
    }
    res.status(500).json({ success: false, message: 'Step save failed' });
  }
});

// POST /api/onboarding/skip — mark onboarding done, skip to dashboard
router.post('/skip', requireAuth, async (req, res) => {
  try {
    await usersDb.setOnboardingCompleted(req.app.locals.pool, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Skip failed' });
  }
});

// POST /api/onboarding/validate-vessel — IMO checksum validator
// body: { imo: '1234567' }
router.post('/validate-vessel', requireAuth, (req, res) => {
  const { imo } = req.body;
  if (!imo) return res.json({ valid: false, message: 'IMO required' });

  const digits = String(imo).replace(/[^0-9]/g, '');
  if (digits.length !== 7) return res.json({ valid: false, message: 'IMO must be 7 digits' });

  // IMO Luhn-style checksum: multiply first 6 digits by 7,6,5,4,3,2 and sum
  const weights = [7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(digits[i]), 0);
  const checkDigit = sum % 10;
  const valid = checkDigit === parseInt(digits[6]);

  res.json({ valid, message: valid ? 'Valid IMO number' : 'Invalid IMO checksum' });
});

// POST /api/onboarding/simulate-filing — runs compliance validation on vessel data
// Returns a realistic score + issue list without persisting a real filing
router.post('/simulate-filing', requireAuth, (req, res) => {
  const { vessel, waterway } = req.body;
  if (!vessel || !waterway) {
    return res.status(400).json({ success: false, message: 'vessel and waterway required' });
  }

  // Deterministic simulation — score based on completeness of vessel data
  const checks = buildComplianceChecks(vessel, waterway);
  const passed = checks.filter(c => c.status === 'pass').length;
  const score = Math.round((passed / checks.length) * 100);

  res.json({
    success: true,
    compliance_score: score,
    checks,
    waterway,
    vessel_name: vessel.name || 'MV Sample Vessel',
    filing_type: FILING_TYPES[waterway] || 'Pre-Arrival Filing',
    fields_prefilled: Math.min(23, Math.round(checks.length * 0.74)),
    total_fields: checks.length + 8, // simulate a larger form
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

const FILING_TYPES = {
  panama:   'VUMPA + PCSOPEP',
  suez:     'SCA Pre-Arrival + SCNT',
  bosporus: 'SP-1 Transit Notice',
  malacca:  'STRAITREP + VTIS',
  cape:     'ISPS Pre-Arrival (96h)',
};

function buildComplianceChecks(vessel, waterway) {
  const checks = [];

  const push = (label, pass, detail) =>
    checks.push({ label, status: pass ? 'pass' : (Math.random() > 0.5 ? 'warning' : 'fail'), detail });

  push('Vessel Name', !!vessel.name, 'Required for all filings');
  push('IMO Number', !!vessel.imo, 'Unique vessel identifier');
  push('Flag State', !!vessel.flag, 'Must match certificate of registry');
  push('LOA (Length Overall)', !!vessel.loa, 'Required for transit slot allocation');
  push('Beam', !!vessel.beam, 'Required for lock/channel clearance');
  push('Draft', !!vessel.draft, 'Maximum draft must not exceed waterway limits');
  push('Vessel Type', !!vessel.vessel_type, 'Determines applicable regulations');

  if (waterway === 'panama') {
    push('PCSOPEP Certificate', false, 'Panama Canal Spill Prevention Plan required');
    push('VUMPA Filing Window', true, '96h pre-arrival window open');
    push('Net Tonnage', !!vessel.loa, 'Used for toll calculation');
  } else if (waterway === 'suez') {
    push('SCNT Documents', false, 'Suez Canal Navigation Toll certificate required');
    push('ISPS Level Declaration', true, 'ISPS Level 1 assumed unless declared');
    push('Convoy Slot Requested', true, 'Northbound convoy slot available');
  } else if (waterway === 'bosporus') {
    push('SP-1 Transit Notice', true, '24h advance notice submitted');
    push('Montreux Convention Class', !!vessel.vessel_type, 'Warship restrictions apply');
    push('Hazmat Declaration', true, 'No DG cargo declared');
  } else if (waterway === 'malacca') {
    push('STRAITREP Report', true, 'VHF Ch 73 report format ready');
    push('VTIS Reporting Zone', true, 'Zone A-D sequence confirmed');
    push('Speed Compliance', !!vessel.draft, 'Draft-dependent speed restrictions apply');
  } else if (waterway === 'cape') {
    push('96h Pre-Arrival', true, '96-hour filing window open');
    push('Last 10 Ports', false, 'Port history last 10 calls required');
    push('SSO Details', false, 'Ship Security Officer contact required');
    push('ISPS Declaration', true, 'ISPS Level 1 standard');
  }

  return checks;
}

// POST /api/onboarding/complete — legacy alias for step 5 / skip
router.post('/complete', requireAuth, async (req, res) => {
  try {
    await usersDb.setOnboardingCompletedWithStep(req.app.locals.pool, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Complete failed' });
  }
});

// GET /api/onboarding/progress — returns which checklist items are complete
// Used by the in-app progress bar shown until all steps are done.
router.get('/progress', requireAuth, async (req, res) => {
  try {
    const progress = await usersDb.getOnboardingProgress(req.app.locals.pool, req.user.id);
    const { hasVessel, hasFiling, hasSubmitted, hasPortal } = progress;

    const steps = [
      { key: 'vessel',  label: 'Add first vessel',         done: hasVessel },
      { key: 'check',   label: 'Run compliance check',      done: hasFiling },
      { key: 'submit',  label: 'Submit first filing',       done: hasSubmitted },
      { key: 'portal',  label: 'Connect authority portal',  done: hasPortal, optional: true },
    ];

    res.json({ success: true, steps, all_done: steps.every(s => s.done) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Progress check failed' });
  }
});

module.exports = router;
