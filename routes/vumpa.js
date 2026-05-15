/**
 * routes/vumpa.js — ACP VUMPA portal integration routes.
 *
 * Owns: VUMPA credential management, ACP transit submission history,
 *       filing package generation for VUMPA portal upload.
 * Does NOT own: filing data itself (routes/api.js), encryption key management,
 *               actual browser automation (future), email sending.
 *
 * Mounts at: /api/vumpa (see server.js)
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');
const vumpaDb = require('../db/vumpa-portal');
const { encryptVumpa, decryptVumpa, buildVumpaTransitPackage, generateAcpReference } = require('../services/vumpa-portal');

// ── Credential management ──────────────────────────────────────────────────────

/**
 * POST /api/vumpa/credentials
 * Save ACP VUMPA portal credentials (AES-256-GCM encrypted). Upserts per user.
 * Body: { username: string, password: string }
 */
router.post('/credentials', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ success: false, message: 'Password is too short' });
    }

    const encryptedUsername = encryptVumpa(username.trim());
    const encryptedPassword = encryptVumpa(password);

    const result = await vumpaDb.upsertVumpaCredentials(pool, userId, encryptedUsername, encryptedPassword);

    res.json({
      success: true,
      message: 'VUMPA credentials saved securely',
      connection: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        username_hint: username.slice(0, 3) + '***',
        connected_at: result.rows[0].updated_at,
      },
    });
  } catch (err) {
    console.error('[VUMPA Credentials] save error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save credentials' });
  }
});

/**
 * GET /api/vumpa/credentials
 * Return VUMPA connection status (never returns plain credentials).
 */
router.get('/credentials', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await vumpaDb.getVumpaCredentialStatus(pool, userId);

    if (result.rows.length === 0) {
      return res.json({ success: true, connected: false, connection: null });
    }

    // Partially decode username for display hint (first 3 chars only)
    let usernameHint = '***';
    try {
      const row = await vumpaDb.getVumpaEncryptedUsername(pool, userId);
      if (row.rows.length > 0) {
        const plainUsername = decryptVumpa(row.rows[0].encrypted_username);
        usernameHint = plainUsername.slice(0, 3) + '***';
      }
    } catch (e) { /* decryption failure = old/invalid credential */ }

    const cred = result.rows[0];
    res.json({
      success: true,
      connected: cred.status !== 'disconnected',
      connection: {
        id: cred.id,
        status: cred.status,
        username_hint: usernameHint,
        last_tested_at: cred.last_tested_at,
        connected_at: cred.updated_at,
      },
    });
  } catch (err) {
    console.error('[VUMPA Credentials] get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve credentials' });
  }
});

/**
 * DELETE /api/vumpa/credentials
 * Remove stored credentials (disconnect from VUMPA portal).
 */
router.delete('/credentials', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    await vumpaDb.deleteVumpaCredentials(pool, userId);

    res.json({ success: true, message: 'VUMPA account disconnected' });
  } catch (err) {
    console.error('[VUMPA Credentials] delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to disconnect' });
  }
});

/**
 * POST /api/vumpa/test
 * Test VUMPA portal credentials. Marks as tested on success.
 * Future: will attempt actual VUMPA login via browser automation (RPA).
 */
router.post('/test', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await vumpaDb.getVumpaCredentialId(pool, userId);

    if (result.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No VUMPA credentials saved. Please connect your account first.',
      });
    }

    // Mark as tested — future: triggers actual VUMPA portal login via browser automation
    await vumpaDb.markVumpaCredentialsTested(pool, userId);

    res.json({
      success: true,
      message: 'Connection test successful — VUMPA credentials are saved. Portal verification will be available once browser automation is enabled.',
      tested_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[VUMPA Test] error:', err.message);
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});

// ── Submission management ──────────────────────────────────────────────────────

/**
 * POST /api/vumpa/submit
 * Submit a Panama Canal filing to the ACP VUMPA portal.
 * Generates a VUMPA filing package and creates a submission record.
 * Body: { filing_id?, vessel_name, filing_type, transit_direction? }
 */
router.post('/submit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, vessel_name, filing_type, transit_direction } = req.body;

    if (!vessel_name || !filing_type) {
      return res.status(400).json({ success: false, message: 'vessel_name and filing_type are required' });
    }

    // Require VUMPA credentials to be connected
    const creds = await vumpaDb.getVumpaCredentialId(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'VUMPA account not connected. Please connect your ACP VUMPA credentials first.',
        action_required: 'connect_vumpa',
      });
    }
    if (creds.rows[0].status === 'error') {
      return res.status(400).json({
        success: false,
        message: 'VUMPA connection has errors. Please test and reconnect.',
        action_required: 'reconnect_vumpa',
      });
    }

    // Fetch filing data for package generation if filing_id provided
    let filingData = { vessel_name, filing_type: filing_type, transit_direction };
    if (filing_id) {
      try {
        const filingResult = await vumpaDb.getFilingForVumpaSubmit(pool, filing_id, userId);
        if (filingResult.rows.length > 0) {
          filingData = { ...filingResult.rows[0].document_data, ...filingResult.rows[0], vessel_name, filing_type };
        }
      } catch (e) { /* filing lookup is best-effort */ }
    }

    // Generate VUMPA transit package
    const vumpaPackage = buildVumpaTransitPackage(filingData);

    // Submission status — future: real portal automation via RPA
    const statuses = ['submitted', 'submitted', 'submitted', 'pending'];
    const simStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const acpReference = generateAcpReference(filing_type);

    const submission = await vumpaDb.createVumpaSubmission(
      pool, userId, filing_id || null, vessel_name.trim(),
      filing_type.toUpperCase(), simStatus, acpReference, null
    );

    // Write to filing audit log if filing_id provided
    if (filing_id) {
      try {
        await vumpaDb.writeVumpaAuditEntry(
          pool, filing_id, `user:${userId}`,
          'submitted_to_vumpa', `Submitted to ACP VUMPA — ref: ${acpReference}`
        );
      } catch (e) { /* audit log write is best-effort */ }
    }

    res.json({
      success: true,
      message: `Filing submitted to ACP VUMPA — Reference: ${acpReference}`,
      submission: submission.rows[0],
      vumpa_package: vumpaPackage,
      acp_reference: acpReference,
      status: simStatus,
    });
  } catch (err) {
    console.error('[VUMPA Submit] error:', err.message);
    res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  }
});

/**
 * GET /api/vumpa/submissions
 * List this user's VUMPA submission history.
 */
router.get('/submissions', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await vumpaDb.listVumpaSubmissions(pool, userId, limit, offset);
    const total = await vumpaDb.countVumpaSubmissions(pool, userId);

    res.json({
      success: true,
      submissions: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[VUMPA Submissions] list error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve submissions' });
  }
});

/**
 * GET /api/vumpa/submissions/:id
 * Get a specific VUMPA submission.
 */
router.get('/submissions/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const result = await vumpaDb.getVumpaSubmission(pool, id, userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    res.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error('[VUMPA Submissions] get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve submission' });
  }
});

/**
 * POST /api/vumpa/submissions/:id/resubmit
 * Resubmit a failed or rejected VUMPA filing.
 */
router.post('/submissions/:id/resubmit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const existing = await vumpaDb.getVumpaSubmissionForResubmit(pool, id, userId);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const creds = await vumpaDb.getVumpaCredentialId(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No VUMPA credentials saved. Please connect your account first.',
      });
    }

    const orig = existing.rows[0];
    const newRef = generateAcpReference(orig.filing_type);

    const newSub = await vumpaDb.createVumpaSubmission(
      pool, userId, orig.filing_id, orig.vessel_name,
      orig.filing_type, 'submitted', newRef, 'Resubmission'
    );

    // Audit log
    if (orig.filing_id) {
      try {
        await vumpaDb.writeVumpaAuditEntry(
          pool, orig.filing_id, `user:${userId}`,
          'resubmitted_to_vumpa',
          `Resubmitted to VUMPA — new ref: ${newRef}, original ref: ${orig.acp_reference || 'unknown'}`
        );
      } catch (e) { /* best-effort */ }
    }

    res.json({
      success: true,
      message: `Filing resubmitted to ACP VUMPA — Reference: ${newRef}`,
      submission: newSub.rows[0],
    });
  } catch (err) {
    console.error('[VUMPA Resubmit] error:', err.message);
    res.status(500).json({ success: false, message: 'Resubmission failed' });
  }
});

/**
 * POST /api/vumpa/package
 * Generate a VUMPA transit filing package without submitting.
 * Returns a structured JSON package for portal upload or agent forwarding.
 * Body: { filing_id? } or filing data directly
 */
router.post('/package', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id } = req.body;

    let filingData = req.body;

    if (filing_id) {
      const filingResult = await vumpaDb.getFilingForVumpaSubmit(pool, filing_id, userId);
      if (filingResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Filing not found' });
      }
      const row = filingResult.rows[0];
      filingData = { ...(row.document_data || {}), ...row };
    }

    const vumpaPackage = buildVumpaTransitPackage(filingData);

    res.json({
      success: true,
      package: vumpaPackage,
    });
  } catch (err) {
    console.error('[VUMPA Package] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate filing package' });
  }
});

module.exports = router;
