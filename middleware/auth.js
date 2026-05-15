const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const usersDb = require('../db/users');

const JWT_SECRET = process.env.JWT_SECRET || 'REDACTED';

/**
 * Hash a password using Node's built-in scrypt
 */
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/**
 * Verify a password against a stored hash
 */
function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    const [salt, key] = stored.split(':');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derivedKey));
    });
  });
}

/**
 * Sign a JWT for a user
 */
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      subscription_status: user.subscription_status,
      is_admin: user.is_admin || false,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Middleware: require valid JWT cookie or Authorization header
 * On failure, redirects to /login (for HTML routes) or 401 (for API)
 */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
    return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  }
}

/** Grace period: 7 days after subscription expires/cancels */
const GRACE_PERIOD_DAYS = 7;

/**
 * Middleware: require active subscription (with 7-day grace period)
 * Must be used after requireAuth.
 *
 * Behaviour:
 *  - Active/trialing → pass through
 *  - Cancelled/expired within 7 days → pass through, set req.inGracePeriod = true
 *  - Cancelled/expired > 7 days or never had subscription → redirect to /pricing
 */
async function requireSubscription(req, res, next) {
  const pool = req.app.locals.pool;

  try {
    const user = await usersDb.getUserSubscriptionById(pool, req.user.id);

    if (!user) {
      return res.redirect('/login');
    }

    const isActive = isSubscriptionActive(user);

    if (isActive) {
      req.dbUser = user;
      req.inGracePeriod = false;
      return next();
    }

    // Not active — check grace period
    const cancelledStatuses = ['canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete_expired'];
    const wasPaid = cancelledStatuses.includes(user.subscription_status);

    if (wasPaid) {
      // Record when grace period started (first time we see cancelled status)
      let graceStart = user.grace_period_started_at ? new Date(user.grace_period_started_at) : null;

      if (!graceStart) {
        graceStart = new Date();
        await usersDb.setGracePeriodStarted(pool, user.id)
          .catch(err => console.error('[Grace] update error:', err.message));
      }

      const graceEnd = new Date(graceStart.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
      if (new Date() < graceEnd) {
        const daysLeft = Math.ceil((graceEnd - new Date()) / (24 * 60 * 60 * 1000));
        req.dbUser = user;
        req.inGracePeriod = true;
        req.graceDaysRemaining = daysLeft;
        return next();
      }
    }

    // Hard block — redirect to pricing
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ success: false, message: 'Active subscription required', redirect: '/pricing' });
    }
    return res.redirect('/pricing?reason=no_subscription');
  } catch (err) {
    console.error('Subscription check error:', err);
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Auth error' });
    }
    return res.redirect('/pricing?reason=error');
  }
}

/**
 * Check if a user has an active subscription
 */
function isSubscriptionActive(user) {
  if (!user.subscription_status) return false;
  const activeStatuses = ['active', 'trialing'];
  if (!activeStatuses.includes(user.subscription_status)) return false;
  if (user.subscription_expires_at && new Date(user.subscription_expires_at) < new Date()) return false;
  return true;
}

/**
 * Extract JWT from request (cookie or Authorization header or query param)
 */
function extractToken(req) {
  if (req.cookies && req.cookies.cc_token) return req.cookies.cc_token;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.query && req.query.token) return req.query.token;
  return null;
}

/**
 * Middleware: require admin role
 * Must be used after requireAuth.
 * Checks is_admin flag in DB (not just JWT) for security.
 */
async function requireAdmin(req, res, next) {
  const pool = req.app.locals.pool;

  try {
    const result = await usersDb.getUserAdminStatus(pool, req.user.id);

    if (!result || !result.is_admin) {
      if (req.originalUrl.startsWith('/api/')) {
        return res.status(403).json({ success: false, message: 'Admin access required' });
      }
      return res.redirect('/login');
    }

    next();
  } catch (err) {
    console.error('Admin check error:', err);
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(500).json({ success: false, message: 'Auth error' });
    }
    return res.redirect('/login');
  }
}

/**
 * On server startup: ensure ADMIN_EMAIL user(s) exist and are marked as admin.
 * Supports comma-separated emails in ADMIN_EMAIL env var.
 * Creates users if they don't exist (with password from ADMIN_PASSWORD env or default).
 * Grants admin to existing users who aren't yet admins.
 */
async function seedAdminFromEnv(pool) {
  const adminEmailRaw = process.env.ADMIN_EMAIL;
  if (!adminEmailRaw) return;

  const emails = adminEmailRaw.split(',').map(e => e.toLowerCase().trim()).filter(Boolean);

  for (const normalized of emails) {
    try {
      const existing = await usersDb.getAdminSeedCandidate(pool, normalized);

      const adminPassword = process.env.ADMIN_PASSWORD || 'CanalClear2026!';

      if (!existing) {
        // User doesn't exist — create with password from env (or default)
        const hash = await hashPassword(adminPassword);
        await usersDb.createAdminUser(pool, normalized, hash);
        console.log(`[Admin] Created admin user from ADMIN_EMAIL: ${normalized}`);
      } else if (!existing.is_admin) {
        // User exists but not admin — grant admin + force-sync password
        await usersDb.seedAdminByEmail(pool, normalized);
        const hash = await hashPassword(adminPassword);
        await usersDb.setPasswordById(pool, existing.id, hash);
        console.log(`[Admin] Granted admin + synced password via ADMIN_EMAIL: ${normalized}`);
      } else {
        // Already admin — always sync password to match ADMIN_PASSWORD env var.
        // Without this, a stale hash from a previous deploy locks admins out.
        const hash = await hashPassword(adminPassword);
        await usersDb.setPasswordById(pool, existing.id, hash);
        console.log(`[Admin] Synced password for existing admin: ${normalized}`);
      }
    } catch (err) {
      console.error(`[Admin] seedAdminFromEnv error for ${normalized}:`, err.message);
    }
  }
}

/**
 * Derive the set of canals a subscription_plan grants access to.
 * Used both at provisioning time (to populate allowed_canals) and as a
 * runtime fallback when allowed_canals column is NULL.
 *
 * @param {string} plan  — e.g. 'agent_pro_panama', 'ops_manager_bundle'
 * @returns {string[]}   — subset of ['panama','suez','bosporus','malacca','cape']
 */
function canalsForPlan(plan) {
  if (!plan) return [];
  const p = plan.toLowerCase();
  const ALL_CANALS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  // Bundle plans — full access
  if (p.includes('bundle')) return ALL_CANALS;
  // Agency plans — full access by default; individual waterway overrides are
  // stored in users.allowed_canals at provisioning time via pending_agency_waterway cookie.
  if (p.startsWith('agency_')) return ALL_CANALS;
  // Legacy plans that predate per-canal billing → grant all (grandfather)
  if (['enterprise', 'fleet', 'pro', 'single_transit', 'active'].includes(p)) {
    return ALL_CANALS;
  }
  // Per-canal plans
  const canals = [];
  if (p.includes('panama'))   canals.push('panama');
  if (p.includes('suez'))     canals.push('suez');
  if (p.includes('bosporus')) canals.push('bosporus');
  if (p.includes('malacca'))  canals.push('malacca');
  if (p.includes('cape'))     canals.push('cape');
  return canals;
}

/**
 * Middleware factory: require the authenticated user to have access to a
 * specific waterway.
 *
 * Usage:
 *   router.post('/filings', requireAuth, requireWaterway('bosporus'), handler)
 *
 * Access rules (checked in order):
 *   1. Admin users → always allowed.
 *   2. users.allowed_canals column (set at subscription time) → checked first.
 *   3. Fallback: derive from subscription_plan via canalsForPlan().
 *
 * On denial: 403 JSON with upgrade_url and the waterway name.
 * Must be placed after requireAuth (needs req.user.id).
 */
function requireWaterway(canal) {
  return async function waterwayGuard(req, res, next) {
    // Always let admins through
    if (req.user && req.user.is_admin) return next();

    const pool = req.app.locals.pool;
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
      const user = await usersDb.getUserWaterwayAccess(pool, userId);

      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }

      // Admins bypass waterway check (double-check against DB, not just JWT)
      if (user.is_admin) return next();

      // Determine allowed canals: prefer DB column, fall back to plan derivation
      const allowed = (user.allowed_canals && user.allowed_canals.length > 0)
        ? user.allowed_canals
        : canalsForPlan(user.subscription_plan);

      if (allowed.includes(canal)) return next();

      // Access denied — return structured 403
      const CANAL_NAMES = {
        panama:   'Panama Canal',
        suez:     'Suez Canal',
        bosporus: 'Bosporus / Turkish Straits',
        malacca:  'Strait of Malacca',
        cape:     'Cape of Good Hope',
      };
      const canalName = CANAL_NAMES[canal] || canal;

      return res.status(403).json({
        success: false,
        waterway_access_denied: true,
        canal,
        canal_name: canalName,
        allowed_canals: allowed,
        message: `Your current plan does not include access to ${canalName}. Upgrade to add this waterway.`,
        upgrade_url: '/pricing',
      });
    } catch (err) {
      console.error('[requireWaterway] DB error:', err.message);
      return res.status(500).json({ success: false, message: 'Access check failed' });
    }
  };
}

/**
 * Middleware factory: require the user to have an agent plan_type.
 * Prevents ops_manager users from accessing agent-specific routes.
 * Must be placed after requireSubscription.
 */
function requireAgentPlan(req, res, next) {
  const plan = req.dbUser && req.dbUser.plan_type;
  // agent_pro and agency plans both have access to the agent dashboard
  if (!plan || (plan !== 'agent_pro' && plan !== 'agency')) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ success: false, message: 'Agent plan required', redirect: '/app' });
    }
    return res.redirect('/app');
  }
  return next();
}

/**
 * Middleware factory: require the user to have an ops_manager plan_type.
 * Prevents agent_pro users from accessing fleet ops routes.
 * Must be placed after requireSubscription.
 */
function requireOpsPlan(req, res, next) {
  const plan = req.dbUser && req.dbUser.plan_type;
  if (!plan || plan !== 'ops_manager') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ success: false, message: 'Ops plan required', redirect: '/app' });
    }
    return res.redirect('/app');
  }
  return next();
}

module.exports = { hashPassword, verifyPassword, signToken, requireAuth, requireSubscription, requireAdmin, seedAdminFromEnv, isSubscriptionActive, JWT_SECRET, canalsForPlan, requireWaterway, requireAgentPlan, requireOpsPlan };
