/**
 * routes/rbac.js
 * Owns: RBAC team management API — org creation, member invitation, role assignment,
 *       member listing, role revocation, invitation acceptance.
 *       /api/team/* endpoints (Admin only) + /api/team/accept-invite (token-gated).
 * Does NOT own: permission enforcement middleware (middleware/rbac.js),
 *               role seeding (services/rbac-defaults.js),
 *               CRUD data access (db/rbac.js).
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requireOrgAdmin, loadUserRbac } = require('../middleware/rbac');
const {
  createOrganization,
  getOrganizationById,
  setUserOrg,
  getUserOrgInfo,
  findUserByEmail,
  clearUserOrg,
  getAdminRoleIdForOrg,
  updateOrganizationName,
  getRolesByOrg,
  getRoleById,
  assignUserRole,
  getUserRole,
  removeUserRole,
  getOrgMembers,
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  getPendingInvitations,
  revokeInvitation,
  getDefaultRoleForOrg,
} = require('../db/rbac');
const { seedDefaultRoles } = require('../services/rbac-defaults');

const APP_URL = process.env.APP_URL || 'https://canalclear.org';

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendInvitationEmail({ to, inviterEmail, orgName, roleName, token }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.log('[RBAC] POLSIA_API_KEY not set — skipping invitation email to', to);
    return;
  }

  const acceptUrl = `${APP_URL}/join?token=${token}`;

  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;">
  <div style="background:#0A1628;padding:28px 40px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="color:#00D4AA;font-size:1.4rem;margin:0;">CanalClear</h1>
    <p style="color:#8899AA;font-size:0.8rem;margin:4px 0 0;">Maritime Compliance Automation</p>
  </div>
  <div style="padding:32px 40px;background:#F8FAFC;border-radius:0 0 12px 12px;">
    <h2 style="color:#1E293B;font-size:1.2rem;margin:0 0 16px;">You've been invited to join ${orgName}</h2>
    <p style="color:#475569;margin:0 0 12px;"><strong>${inviterEmail}</strong> has invited you to join their team on CanalClear as a <strong>${roleName}</strong>.</p>
    <p style="color:#475569;margin:0 0 24px;">Click below to accept. This invitation expires in 7 days.</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${acceptUrl}" style="background:#00D4AA;color:#0A1628;font-weight:700;font-size:1rem;padding:14px 32px;border-radius:8px;text-decoration:none;display:inline-block;">Accept Invitation</a>
    </div>
    <p style="color:#94A3B8;font-size:0.8rem;text-align:center;margin-top:24px;">Or copy: <a href="${acceptUrl}" style="color:#00D4AA;">${acceptUrl}</a></p>
    <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;">
    <p style="color:#94A3B8;font-size:0.75rem;text-align:center;margin:0;">CanalClear — Panama, Suez, Bosporus, Malacca, Cape compliance automation</p>
  </div>
</div>`;

  await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      to,
      subject: `You've been invited to join ${orgName} on CanalClear`,
      body: `${inviterEmail} has invited you to join ${orgName} on CanalClear as ${roleName}. Accept here: ${acceptUrl}`,
      html,
    }),
  }).catch(err => console.error('[RBAC] Invitation email error:', err.message));
}

// ── Org bootstrapper ──────────────────────────────────────────────────────────

/**
 * Creates org for the current user if they don't have one yet.
 * Seeds default roles and assigns caller as Admin.
 * Returns the orgId.
 */
async function ensureUserOrg(pool, userId, userEmail) {
  const user = await getUserOrgInfo(pool, userId);
  if (user && user.org_id) return user.org_id;

  const domain = userEmail.includes('@') ? userEmail.split('@')[1] : userEmail;
  const orgSlug = domain.split('.')[0];
  const orgName = orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1) + ' Fleet';
  const org = await createOrganization(pool, { name: orgName });

  await seedDefaultRoles(pool, org.id);
  await setUserOrg(pool, userId, org.id);

  const adminRoleId = await getAdminRoleIdForOrg(pool, org.id);
  if (adminRoleId) {
    await assignUserRole(pool, { userId, orgId: org.id, roleId: adminRoleId, assignedBy: userId });
  }

  return org.id;
}

// ── GET /api/team/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, loadUserRbac, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const user = await getUserOrgInfo(pool, req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let org = null;
    let role = null;

    if (user.org_id) {
      org = await getOrganizationById(pool, user.org_id);
      const roleRow = await getUserRole(pool, req.user.id, user.org_id);
      if (roleRow) {
        role = { id: roleRow.role_id, name: roleRow.role_name, permissions: roleRow.permissions, waterways: roleRow.waterways };
      }
    }

    res.json({ success: true, org, role, rbac: req.rbac, is_super_admin: req.user.is_admin || false });
  } catch (err) {
    console.error('[RBAC] /me error:', err.message);
    res.status(500).json({ success: false, message: 'Error loading role context' });
  }
});

// ── GET /api/team/members ─────────────────────────────────────────────────────

router.get('/members', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  try {
    const pool = req.app.locals.pool;

    let orgId = req.rbac && req.rbac.orgId;
    if (!orgId) {
      const user = await getUserOrgInfo(pool, req.user.id);
      orgId = user && user.org_id;
    }
    if (!orgId) return res.json({ success: true, members: [], invitations: [], org: null, roles: [] });

    const [members, invitations, org, roles] = await Promise.all([
      getOrgMembers(pool, orgId),
      getPendingInvitations(pool, orgId),
      getOrganizationById(pool, orgId),
      getRolesByOrg(pool, orgId),
    ]);

    res.json({ success: true, members, invitations, org, roles });
  } catch (err) {
    console.error('[RBAC] /members error:', err.message);
    res.status(500).json({ success: false, message: 'Error loading team members' });
  }
});

// ── POST /api/team/invite ─────────────────────────────────────────────────────

router.post('/invite', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  const { email, role_id } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  const emailLower = email.toLowerCase().trim();
  const pool = req.app.locals.pool;

  try {
    const inviter = await getUserOrgInfo(pool, req.user.id);
    const orgId = (inviter && inviter.org_id) || await ensureUserOrg(pool, req.user.id, inviter.email);

    // Update rbac context if org was just created
    if (!req.rbac || !req.rbac.orgId) {
      req.rbac = { roleName: 'Admin', permissions: {}, waterways: ['all'], orgId, isSuperAdmin: !!req.user.is_admin };
    }

    // Resolve role
    let targetRoleId = role_id;
    if (!targetRoleId) {
      const defaultRole = await getDefaultRoleForOrg(pool, orgId);
      if (!defaultRole) return res.status(500).json({ success: false, message: 'No default role found' });
      targetRoleId = defaultRole.id;
    }

    const role = await getRoleById(pool, targetRoleId);
    if (!role || role.org_id !== orgId) {
      return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    // Check invitee isn't already a member
    const existingUser = await findUserByEmail(pool, emailLower);
    if (existingUser) {
      const existingRole = await getUserRole(pool, existingUser.id, orgId);
      if (existingRole) {
        return res.status(409).json({ success: false, message: 'This user is already a member of your team.' });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const org = await getOrganizationById(pool, orgId);

    await createInvitation(pool, { orgId, email: emailLower, roleId: targetRoleId, invitedBy: req.user.id, token });

    sendInvitationEmail({
      to: emailLower,
      inviterEmail: inviter.email,
      orgName: org.name,
      roleName: role.name,
      token,
    }).catch(err => console.error('[RBAC] Async invite email error:', err.message));

    res.json({ success: true, message: `Invitation sent to ${emailLower}`, invitation: { email: emailLower, role_name: role.name, token } });
  } catch (err) {
    console.error('[RBAC] /invite error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to send invitation' });
  }
});

// ── GET /api/team/invite/:token ───────────────────────────────────────────────

router.get('/invite/:token', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const invitation = await getInvitationByToken(pool, req.params.token);

    if (!invitation) return res.status(404).json({ success: false, message: 'Invitation not found or expired' });
    if (invitation.accepted_at) return res.status(410).json({ success: false, message: 'Invitation already accepted' });
    if (new Date(invitation.expires_at) < new Date()) return res.status(410).json({ success: false, message: 'Invitation expired' });

    res.json({
      success: true,
      invitation: {
        email: invitation.email,
        org_name: invitation.org_name,
        role_name: invitation.role_name,
        invited_by_email: invitation.invited_by_email,
        expires_at: invitation.expires_at,
      },
    });
  } catch (err) {
    console.error('[RBAC] /invite/:token error:', err.message);
    res.status(500).json({ success: false, message: 'Error loading invitation' });
  }
});

// ── POST /api/team/accept-invite ──────────────────────────────────────────────

router.post('/accept-invite', requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

  const pool = req.app.locals.pool;

  try {
    const invitation = await getInvitationByToken(pool, token);
    if (!invitation) return res.status(404).json({ success: false, message: 'Invitation not found' });
    if (invitation.accepted_at) return res.status(410).json({ success: false, message: 'Invitation already accepted' });
    if (new Date(invitation.expires_at) < new Date()) return res.status(410).json({ success: false, message: 'Invitation expired' });

    const user = await getUserOrgInfo(pool, req.user.id);
    if (!user || user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      return res.status(403).json({
        success: false,
        message: `This invitation was sent to ${invitation.email}. Log in with that email address.`,
      });
    }

    await setUserOrg(pool, req.user.id, invitation.org_id);
    await assignUserRole(pool, { userId: req.user.id, orgId: invitation.org_id, roleId: invitation.role_id, assignedBy: invitation.invited_by });
    await acceptInvitation(pool, invitation.id);

    res.json({ success: true, message: `Welcome to ${invitation.org_name}!`, org_name: invitation.org_name, role_name: invitation.role_name });
  } catch (err) {
    console.error('[RBAC] /accept-invite error:', err.message);
    res.status(500).json({ success: false, message: 'Error accepting invitation' });
  }
});

// ── PATCH /api/team/members/:userId/role ─────────────────────────────────────

router.patch('/members/:userId/role', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  const { role_id } = req.body;
  const targetUserId = parseInt(req.params.userId, 10);
  if (!role_id) return res.status(400).json({ success: false, message: 'role_id is required' });
  if (targetUserId === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot change your own role. Ask another Admin.' });
  }

  const pool = req.app.locals.pool;

  try {
    let orgId = req.rbac && req.rbac.orgId;
    if (!orgId) { const u = await getUserOrgInfo(pool, req.user.id); orgId = u && u.org_id; }
    if (!orgId) return res.status(403).json({ success: false, message: 'No organization found' });

    const role = await getRoleById(pool, role_id);
    if (!role || role.org_id !== orgId) return res.status(400).json({ success: false, message: 'Invalid role for this organization' });

    await assignUserRole(pool, { userId: targetUserId, orgId, roleId: role_id, assignedBy: req.user.id });
    res.json({ success: true, message: `Role updated to ${role.name}` });
  } catch (err) {
    console.error('[RBAC] /members/:userId/role error:', err.message);
    res.status(500).json({ success: false, message: 'Error updating role' });
  }
});

// ── DELETE /api/team/members/:userId ─────────────────────────────────────────

router.delete('/members/:userId', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  if (targetUserId === req.user.id) {
    return res.status(400).json({ success: false, message: 'Cannot remove yourself from the organization.' });
  }

  const pool = req.app.locals.pool;

  try {
    let orgId = req.rbac && req.rbac.orgId;
    if (!orgId) { const u = await getUserOrgInfo(pool, req.user.id); orgId = u && u.org_id; }
    if (!orgId) return res.status(403).json({ success: false, message: 'No organization found' });

    await removeUserRole(pool, targetUserId, orgId);
    await clearUserOrg(pool, targetUserId, orgId);

    res.json({ success: true, message: 'Member removed from organization' });
  } catch (err) {
    console.error('[RBAC] /members/:userId error:', err.message);
    res.status(500).json({ success: false, message: 'Error removing member' });
  }
});

// ── DELETE /api/team/invitations/:id ─────────────────────────────────────────

router.delete('/invitations/:id', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  const invitationId = parseInt(req.params.id, 10);
  const pool = req.app.locals.pool;

  try {
    let orgId = req.rbac && req.rbac.orgId;
    if (!orgId) { const u = await getUserOrgInfo(pool, req.user.id); orgId = u && u.org_id; }
    if (!orgId) return res.status(403).json({ success: false, message: 'No organization found' });

    await revokeInvitation(pool, invitationId, orgId);
    res.json({ success: true, message: 'Invitation revoked' });
  } catch (err) {
    console.error('[RBAC] /invitations/:id error:', err.message);
    res.status(500).json({ success: false, message: 'Error revoking invitation' });
  }
});

// ── GET /api/team/roles ───────────────────────────────────────────────────────

router.get('/roles', requireAuth, loadUserRbac, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const orgId = req.rbac && req.rbac.orgId;
    if (!orgId) return res.json({ success: true, roles: [] });
    const roles = await getRolesByOrg(pool, orgId);
    res.json({ success: true, roles });
  } catch (err) {
    console.error('[RBAC] /roles error:', err.message);
    res.status(500).json({ success: false, message: 'Error loading roles' });
  }
});

// ── PATCH /api/team/org/name ──────────────────────────────────────────────────

router.patch('/org/name', requireAuth, loadUserRbac, requireOrgAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ success: false, message: 'Organization name must be at least 2 characters' });
  }

  const pool = req.app.locals.pool;

  try {
    let orgId = req.rbac && req.rbac.orgId;
    if (!orgId) { const u = await getUserOrgInfo(pool, req.user.id); orgId = u && u.org_id; }
    if (!orgId) return res.status(403).json({ success: false, message: 'No organization found' });

    await updateOrganizationName(pool, orgId, name.trim());
    res.json({ success: true, message: 'Organization name updated', name: name.trim() });
  } catch (err) {
    console.error('[RBAC] /org/name error:', err.message);
    res.status(500).json({ success: false, message: 'Error updating organization name' });
  }
});

module.exports = router;
