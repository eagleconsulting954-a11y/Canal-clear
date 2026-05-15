/**
 * services/sso-oidc.js
 * Owns: OpenID Connect / OAuth 2.0 authorization code flow with PKCE.
 *       Supports Okta, Azure AD, Google Workspace, OneLogin, and any
 *       standards-compliant OIDC provider.
 * Does NOT own: session state persistence (db/sso-configs.js),
 *               JWT issuance (middleware/auth.js), user provisioning.
 */

const oidc = require('openid-client');
const crypto = require('crypto');

// Cache discovered OIDC configurations (issuer → config) to avoid
// re-fetching on every auth request. TTL: 1 hour.
const _discoveryCache = new Map(); // orgId → { config, expiresAt }

/**
 * Discover OIDC provider config and return an openid-client v6 Configuration.
 * Results are cached per-org for 1 hour.
 */
async function discoverOIDCConfig(ssoConfig) {
  const cached = _discoveryCache.get(ssoConfig.org_id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  // openid-client v6: discovery(server, clientId, clientSecret, clientAuth?)
  const config = await oidc.discovery(
    new URL(ssoConfig.oidc_issuer),
    ssoConfig.oidc_client_id,
    ssoConfig.oidc_client_secret,
    oidc.ClientSecretPost     // client_secret_post auth method (wide IdP support)
  );

  _discoveryCache.set(ssoConfig.org_id, {
    config,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });

  return config;
}

/**
 * Build the OIDC authorization URL to redirect the user to the IdP.
 * Uses PKCE (code_challenge_method=S256) for security.
 *
 * @param {object} ssoConfig — sso_config row from DB
 * @param {string} callbackUrl — our redirect_uri
 * @param {string} stateToken — random state for CSRF
 * @param {string} nonce — random nonce for replay prevention
 * @param {string} pkceVerifier — code_verifier (caller stores this in sso_sessions)
 * @returns {Promise<string>} — authorization URL
 */
async function buildOIDCAuthUrl(ssoConfig, callbackUrl, stateToken, nonce, pkceVerifier) {
  const config = await discoverOIDCConfig(ssoConfig);
  const scopes = (ssoConfig.oidc_scopes || 'openid email profile').split(' ');

  const codeChallenge = await oidc.calculatePKCECodeChallenge(pkceVerifier);

  const authUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: callbackUrl,
    scope: scopes.join(' '),
    state: stateToken,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return authUrl.toString();
}

/**
 * Exchange the authorization code for tokens and extract user claims.
 *
 * @param {object} ssoConfig — sso_config row
 * @param {string} callbackUrl — our redirect_uri (must match exactly)
 * @param {object} params — { code, state } from query string
 * @param {string} expectedState — the state we originally sent
 * @param {string} nonce — the nonce we originally sent
 * @param {string} pkceVerifier — the code_verifier we generated
 * @returns {Promise<{ subject, email, name }>}
 */
async function exchangeOIDCCode(ssoConfig, callbackUrl, params, expectedState, nonce, pkceVerifier) {
  const config = await discoverOIDCConfig(ssoConfig);

  // Build the current URL from the callback params
  const currentUrl = new URL(callbackUrl);
  for (const [k, v] of Object.entries(params)) {
    currentUrl.searchParams.set(k, v);
  }

  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pkceVerifier,
    expectedState,
    expectedNonce: nonce,
  });

  const claims = tokens.claims();
  if (!claims) throw new Error('OIDC token exchange returned no claims');

  // Extract email and name using configured attribute mappings
  const emailAttr = ssoConfig.oidc_attribute_email || 'email';
  const nameAttr  = ssoConfig.oidc_attribute_name  || 'name';

  let email = claims[emailAttr] || claims.email || null;
  let name  = claims[nameAttr]  || claims.name  || null;

  // Azure AD uses 'preferred_username' as email fallback
  if (!email && claims.preferred_username && claims.preferred_username.includes('@')) {
    email = claims.preferred_username;
  }

  // Google Workspace sometimes puts name in 'given_name' + 'family_name'
  if (!name && claims.given_name) {
    name = claims.family_name
      ? `${claims.given_name} ${claims.family_name}`
      : claims.given_name;
  }

  if (!email) {
    // Fetch userinfo if email not in id_token (some IdPs defer to userinfo endpoint)
    const userinfo = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
    email = userinfo[emailAttr] || userinfo.email || null;
    name  = name || userinfo[nameAttr] || userinfo.name || null;
  }

  if (!email) {
    throw new Error(`OIDC response missing email claim (looked for '${emailAttr}'). Available: ${Object.keys(claims).join(', ')}`);
  }

  // sub is the stable, unique OIDC subject identifier
  const subject = claims.sub;

  return {
    subject,
    email: email.toLowerCase().trim(),
    name: name || email,
  };
}

/**
 * Generate a cryptographically random PKCE code_verifier (43–128 chars, base64url).
 */
async function generatePKCEVerifier() {
  return oidc.randomPKCECodeVerifier();
}

/**
 * Generate a random state token for CSRF.
 */
function generateStateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a random nonce.
 */
function generateNonce() {
  return oidc.randomNonce();
}

/**
 * Pre-validate known IdP issuer URLs so we can give clear error messages.
 * Not exhaustive — just the top 4 IdPs.
 */
const KNOWN_IDPS = {
  okta:    { pattern: /\.okta\.com/, example: 'https://company.okta.com/oauth2/default' },
  azure:   { pattern: /login\.microsoftonline\.com/, example: 'https://login.microsoftonline.com/{tenant-id}/v2.0' },
  google:  { pattern: /accounts\.google\.com/, example: 'https://accounts.google.com' },
  onelogin:{ pattern: /\.onelogin\.com/, example: 'https://company.onelogin.com/oidc/2' },
};

function detectIdPFromIssuer(issuerUrl) {
  for (const [name, { pattern }] of Object.entries(KNOWN_IDPS)) {
    if (pattern.test(issuerUrl)) return name;
  }
  return 'unknown';
}

module.exports = {
  buildOIDCAuthUrl,
  exchangeOIDCCode,
  generatePKCEVerifier,
  generateStateToken,
  generateNonce,
  detectIdPFromIssuer,
};
