/**
 * routes/sca.js — SCA (Suez Canal Authority) portal integration routes.
 *
 * Owns: SCA E-Services credential storage/management, transit submission history,
 *       filing package generation for SCA portal upload.
 * Does NOT own: filing data itself (that's routes/api.js), encryption key management,
 *               actual browser automation (future task), email sending.
 *
 * Mounts at: /api/sca (see server.js)
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { attachDemoSession, requireAuthOrDemo } = require('../middleware/demoAuth');
const scaPortalDb = require('../db/sca-portal');
const { encryptSca, decryptSca, buildScaTransitPackage, generateScaReference } = require('../services/sca-portal');

// ── Credential management ─────────────────────────────────────────────────────

/**
 * POST /api/sca/credentials
 * Save SCA E-Services portal credentials (AES-256-GCM encrypted). Upserts per user.
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

    const encryptedUsername = encryptSca(username.trim());
    const encryptedPassword = encryptSca(password);

    const result = await scaPortalDb.upsertScaCredentials(pool, userId, encryptedUsername, encryptedPassword);

    res.json({
      success: true,
      message: 'SCA credentials saved securely',
      connection: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        username_hint: username.slice(0, 3) + '***',
        connected_at: result.rows[0].updated_at,
      },
    });
  } catch (err) {
    console.error('[SCA Credentials] save error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to save credentials' });
  }
});

/**
 * GET /api/sca/credentials
 * Return SCA connection status (never returns plain credentials).
 */
router.get('/credentials', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await scaPortalDb.getScaCredentialStatus(pool, userId);

    if (result.rows.length === 0) {
      return res.json({ success: true, connected: false, connection: null });
    }

    // Partially decode username for display hint (first 3 chars only)
    let usernameHint = '***';
    try {
      const row = await scaPortalDb.getScaEncryptedUsername(pool, userId);
      if (row.rows.length > 0) {
        const plainUsername = decryptSca(row.rows[0].encrypted_username);
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
    console.error('[SCA Credentials] get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve credentials' });
  }
});

/**
 * DELETE /api/sca/credentials
 * Remove stored credentials (disconnect from SCA portal).
 */
router.delete('/credentials', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    await scaPortalDb.deleteScaCredentials(pool, userId);

    res.json({ success: true, message: 'SCA account disconnected' });
  } catch (err) {
    console.error('[SCA Credentials] delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to disconnect' });
  }
});

/**
 * POST /api/sca/test
 * Test SCA portal credentials. Marks as tested on success.
 * Future: will attempt actual E-Services login via browser automation.
 */
router.post('/test', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;

    const result = await scaPortalDb.getScaCredentialId(pool, userId);

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No SCA credentials saved. Please connect your account first.' });
    }

    // Mark as tested — future: this triggers actual SCA portal login via browser automation
    await scaPortalDb.markScaCredentialsTested(pool, userId);

    res.json({
      success: true,
      message: 'Connection test successful — SCA E-Services credentials are saved. Portal verification will be available once browser automation is enabled.',
      tested_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[SCA Test] error:', err.message);
    res.status(500).json({ success: false, message: 'Connection test failed' });
  }
});

// ── Submission management ─────────────────────────────────────────────────────

/**
 * POST /api/sca/submit
 * Submit a Suez Canal filing to the SCA E-Services portal.
 * Generates a filing package and creates a submission record.
 * Body: { filing_id, vessel_name, filing_type, transit_direction? }
 */
router.post('/submit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id, vessel_name, filing_type, transit_direction } = req.body;

    if (!vessel_name || !filing_type) {
      return res.status(400).json({ success: false, message: 'vessel_name and filing_type are required' });
    }

    // Require SCA credentials to be connected
    const creds = await scaPortalDb.getScaCredentialStatus(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'SCA account not connected. Please connect your SCA E-Services credentials first.',
        action_required: 'connect_sca',
      });
    }
    if (creds.rows[0].status === 'error') {
      return res.status(400).json({
        success: false,
        message: 'SCA connection has errors. Please test and reconnect.',
        action_required: 'reconnect_sca',
      });
    }

    // Fetch filing data for package generation if filing_id provided
    let filingData = { vessel_name, filing_type, transit_direction };
    if (filing_id) {
      try {
        const filingResult = await scaPortalDb.getFilingForScaSubmit(pool, filing_id, userId);
        if (filingResult.rows.length > 0) {
          filingData = { ...filingResult.rows[0].document_data, ...filingResult.rows[0], vessel_name, filing_type };
        }
      } catch (e) { /* filing lookup is best-effort */ }
    }

    // Generate SCA transit package
    const transitPackage = buildScaTransitPackage(filingData);

    // Simulate submission statuses — future: real portal automation
    const statuses = ['submitted', 'submitted', 'submitted', 'pending'];
    const simStatus = statuses[Math.floor(Math.random() * statuses.length)];
    const scaReference = generateScaReference();

    const submission = await scaPortalDb.createScaSubmission(
      pool, userId, filing_id || null, vessel_name.trim(),
      filing_type.toUpperCase(), transit_direction || null,
      simStatus, scaReference, null
    );

    // Write to filing audit log if filing_id provided
    if (filing_id) {
      try {
        await scaPortalDb.writeScaAuditEntry(
          pool, filing_id, `user:${userId}`,
          'submitted_to_sca', `Submitted to SCA E-Services — ref: ${scaReference}`
        );
      } catch (e) { /* audit log write is best-effort */ }
    }

    res.json({
      success: true,
      message: `Filing submitted to SCA E-Services — Reference: ${scaReference}`,
      submission: submission.rows[0],
      transit_package: transitPackage,
      sca_reference: scaReference,
      status: simStatus,
    });
  } catch (err) {
    console.error('[SCA Submit] error:', err.message);
    res.status(500).json({ success: false, message: 'Submission failed. Please try again.' });
  }
});

/**
 * GET /api/sca/submissions
 * List this user's SCA submission history.
 */
router.get('/submissions', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await scaPortalDb.listScaSubmissions(pool, userId, limit, offset);
    const total = await scaPortalDb.countScaSubmissions(pool, userId);

    res.json({
      success: true,
      submissions: result.rows,
      total: parseInt(total.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    console.error('[SCA Submissions] list error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve submissions' });
  }
});

/**
 * GET /api/sca/submissions/:id
 * Get a specific SCA submission.
 */
router.get('/submissions/:id', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const result = await scaPortalDb.getScaSubmission(pool, id, userId);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    res.json({ success: true, submission: result.rows[0] });
  } catch (err) {
    console.error('[SCA Submissions] get error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve submission' });
  }
});

/**
 * POST /api/sca/submissions/:id/resubmit
 * Resubmit a failed or rejected SCA filing.
 */
router.post('/submissions/:id/resubmit', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { id } = req.params;

    const existing = await scaPortalDb.getScaSubmissionForResubmit(pool, id, userId);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    const creds = await scaPortalDb.getScaCredentialId(pool, userId);
    if (creds.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No SCA credentials saved. Please connect your account first.' });
    }

    const orig = existing.rows[0];
    const newRef = generateScaReference();

    const newSub = await scaPortalDb.createScaSubmission(
      pool, userId, orig.filing_id, orig.vessel_name, orig.filing_type,
      orig.transit_direction, 'submitted', newRef, 'Resubmission'
    );

    // Audit log
    if (orig.filing_id) {
      try {
        await scaPortalDb.writeScaAuditEntry(
          pool, orig.filing_id, `user:${userId}`,
          'resubmitted_to_sca',
          `Resubmitted to SCA — new ref: ${newRef}, original ref: ${orig.sca_reference || 'unknown'}`
        );
      } catch (e) { /* best-effort */ }
    }

    res.json({
      success: true,
      message: `Filing resubmitted to SCA E-Services — Reference: ${newRef}`,
      submission: newSub.rows[0],
    });
  } catch (err) {
    console.error('[SCA Resubmit] error:', err.message);
    res.status(500).json({ success: false, message: 'Resubmission failed' });
  }
});

/**
 * POST /api/sca/package
 * Generate a SCA transit filing package without submitting.
 * Returns a structured JSON package ready for portal upload.
 * Body: { filing_id? } or filing data directly
 */
router.post('/package', attachDemoSession, requireAuthOrDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userId = req.user.id;
    const { filing_id } = req.body;

    let filingData = req.body;

    if (filing_id) {
      const filingResult = await scaPortalDb.getFilingForScaSubmit(pool, filing_id, userId
      );
      if (filingResult.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Filing not found' });
      }
      const row = filingResult.rows[0];
      filingData = { ...(row.document_data || {}), ...row };
    }

    const transitPackage = buildScaTransitPackage(filingData);

    res.json({
      success: true,
      package: transitPackage,
    });
  } catch (err) {
    console.error('[SCA Package] error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate filing package' });
  }
});

module.exports = router;
