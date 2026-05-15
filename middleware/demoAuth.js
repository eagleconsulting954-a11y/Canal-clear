/**
 * middleware/demoAuth.js — Demo session authentication middleware.
 *
 * Owns: reading and validating demo session cookies, attaching demo context to req.
 * Does NOT own: session creation/deletion (routes/demo.js), code management (db/demo-codes.js).
 *
 * Demo context attached to req when a valid demo session is present:
 *   req.demoSession = { sessionToken, demoCodeId, demoCode, expiresAt }
 *   req.demoUser    = { waterways: [...], planType: 'demo', subscriptionStatus: 'demo' }
 *
 * Usage in routes that should accept both real and demo users:
 *   router.get('/filings', attachDemoSession, requireAuthOrDemo, handler)
 *   // check req.user (JWT) || req.demoUser (demo session)
 */

const jwt = require('jsonwebtoken');
const { getDemoSessionByToken, touchDemoSession } = require('../db/demo-codes');
const { JWT_SECRET } = require('./auth');

const DEMO_COOKIE = 'cc_demo_token';
const DEMO_WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];

/**
 * Middleware: attach demo context to req if a valid demo session cookie is present.
 * Non-blocking — always calls next(). Callers decide what to do with req.demoSession.
 *
 * After this middleware runs:
 *   req.demoSession — populated if demo session is valid, null otherwise
 *   req.demoUser    — populated if demo session is valid, null otherwise
 */
async function attachDemoSession(req, res, next) {
  const token = req.cookies && req.cookies[DEMO_COOKIE];

  if (!token) {
    req.demoSession = null;
    req.demoUser = null;
    return next();
  }

  try {
    const pool = req.app.locals.pool;
    const session = await getDemoSessionByToken(pool, token);

    if (!session) {
      // Expired or revoked — clear cookie
      res.clearCookie(DEMO_COOKIE, { path: '/' });
      req.demoSession = null;
      req.demoUser = null;
      return next();
    }

    // Touch last_active_at (fire-and-forget)
    touchDemoSession(pool, token).catch(() => {});

    req.demoSession = {
      id: session.id,
      sessionToken: session.session_token,
      demoCodeId: session.demo_code_id,
      demoCode: session.demo_code,
      expiresAt: session.expires_at,
    };

    req.demoUser = {
      isDemo: true,
      planType: 'demo',
      subscriptionStatus: 'demo',
      waterways: DEMO_WATERWAYS,
      allowed_canals: DEMO_WATERWAYS,
      subscription_plan: 'demo_bundle',
    };

  } catch (err) {
    console.error('[demoAuth] session lookup error:', err.message);
    req.demoSession = null;
    req.demoUser = null;
  }

  return next();
}

/**
 * Middleware: require a valid demo session OR a valid regular auth session.
 * Combines requireAuth behaviour with demo session fallback.
 *
 * Verifies JWT from cookie/header (setting req.user) OR accepts a valid demo session.
 * Must be placed AFTER attachDemoSession in the middleware chain.
 */
function requireAuthOrDemo(req, res, next) {
  // ── Step 1: Try JWT authentication (same logic as requireAuth) ─────────
  if (!req.user) {
    const token = extractToken(req);
    if (token) {
      try {
        req.user = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        // Token invalid/expired — fall through to demo check
      }
    }
  }

  if (req.user) return next(); // real user authenticated

  // ── Step 2: Fall back to demo session ──────────────────────────────────
  if (req.demoUser) {
    req.user = {
      id: `demo_${req.demoSession.id}`,
      email: 'demo@canalclear.demo',
      isDemo: true,
      subscription_status: 'demo',
      subscription_plan: 'demo_bundle',
      allowed_canals: DEMO_WATERWAYS,
      is_admin: false,
    };
    req.dbUser = {
      ...req.user,
      plan_type: 'demo',
      vessel_limit: 999,
      account_type: 'operator',
    };
    return next();
  }

  // ── Step 3: Neither auth method worked — reject ────────────────────────
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

/**
 * Extract JWT from request (cookie, Authorization header, or query param).
 * Mirrors the logic in middleware/auth.js extractToken.
 */
function extractToken(req) {
  if (req.cookies && req.cookies.cc_token) return req.cookies.cc_token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query && req.query.token) return req.query.token;
  return null;
}

module.exports = { attachDemoSession, requireAuthOrDemo, DEMO_COOKIE, DEMO_WATERWAYS };
