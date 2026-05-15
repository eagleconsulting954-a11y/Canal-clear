/**
 * db/rbac.js
 * Owns: organizations, roles, user_roles, org_invitations tables — RBAC data layer.
 * Does NOT own: JWT issuance (middleware/auth.js), permission evaluation (middleware/rbac.js),
 *               default role seeding (services/rbac-defaults.js).
 */

// ── Organizations ─────────────────────────────────────────────────────────────

async function createOrganization(pool, { name }) {
  const result = await pool.query(
    `INSERT INTO organizations (name) VALUES ($1) RETURNING *`,
    [name]
  );
  return result.rows[0];
}

async function getOrganizationById(pool, orgId) {
  const result = await pool.query(
    `SELECT * FROM organizations WHERE id = $1`,
    [orgId]
  );
  return result.rows[0] || null;
}

async function setUserOrg(pool, userId, orgId) {
  await pool.query(`UPDATE users SET org_id = $1 WHERE id = $2`, [orgId, userId]);
}

// ── Roles ─────────────────────────────────────────────────────────────────────

async function createRole(pool, { orgId, name, description, permissions, waterways, isDefault, isSystem }) {
  const result = await pool.query(
    `INSERT INTO roles (org_id, name, description, permissions, waterways, is_default, is_system)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [orgId, name, description || null, JSON.stringify(permissions || {}), waterways || ['all'], isDefault || false, isSystem || false]
  );
  return result.rows[0];
}

async function getRolesByOrg(pool, orgId) {
  const result = await pool.query(
    `SELECT * FROM roles WHERE org_id = $1 ORDER BY is_system DESC, name ASC`,
    [orgId]
  );
  return result.rows;
}

async function getRoleById(pool, roleId) {
  const result = await pool.query(`SELECT * FROM roles WHERE id = $1`, [roleId]);
  return result.rows[0] || null;
}

async function updateRole(pool, roleId, { name, description, permissions, waterways }) {
  const result = await pool.query(
    `UPDATE roles
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         permissions = COALESCE($3, permissions),
         waterways = COALESCE($4, waterways),
         updated_at = NOW()
     WHERE id = $5 AND is_system = FALSE
     RETURNING *`,
    [name, description, permissions ? JSON.stringify(permissions) : null, waterways, roleId]
  );
  return result.rows[0] || null;
}

async function deleteRole(pool, roleId) {
  // Only non-system roles can be deleted
  await pool.query(`DELETE FROM roles WHERE id = $1 AND is_system = FALSE`, [roleId]);
}

// ── User Roles ─────────────────────────────────────────────────────────────────

async function assignUserRole(pool, { userId, orgId, roleId, assignedBy }) {
  const result = await pool.query(
    `INSERT INTO user_roles (user_id, org_id, role_id, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, org_id) DO UPDATE SET role_id = $3, assigned_by = $4, assigned_at = NOW()
     RETURNING *`,
    [userId, orgId, roleId, assignedBy || null]
  );
  return result.rows[0];
}

async function getUserRole(pool, userId, orgId) {
  const result = await pool.query(
    `SELECT ur.*, r.name as role_name, r.permissions, r.waterways, r.is_system
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND ur.org_id = $2`,
    [userId, orgId]
  );
  return result.rows[0] || null;
}

async function removeUserRole(pool, userId, orgId) {
  await pool.query(
    `DELETE FROM user_roles WHERE user_id = $1 AND org_id = $2`,
    [userId, orgId]
  );
}

/**
 * List all members of an org with their roles and user info.
 */
async function getOrgMembers(pool, orgId) {
  const result = await pool.query(
    `SELECT u.id, u.email, u.created_at as joined_at,
            r.id as role_id, r.name as role_name, r.waterways,
            ur.assigned_at, ur.assigned_by,
            (SELECT email FROM users WHERE id = ur.assigned_by) as assigned_by_email
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.org_id = $1
     JOIN roles r ON r.id = ur.role_id
     ORDER BY ur.assigned_at ASC`,
    [orgId]
  );
  return result.rows;
}

// ── Invitations ────────────────────────────────────────────────────────────────

async function createInvitation(pool, { orgId, email, roleId, invitedBy, token }) {
  // Delete any existing unexpired invitation for this email+org
  await pool.query(
    `DELETE FROM org_invitations WHERE org_id = $1 AND email = LOWER($2) AND accepted_at IS NULL`,
    [orgId, email]
  );
  const result = await pool.query(
    `INSERT INTO org_invitations (org_id, email, role_id, invited_by, token, expires_at)
     VALUES ($1, LOWER($2), $3, $4, $5, NOW() + INTERVAL '7 days')
     RETURNING *`,
    [orgId, email, roleId, invitedBy, token]
  );
  return result.rows[0];
}

async function getInvitationByToken(pool, token) {
  const result = await pool.query(
    `SELECT i.*, o.name as org_name, r.name as role_name, r.permissions, r.waterways,
            (SELECT email FROM users WHERE id = i.invited_by) as invited_by_email
     FROM org_invitations i
     JOIN organizations o ON o.id = i.org_id
     JOIN roles r ON r.id = i.role_id
     WHERE i.token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

async function acceptInvitation(pool, invitationId) {
  await pool.query(
    `UPDATE org_invitations SET accepted_at = NOW() WHERE id = $1`,
    [invitationId]
  );
}

async function getPendingInvitations(pool, orgId) {
  const result = await pool.query(
    `SELECT i.*, r.name as role_name,
            (SELECT email FROM users WHERE id = i.invited_by) as invited_by_email
     FROM org_invitations i
     JOIN roles r ON r.id = i.role_id
     WHERE i.org_id = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()
     ORDER BY i.created_at DESC`,
    [orgId]
  );
  return result.rows;
}

async function revokeInvitation(pool, invitationId, orgId) {
  await pool.query(
    `DELETE FROM org_invitations WHERE id = $1 AND org_id = $2`,
    [invitationId, orgId]
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Get user's effective permissions for permission-checking middleware.
 * Returns null if user has no org role.
 */
async function getUserPermissions(pool, userId, orgId) {
  const result = await pool.query(
    `SELECT r.name as role_name, r.permissions, r.waterways, r.is_system
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND ur.org_id = $2`,
    [userId, orgId]
  );
  return result.rows[0] || null;
}

/**
 * Find the default Admin role for an org.
 */
async function getAdminRoleForOrg(pool, orgId) {
  const result = await pool.query(
    `SELECT * FROM roles WHERE org_id = $1 AND name = 'Admin' AND is_system = TRUE LIMIT 1`,
    [orgId]
  );
  return result.rows[0] || null;
}

/**
 * Find default role for new invitations (Compliance Officer).
 */
async function getDefaultRoleForOrg(pool, orgId) {
  const result = await pool.query(
    `SELECT * FROM roles WHERE org_id = $1 AND is_default = TRUE LIMIT 1`,
    [orgId]
  );
  return result.rows[0] || null;
}

/**
 * Find a user by email (case-insensitive). Returns { id } or null.
 */
async function findUserByEmail(pool, email) {
  const result = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Look up a user's org_id and email together (used by invite + accept flows).
 */
async function getUserOrgInfo(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, org_id FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Clear org_id on a user (removal from org).
 */
async function clearUserOrg(pool, userId, orgId) {
  await pool.query(
    `UPDATE users SET org_id = NULL WHERE id = $1 AND org_id = $2`,
    [userId, orgId]
  );
}

/**
 * Find system Admin role by org_id using raw query (avoids requiring separate import).
 */
async function getAdminRoleIdForOrg(pool, orgId) {
  const result = await pool.query(
    `SELECT id FROM roles WHERE org_id = $1 AND name = 'Admin' LIMIT 1`,
    [orgId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

/**
 * Update organization name.
 */
async function updateOrganizationName(pool, orgId, name) {
  const result = await pool.query(
    `UPDATE organizations SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [name, orgId]
  );
  return result.rows[0] || null;
}

module.exports = {
  createOrganization,
  getOrganizationById,
  setUserOrg,
  getUserOrgInfo,
  findUserByEmail,
  clearUserOrg,
  getAdminRoleIdForOrg,
  updateOrganizationName,
  createRole,
  getRolesByOrg,
  getRoleById,
  updateRole,
  deleteRole,
  assignUserRole,
  getUserRole,
  removeUserRole,
  getOrgMembers,
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  getPendingInvitations,
  revokeInvitation,
  getUserPermissions,
  getAdminRoleForOrg,
  getDefaultRoleForOrg,
};
