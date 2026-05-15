/**
 * routes/sso.js
 * Owns: SSO authentication endpoints for SAML 2.0 and OpenID Connect.
 *       /api/sso/* — initiate, callback, metadata, config management, SLO.
 * Does NOT own: JWT issuance logic (middleware/auth.js),
 *               user persistence (db/sso-configs.js), SAML/OIDC protocol (services/).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const {
  getSSOConfigByOrg,
  getSSOConfigByEmail,
  getAllSSOConfigs,
  upsertSSOConfig,
  deleteSSOConfig,
  createSSOSession,
  consumeSSOSession,
  pruneExpiredSSOSessions,
  getUserBySSOSubject,
  jitProvisionUser,
} = require('../db/sso-configs');

const {
  buildSAMLAuthUrl,
  validateSAMLResponse,
  fetchAndParseIdPMetadata,
  generateSPMetadataXml,
} = require('../services/sso-saml');

const {
  buildOIDCAuthUrl,
  exchangeOIDCCode,
  generatePKCEVerifier,
  generateStateToken,
  generateNonce,
} = require('../services/sso-oidc');

const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ACS and OIDC callback URLs — must match what's registered in the IdP
function acsUrl(req)  { return `${req.protocol}://${req.get('host')}/api/sso/saml/callback`; }
function oidcUrl(req) { return `${req.protocol}://${req.get('host')}/api/sso/oidc/callback`; }

// ── SAML SP Metadata ──────────────────────────────────────────────────────────

/**
 * GET /api/sso/saml/metadata?org_id=acme.com
 * Returns SP metadata XML that enterprise admins paste into their IdP.
 * Public — no auth required.
 */
router.get('/saml/metadata', async (req, res) => {
  const { org_id } = req.query;
  if (!org_id) return res.status(400).send('org_id is required');

  const pool = req.app.locals.pool;
  try {
    const config = await getSSOConfigByOrg(pool, org_id);
    if (!config) return res.status(404).send('No SSO config found for this org');

    const xml = generateSPMetadataXml(config, acsUrl(req));
    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  } catch (err) {
    console.error('[SSO] metadata error:', err.message);
    return res.status(500).send('Failed to generate SP metadata');
  }
});

// ── SAML Initiate ─────────────────────────────────────────────────────────────

/**
 * GET /api/sso/saml/initiate?org_id=acme.com&next=/app
 * Redirects user to IdP login page.
 */
router.get('/saml/initiate', async (req, res) => {
  const { org_id, next } = req.query;
  if (!org_id) return res.redirect('/login?error=sso_no_org');

  const pool = req.app.locals.pool;
  try {
    const config = await getSSOConfigByOrg(pool, org_id);
    if (!config || config.provider_type !== 'saml') {
      return res.redirect('/login?error=sso_not_configured');
    }

    // State token doubles as relay state for SAML
    const stateToken = crypto.randomBytes(32).toString('hex');
    const relayState = next || '/app';

    await createSSOSession(pool, {
      stateToken,
      orgId: org_id,
      providerType: 'saml',
      relayState,
    });

    const authUrl = await buildSAMLAuthUrl(config, acsUrl(req), stateToken);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[SSO SAML] initiate error:', err.message);
    return res.redirect('/login?error=sso_error');
  }
});

// ── SAML ACS (Assertion Consumer Service) Callback ───────────────────────────

/**
 * POST /api/sso/saml/callback
 * IdP POSTs the SAML Response here after authentication.
 */
router.post('/saml/callback', express.urlencoded({ extended: false }), async (req, res) => {
  const pool = req.app.locals.pool;
  const relayState = req.body.RelayState || '/app';

  try {
    // Consume the session (validates state / replay)
    const session = await consumeSSOSession(pool, relayState);
    if (!session) {
      console.error('[SSO SAML] callback: invalid or expired state token');
      return res.redirect('/login?error=sso_expired');
    }

    const config = await getSSOConfigByOrg(pool, session.org_id);
    if (!config) return res.redirect('/login?error=sso_not_configured');

    // Validate the SAML Response
    const { subject, email, name } = await validateSAMLResponse(config, acsUrl(req), req.body);

    // JIT provision or look up existing user
    const user = await _resolveUser(pool, config, { subject, email, name });

    // Issue JWT and set cookie
    const token = signToken(user);
    res.cookie('cc_token', token, COOKIE_OPTS);

    return res.redirect(session.relay_state || '/app');
  } catch (err) {
    console.error('[SSO SAML] callback error:', err.message);
    return res.redirect('/login?error=sso_validation_failed');
  }
});

// ── OIDC Initiate ─────────────────────────────────────────────────────────────

/**
 * GET /api/sso/oidc/initiate?org_id=acme.com&next=/app
 * Redirects user to OIDC provider authorization endpoint.
 */
router.get('/oidc/initiate', async (req, res) => {
  const { org_id, next } = req.query;
  if (!org_id) return res.redirect('/login?error=sso_no_org');

  const pool = req.app.locals.pool;
  try {
    const config = await getSSOConfigByOrg(pool, org_id);
    if (!config || config.provider_type !== 'oidc') {
      return res.redirect('/login?error=sso_not_configured');
    }

    const stateToken = generateStateToken();
    const nonce      = generateNonce();
    const pkceVerifier = await generatePKCEVerifier();

    await createSSOSession(pool, {
      stateToken,
      orgId: org_id,
      providerType: 'oidc',
      pkceVerifier,
      nonce,
      relayState: next || '/app',
    });

    const authUrl = await buildOIDCAuthUrl(config, oidcUrl(req), stateToken, nonce, pkceVerifier);
    return res.redirect(authUrl);
  } catch (err) {
    console.error('[SSO OIDC] initiate error:', err.message);
    return res.redirect('/login?error=sso_error');
  }
});

// ── OIDC Callback ─────────────────────────────────────────────────────────────

/**
 * GET /api/sso/oidc/callback?code=...&state=...
 * IdP redirects here after authentication.
 */
router.get('/oidc/callback', async (req, res) => {
  const pool = req.app.locals.pool;
  const { state, code, error, error_description } = req.query;

  if (error) {
    console.error('[SSO OIDC] IdP error:', error, error_description);
    return res.redirect('/login?error=sso_idp_error');
  }

  if (!state || !code) return res.redirect('/login?error=sso_missing_params');

  try {
    // Consume the session record (validates state, retrieves PKCE verifier)
    const session = await consumeSSOSession(pool, state);
    if (!session) {
      console.error('[SSO OIDC] callback: invalid or expired state');
      return res.redirect('/login?error=sso_expired');
    }

    const config = await getSSOConfigByOrg(pool, session.org_id);
    if (!config) return res.redirect('/login?error=sso_not_configured');

    const { subject, email, name } = await exchangeOIDCCode(
      config,
      oidcUrl(req),
      req.query,
      state,
      session.nonce,
      session.pkce_verifier
    );

    const user = await _resolveUser(pool, config, { subject, email, name });

    const token = signToken(user);
    res.cookie('cc_token', token, COOKIE_OPTS);

    return res.redirect(session.relay_state || '/app');
  } catch (err) {
    console.error('[SSO OIDC] callback error:', err.message);
    return res.redirect('/login?error=sso_validation_failed');
  }
});

// ── SSO Lookup by email domain ────────────────────────────────────────────────

/**
 * GET /api/sso/lookup?email=alice@acme.com
 * Returns whether SSO is configured for this email's domain.
 * Used by the login page to show "Login with SSO" button dynamically.
 */
router.get('/lookup', async (req, res) => {
  const { email } = req.query;
  if (!email || !email.includes('@')) {
    return res.json({ sso_available: false });
  }

  const pool = req.app.locals.pool;
  try {
    const config = await getSSOConfigByEmail(pool, email);
    if (!config) return res.json({ sso_available: false });

    return res.json({
      sso_available: true,
      org_id: config.org_id,
      provider_type: config.provider_type,
      idp_name: config.idp_name || null,
      enforce_sso: config.enforce_sso,
      initiate_url: config.provider_type === 'saml'
        ? `/api/sso/saml/initiate?org_id=${encodeURIComponent(config.org_id)}`
        : `/api/sso/oidc/initiate?org_id=${encodeURIComponent(config.org_id)}`,
    });
  } catch (err) {
    console.error('[SSO lookup] error:', err.message);
    return res.json({ sso_available: false });
  }
});

// ── Single Logout (SLO) ───────────────────────────────────────────────────────

/**
 * GET /api/sso/logout
 * Clears the CanalClear session. IdP-initiated SLO is not implemented
 * (most enterprise customers do not require it at initial rollout).
 */
router.get('/logout', (req, res) => {
  res.clearCookie('cc_token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  return res.redirect('/login?sso_logout=1');
});

// ── Admin: SSO Config Management ──────────────────────────────────────────────

/**
 * GET /api/sso/admin/configs
 * List all SSO configurations. Admin only.
 */
router.get('/admin/configs', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const configs = await getAllSSOConfigs(pool);
    return res.json({ success: true, configs });
  } catch (err) {
    console.error('[SSO admin] list error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list configs' });
  }
});

/**
 * GET /api/sso/admin/configs/:org_id
 * Get a single SSO config. Admin only.
 */
router.get('/admin/configs/:org_id', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const config = await getSSOConfigByOrg(pool, req.params.org_id);
    if (!config) return res.status(404).json({ success: false, message: 'Config not found' });
    // Redact secrets for API response
    const safe = { ...config, saml_cert: config.saml_cert ? '[set]' : null, oidc_client_secret: config.oidc_client_secret ? '[set]' : null };
    return res.json({ success: true, config: safe });
  } catch (err) {
    console.error('[SSO admin] get error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to get config' });
  }
});

/**
 * POST /api/sso/admin/configs
 * Create or update an SSO config. Admin only.
 *
 * Body: { org_id, provider_type, idp_name, ...provider-specific fields, enforce_sso, jit_provisioning }
 *
 * For SAML, if saml_metadata_url is provided, we auto-fetch the cert and entryPoint.
 */
router.post('/admin/configs', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { org_id, provider_type, saml_metadata_url } = req.body;

  if (!org_id) return res.status(400).json({ success: false, message: 'org_id is required' });
  if (!provider_type || !['saml', 'oidc'].includes(provider_type)) {
    return res.status(400).json({ success: false, message: 'provider_type must be saml or oidc' });
  }

  try {
    let params = { ...req.body };

    // Auto-populate from metadata URL if provided for SAML
    if (provider_type === 'saml' && saml_metadata_url) {
      try {
        const meta = await fetchAndParseIdPMetadata(saml_metadata_url);
        params.samlEntryPoint = params.samlEntryPoint || params.saml_entry_point || meta.entryPoint;
        params.samlCert       = params.samlCert       || params.saml_cert       || meta.cert;
        params.samlIdpIssuer  = params.samlIdpIssuer  || params.saml_idp_issuer || meta.idpIssuer;
      } catch (metaErr) {
        console.error('[SSO admin] metadata fetch error:', metaErr.message);
        // Don't fail — allow manual override
      }
    }

    // Normalize field names (support both camelCase and snake_case from API callers)
    const config = await upsertSSOConfig(pool, {
      orgId: params.org_id,
      providerType: params.provider_type,
      idpName: params.idp_name || params.idpName,
      samlEntryPoint:  params.saml_entry_point  || params.samlEntryPoint,
      samlIssuer:      params.saml_issuer        || params.samlIssuer,
      samlIdpIssuer:   params.saml_idp_issuer    || params.samlIdpIssuer,
      samlCert:        params.saml_cert          || params.samlCert,
      samlMetadataUrl: params.saml_metadata_url  || params.samlMetadataUrl,
      samlAttributeEmail: params.saml_attribute_email || params.samlAttributeEmail,
      samlAttributeName:  params.saml_attribute_name  || params.samlAttributeName,
      samlAttributeRole:  params.saml_attribute_role  || params.samlAttributeRole,
      oidcIssuer:       params.oidc_issuer        || params.oidcIssuer,
      oidcClientId:     params.oidc_client_id     || params.oidcClientId,
      oidcClientSecret: params.oidc_client_secret || params.oidcClientSecret,
      oidcScopes:       params.oidc_scopes        || params.oidcScopes,
      oidcAttributeEmail: params.oidc_attribute_email || params.oidcAttributeEmail,
      oidcAttributeName:  params.oidc_attribute_name  || params.oidcAttributeName,
      enforceSso:       params.enforce_sso !== undefined ? params.enforce_sso : params.enforceSso,
      jitProvisioning:  params.jit_provisioning   !== undefined ? params.jit_provisioning : params.jitProvisioning,
      jitSubscriptionPlan:   params.jit_subscription_plan   || params.jitSubscriptionPlan,
      jitSubscriptionStatus: params.jit_subscription_status || params.jitSubscriptionStatus,
    });

    return res.json({
      success: true,
      config: { ...config, saml_cert: config.saml_cert ? '[set]' : null, oidc_client_secret: config.oidc_client_secret ? '[set]' : null },
      saml_metadata_url: `/api/sso/saml/metadata?org_id=${encodeURIComponent(org_id)}`,
      saml_acs_url: `${process.env.APP_URL || ''}/api/sso/saml/callback`,
      oidc_callback_url: `${process.env.APP_URL || ''}/api/sso/oidc/callback`,
    });
  } catch (err) {
    console.error('[SSO admin] upsert error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /api/sso/admin/configs/:org_id
 * Remove an SSO config. Admin only.
 */
router.delete('/admin/configs/:org_id', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const deleted = await deleteSSOConfig(pool, req.params.org_id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Config not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[SSO admin] delete error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete config' });
  }
});

/**
 * POST /api/sso/admin/prune-sessions
 * Clean up expired SSO state sessions. Admin only. Safe to call on a schedule.
 */
router.post('/admin/prune-sessions', requireAuth, requireAdmin, async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    await pruneExpiredSSOSessions(pool);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Internal helper ───────────────────────────────────────────────────────────

/**
 * Resolve an SSO-authenticated user to a local user row.
 * Priority: existing SSO subject match → email match (link) → JIT provision.
 */
async function _resolveUser(pool, config, { subject, email, name }) {
  // 1. Existing SSO-linked user (stable subject identifier)
  let user = await getUserBySSOSubject(pool, config.org_id, subject);
  if (user) return user;

  // 2. JIT provision (creates or links by email)
  if (config.jit_provisioning) {
    user = await jitProvisionUser(pool, {
      email,
      name,
      ssoOrgId: config.org_id,
      ssoSubject: subject,
      subscriptionPlan: config.jit_subscription_plan,
      subscriptionStatus: config.jit_subscription_status,
    });
    return user;
  }

  throw new Error(`No user found for SSO subject ${subject} and JIT provisioning is disabled`);
}

module.exports = router;
