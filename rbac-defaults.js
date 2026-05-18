/**
 * services/rbac-defaults.js
 * Owns: seeding the 4 default system roles (Admin, Compliance Officer, Operator, Viewer)
 *       when a new organization is created.
 * Does NOT own: role CRUD (db/rbac.js), permission enforcement (middleware/rbac.js).
 */

const { createRole } = require('../db/rbac');

/**
 * Default role definitions.
 * permissions keys are resource names; values are arrays of allowed actions.
 * waterways: ['all'] means access to all waterways.
 */
const DEFAULT_ROLES = [
  {
    name: 'Admin',
    description: 'Full access: manage users, billing, SSO, all waterways, all filings, all settings.',
    permissions: {
      filings:  ['create', 'read', 'update', 'delete', 'submit', 'approve'],
      vessels:  ['create', 'read', 'update', 'delete'],
      alerts:   ['create', 'read', 'update', 'delete'],
      reports:  ['read', 'export'],
      users:    ['create', 'read', 'update', 'delete', 'invite'],
      billing:  ['read', 'update'],
      settings: ['read', 'update'],
    },
    waterways: ['all'],
    isDefault: false,
    isSystem: true,
  },
  {
    name: 'Compliance Officer',
    description: 'Create, edit, and submit filings. Manage deadline alerts. View fleet dashboard. Export reports. Cannot manage users or billing.',
    permissions: {
      filings:  ['create', 'read', 'update', 'delete', 'submit'],
      vessels:  ['create', 'read', 'update'],
      alerts:   ['create', 'read', 'update', 'delete'],
      reports:  ['read', 'export'],
      users:    [],
      billing:  [],
      settings: ['read'],
    },
    waterways: ['all'],
    isDefault: true,  // default for new invitations
    isSystem: true,
  },
  {
    name: 'Operator',
    description: 'Create and edit draft filings only. Cannot submit (requires Compliance Officer approval). Read-only fleet dashboard. Assigned vessels only.',
    permissions: {
      filings:  ['create', 'read', 'update'],
      vessels:  ['read'],
      alerts:   ['read'],
      reports:  ['read'],
      users:    [],
      billing:  [],
      settings: [],
    },
    waterways: ['all'],
    isDefault: false,
    isSystem: true,
  },
  {
    name: 'Viewer',
    description: 'Read-only access to filings, reports, and fleet dashboard. Cannot create, edit, or submit anything. Intended for executives and oversight.',
    permissions: {
      filings:  ['read'],
      vessels:  ['read'],
      alerts:   ['read'],
      reports:  ['read'],
      users:    [],
      billing:  [],
      settings: [],
    },
    waterways: ['all'],
    isDefault: false,
    isSystem: true,
  },
];

/**
 * Seed the 4 default roles for a newly created organization.
 * Returns array of created role rows.
 */
async function seedDefaultRoles(pool, orgId) {
  const created = [];
  for (const roleDef of DEFAULT_ROLES) {
    try {
      const role = await createRole(pool, { orgId, ...roleDef });
      created.push(role);
    } catch (err) {
      // Role already exists (e.g. re-seeding idempotency) — fetch and continue
      if (err.code === '23505') continue; // unique violation
      throw err;
    }
  }
  return created;
}

/**
 * Get the RBAC role name that maps to a given permission set (for display purposes).
 */
function getRoleLabel(roleName) {
  const labels = {
    Admin: 'Admin',
    'Compliance Officer': 'Compliance Officer',
    Operator: 'Operator',
    Viewer: 'Viewer',
  };
  return labels[roleName] || roleName;
}

module.exports = { seedDefaultRoles, DEFAULT_ROLES, getRoleLabel };
