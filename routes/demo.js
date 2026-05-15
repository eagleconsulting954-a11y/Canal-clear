/**
 * routes/demo.js — Demo access code routes.
 *
 * Owns: demo code redemption, session check, logout, and admin CRUD for demo codes.
 * Does NOT own: real user auth (routes/api.js), admin panel HTML (public/admin.html).
 *
 * Public routes:
 *   POST /api/demo/redeem       — validate code, create session, set cookie
 *   GET  /api/demo/session      — check if current request has a valid demo session
 *   POST /api/demo/logout       — clear demo session
 *
 * Admin routes (require requireAuth + requireAdmin):
 *   GET  /api/demo/admin/codes       — list all demo codes
 *   POST /api/demo/admin/codes       — generate new demo code
 *   POST /api/demo/admin/codes/:id/revoke — revoke a code
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { DEMO_COOKIE, DEMO_WATERWAYS } = require('../middleware/demoAuth');
const {
  createDemoCode,
  getDemoCodeByCode,
  incrementUseCount,
  listDemoCodes,
  revokeDemoCode,
  createDemoSession,
  getDemoSessionByToken,
  deleteDemoSession,
} = require('../db/demo-codes');

const DEMO_SESSION_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 48 * 60 * 60 * 1000, // 48 hours
  path: '/',
};

/**
 * Generate a random demo code in format DEMO-XXXXXX
 */
function generateDemoCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // omit I,O,1,0 for clarity
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DEMO-${suffix}`;
}

// ── Public: redeem a demo code ────────────────────────────────────────────────

router.post('/redeem', async (req, res) => {
  const pool = req.app.locals.pool;
  const { code } = req.body || {};

  if (!code || typeof code !== 'string') {
    return res.status(400).json({ success: false, message: 'Demo code is required.' });
  }

  try {
    const demoCode = await getDemoCodeByCode(pool, code);

    if (!demoCode) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code.' });
    }

    // Create session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    const session = await createDemoSession(pool, {
      demoCodeId: demoCode.id,
      sessionToken,
      ipAddress,
      userAgent,
    });

    // Increment use count (fire-and-forget on error)
    incrementUseCount(pool, demoCode.id).catch(err =>
      console.error('[demo] incrementUseCount error:', err.message)
    );

    res.cookie(DEMO_COOKIE, sessionToken, DEMO_SESSION_OPTS);

    return res.json({
      success: true,
      waterways: DEMO_WATERWAYS,
      expires_at: session.expires_at,
      redirect: '/app',
    });
  } catch (err) {
    console.error('[demo] redeem error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ── Public: check demo session ────────────────────────────────────────────────

router.get('/session', async (req, res) => {
  const pool = req.app.locals.pool;
  const token = req.cookies && req.cookies[DEMO_COOKIE];

  if (!token) {
    return res.json({ is_demo: false });
  }

  try {
    const session = await getDemoSessionByToken(pool, token);

    if (!session) {
      res.clearCookie(DEMO_COOKIE, { path: '/' });
      return res.json({ is_demo: false });
    }

    return res.json({
      is_demo: true,
      demo_code: session.demo_code,
      waterways: DEMO_WATERWAYS,
      expires_at: session.expires_at,
    });
  } catch (err) {
    console.error('[demo] session check error:', err.message);
    return res.json({ is_demo: false });
  }
});

// ── Public: logout demo session ───────────────────────────────────────────────

router.post('/logout', async (req, res) => {
  const pool = req.app.locals.pool;
  const token = req.cookies && req.cookies[DEMO_COOKIE];

  if (token) {
    try {
      await deleteDemoSession(pool, token);
    } catch (err) {
      console.error('[demo] logout delete error:', err.message);
    }
  }

  res.clearCookie(DEMO_COOKIE, { path: '/' });
  return res.json({ success: true, redirect: '/login' });
});

// ── Admin: list all demo codes ────────────────────────────────────────────────

router.get('/admin/codes', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const codes = await listDemoCodes(pool);
    return res.json({ success: true, codes });
  } catch (err) {
    console.error('[demo] list codes error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: create a new demo code ─────────────────────────────────────────────

router.post('/admin/codes', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { expires_at, max_uses, notes } = req.body || {};

  try {
    // Generate a unique code (retry up to 5 times on collision)
    let code;
    let demoCode;
    for (let attempt = 0; attempt < 5; attempt++) {
      code = generateDemoCode();
      try {
        demoCode = await createDemoCode(pool, {
          code,
          expiresAt: expires_at || null,
          maxUses: max_uses || 10,
          createdBy: req.user.email || 'admin',
          notes: notes || null,
        });
        break;
      } catch (err) {
        // unique constraint violation — try again
        if (err.code === '23505') continue;
        throw err;
      }
    }

    if (!demoCode) {
      return res.status(500).json({ success: false, message: 'Failed to generate unique code' });
    }

    return res.json({ success: true, code: demoCode });
  } catch (err) {
    console.error('[demo] create code error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Admin: revoke a demo code ─────────────────────────────────────────────────

router.post('/admin/codes/:id/revoke', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;

  if (!id || isNaN(parseInt(id))) {
    return res.status(400).json({ success: false, message: 'Invalid code ID' });
  }

  try {
    const revoked = await revokeDemoCode(pool, parseInt(id));

    if (!revoked) {
      return res.status(404).json({ success: false, message: 'Code not found' });
    }

    return res.json({ success: true, code: revoked });
  } catch (err) {
    console.error('[demo] revoke code error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
