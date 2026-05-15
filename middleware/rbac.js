/**
 * middleware/rbac.js
 * Owns: RBAC permission enforcement — requirePermission(action, resource, waterway?) factory.
 *       requireOrgAdmin — shortcut for admin-only routes.
 *       loadUserRbac — attaches req.rbac (role name + permissions + waterways) to every authed request.
 * Does NOT own: role/org CRUD (db/rbac.js), default role seeding (services/rbac-defaults.js),
 *               JWT verification (middleware/auth.js).
 *
 * Usage:
 *   router.post('/filings', requireAuth, requirePermission('create', 'filings', 'bosporus'), handler)
 *   router.get('/settings/billing', requireAuth, requirePermission('read', 'billing'), handler)
 *   router.post('/settings/team/invite', requireAuth, requireOrgAdmin, handler)
 */

const { getUserPermissions, getUserOrgInfo } = require('../db/rbac');

/**
 * Attach RBAC context to req.rbac.
 * Loads org_id from req.dbUser (set by requireSubscription) or DB fallback.
 * Silently sets req.rbac = null if user has no org (solo users — all access granted).
 * Must be called after requireAuth.
 */
async function loadUserRbac(req, res, next) {
  // Super-admins bypass RBAC entirely
  if (req.user && req.user.is_admin) {
    req.rbac = { roleName: 'Admin', permissions: {}, waterways: ['all'], isSuperAdmin: true };
    return next();
  }

  const pool = req.app.locals.pool;
  const userId = req.user && req.user.id;
  if (!userId) return next();

  try {
    // Get org_id from DB (users.org_id)
    const userRow = await getUserOrgInfo(pool, userId);
    const orgId = userRow && userRow.org_id;

    if (!orgId) {
      // Solo user — no org, no RBAC restrictions
      req.rbac = null;
      return next();
    }

    const perms = await getUserPermissions(pool, userId, orgId);
    if (!perms) {
      req.rbac = null;
      return next();
    }

    req.rbac = {
      roleName: perms.role_name,
      permissions: perms.permissions || {},
      waterways: perms.waterways || ['all'],
      orgId,
      isSuperAdmin: false,
    };
    next();
  } catch (err) {
    console.error('[RBAC] loadUserRbac error:', err.message);
    req.rbac = null;
    next();
  }
}

/**
 * Factory: require a specific action on a resource (optionally scoped to a waterway).
 *
 * @param {string} action    — 'create'|'read'|'update'|'delete'|'submit'|'approve'|'export'|'invite'
 * @param {string} resource  — 'filings'|'vessels'|'alerts'|'reports'|'users'|'billing'|'settings'
 * @param {string} [waterway] — 'panama'|'suez'|'bosporus'|'malacca'|'cape' (optional)
 *
 * Must follow requireAuth in the middleware chain.
 * Solo users (req.rbac === null) pass through — RBAC only kicks in for org members.
 */
function requirePermission(action, resource, waterway) {
  return async function rbacGuard(req, res, next) {
    // Ensure rbac is loaded
    if (req.rbac === undefined) {
      await loadUserRbac(req, res, () => {});
    }

    // Super-admins always pass
    if (req.rbac && req.rbac.isSuperAdmin) return next();

    // Solo users (no org) — pass through (existing single-user access rules apply)
    if (req.rbac === null || req.rbac === undefined) return next();

    const { permissions, waterways } = req.rbac;

    // Check resource + action
    const allowed = permissions[resource] || [];
    if (!allowed.includes(action)) {
      return res.status(403).json({
        success: false,
        rbac_denied: true,
        message: `Your role (${req.rbac.roleName}) does not have ${action} access to ${resource}.`,
        required_action: action,
        required_resource: resource,
      });
    }

    // Check waterway scope if provided
    if (waterway) {
      const hasWaterway = waterways.includes('all') || waterways.includes(waterway);
      if (!hasWaterway) {
        return res.status(403).json({
          success: false,
          rbac_denied: true,
          message: `Your role (${req.rbac.roleName}) does not have access to the ${waterway} waterway.`,
          required_waterway: waterway,
          allowed_waterways: waterways,
        });
      }
    }

    next();
  };
}

/**
 * Shortcut: require Admin role (system role name check + is_admin fallback).
 * Use for team management, billing, SSO config routes.
 */
async function requireOrgAdmin(req, res, next) {
  // Site super-admins always pass
  if (req.user && req.user.is_admin) return next();

  if (req.rbac === undefined) {
    await loadUserRbac(req, res, () => {});
  }

  // Solo users without an org cannot access org-admin routes
  if (!req.rbac) {
    return res.status(403).json({
      success: false,
      message: 'Organization admin access required. Set up your team first.',
    });
  }

  if (req.rbac.isSuperAdmin) return next();

  if (req.rbac.roleName !== 'Admin') {
    return res.status(403).json({
      success: false,
      rbac_denied: true,
      message: 'Only organization Admins can perform this action.',
    });
  }

  next();
}

module.exports = { loadUserRbac, requirePermission, requireOrgAdmin };
