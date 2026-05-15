/**
 * db/sso-configs.js
 * Owns: sso_configs table and sso_sessions table — SSO provider configuration and OAuth state.
 * Does NOT own: user table writes, JWT issuance, actual SAML/OIDC protocol handling.
 */

/**
 * Fetch SSO config by org_id (e.g. "acme.com")
 */
async function getSSOConfigByOrg(pool, orgId) {
  const result = await pool.query(
    'SELECT * FROM sso_configs WHERE org_id = $1',
    [orgId]
  );
  return result.rows[0] || null;
}

/**
 * Get all SSO configs (admin use)
 */
async function getAllSSOConfigs(pool) {
  const result = await pool.query(
    'SELECT id, org_id, provider_type, idp_name, enforce_sso, jit_provisioning, created_at FROM sso_configs ORDER BY org_id'
  );
  return result.rows;
}

/**
 * Create or update an SSO config for an org.
 * Upsert on org_id — safe to call multiple times.
 */
async function upsertSSOConfig(pool, {
  orgId,
  providerType,
  idpName,
  // SAML
  samlEntryPoint,
  samlIssuer,
  samlIdpIssuer,
  samlCert,
  samlMetadataUrl,
  samlAttributeEmail,
  samlAttributeName,
  samlAttributeRole,
  // OIDC
  oidcIssuer,
  oidcClientId,
  oidcClientSecret,
  oidcScopes,
  oidcAttributeEmail,
  oidcAttributeName,
  // Behavior
  enforceSso,
  jitProvisioning,
  jitSubscriptionPlan,
  jitSubscriptionStatus,
}) {
  const result = await pool.query(
    `INSERT INTO sso_configs (
      org_id, provider_type, idp_name,
      saml_entry_point, saml_issuer, saml_idp_issuer, saml_cert, saml_metadata_url,
      saml_attribute_email, saml_attribute_name, saml_attribute_role,
      oidc_issuer, oidc_client_id, oidc_client_secret, oidc_scopes,
      oidc_attribute_email, oidc_attribute_name,
      enforce_sso, jit_provisioning, jit_subscription_plan, jit_subscription_status,
      updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
    ON CONFLICT (org_id) DO UPDATE SET
      provider_type = EXCLUDED.provider_type,
      idp_name = EXCLUDED.idp_name,
      saml_entry_point = EXCLUDED.saml_entry_point,
      saml_issuer = EXCLUDED.saml_issuer,
      saml_idp_issuer = EXCLUDED.saml_idp_issuer,
      saml_cert = EXCLUDED.saml_cert,
      saml_metadata_url = EXCLUDED.saml_metadata_url,
      saml_attribute_email = EXCLUDED.saml_attribute_email,
      saml_attribute_name = EXCLUDED.saml_attribute_name,
      saml_attribute_role = EXCLUDED.saml_attribute_role,
      oidc_issuer = EXCLUDED.oidc_issuer,
      oidc_client_id = EXCLUDED.oidc_client_id,
      oidc_client_secret = EXCLUDED.oidc_client_secret,
      oidc_scopes = EXCLUDED.oidc_scopes,
      oidc_attribute_email = EXCLUDED.oidc_attribute_email,
      oidc_attribute_name = EXCLUDED.oidc_attribute_name,
      enforce_sso = EXCLUDED.enforce_sso,
      jit_provisioning = EXCLUDED.jit_provisioning,
      jit_subscription_plan = EXCLUDED.jit_subscription_plan,
      jit_subscription_status = EXCLUDED.jit_subscription_status,
      updated_at = NOW()
    RETURNING *`,
    [
      orgId, providerType, idpName || null,
      samlEntryPoint || null, samlIssuer || null, samlIdpIssuer || null, samlCert || null, samlMetadataUrl || null,
      samlAttributeEmail || 'email', samlAttributeName || 'displayName', samlAttributeRole || null,
      oidcIssuer || null, oidcClientId || null, oidcClientSecret || null, oidcScopes || 'openid email profile',
      oidcAttributeEmail || 'email', oidcAttributeName || 'name',
      enforceSso !== undefined ? enforceSso : false,
      jitProvisioning !== undefined ? jitProvisioning : true,
      jitSubscriptionPlan || 'agent_pro_bundle',
      jitSubscriptionStatus || 'active',
    ]
  );
  return result.rows[0];
}

/**
 * Delete an SSO config (admin only)
 */
async function deleteSSOConfig(pool, orgId) {
  const result = await pool.query(
    'DELETE FROM sso_configs WHERE org_id = $1 RETURNING id',
    [orgId]
  );
  return result.rows.length > 0;
}

/**
 * Look up SSO config by the email domain of a user.
 * e.g. user "alice@acme.com" → tries org_id "acme.com"
 */
async function getSSOConfigByEmail(pool, email) {
  const domain = email.split('@')[1];
  if (!domain) return null;
  return getSSOConfigByOrg(pool, domain);
}

// ── SSO Sessions (OAuth state / SAML relay state) ────────────────────────────

/**
 * Create a short-lived SSO session record for CSRF protection.
 * Returns the state_token.
 */
async function createSSOSession(pool, { stateToken, orgId, providerType, pkceVerifier, pkceChallenge, nonce, relayState }) {
  await pool.query(
    `INSERT INTO sso_sessions (state_token, org_id, provider_type, pkce_verifier, pkce_challenge, nonce, relay_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [stateToken, orgId, providerType, pkceVerifier || null, pkceChallenge || null, nonce || null, relayState || '/dashboard']
  );
  return stateToken;
}

/**
 * Consume an SSO session by state_token. Returns session or null if expired/missing.
 * Deletes after read — one-time use.
 */
async function consumeSSOSession(pool, stateToken) {
  const result = await pool.query(
    `DELETE FROM sso_sessions
     WHERE state_token = $1 AND expires_at > NOW()
     RETURNING *`,
    [stateToken]
  );
  return result.rows[0] || null;
}

/**
 * Clean up expired SSO sessions (call periodically)
 */
async function pruneExpiredSSOSessions(pool) {
  await pool.query('DELETE FROM sso_sessions WHERE expires_at < NOW()');
}

// ── User SSO linkage ──────────────────────────────────────────────────────────

/**
 * Find a user by their SSO subject (persistent identifier from IdP).
 */
async function getUserBySSOSubject(pool, orgId, subject) {
  const result = await pool.query(
    'SELECT * FROM users WHERE sso_org_id = $1 AND sso_subject = $2 LIMIT 1',
    [orgId, subject]
  );
  return result.rows[0] || null;
}

/**
 * JIT-provision: upsert a user from SSO attributes.
 * On first login → INSERT. On subsequent logins → UPDATE name/linked_at only.
 * Returns the user row.
 */
async function jitProvisionUser(pool, { email, name, ssoOrgId, ssoSubject, subscriptionPlan, subscriptionStatus }) {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await pool.query(
    `INSERT INTO users (
       email, name,
       sso_org_id, sso_subject, sso_linked_at,
       subscription_status, subscription_plan,
       allowed_canals,
       created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, NOW(), $5, $6, ARRAY['panama','suez','bosporus','malacca','cape'], NOW(), NOW())
     ON CONFLICT (LOWER(email)) DO UPDATE SET
       name = EXCLUDED.name,
       sso_org_id = EXCLUDED.sso_org_id,
       sso_subject = EXCLUDED.sso_subject,
       sso_linked_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [normalizedEmail, name || normalizedEmail, ssoOrgId, ssoSubject, subscriptionStatus || 'active', subscriptionPlan || 'agent_pro_bundle']
  );
  return result.rows[0];
}

module.exports = {
  getSSOConfigByOrg,
  getAllSSOConfigs,
  upsertSSOConfig,
  deleteSSOConfig,
  getSSOConfigByEmail,
  createSSOSession,
  consumeSSOSession,
  pruneExpiredSSOSessions,
  getUserBySSOSubject,
  jitProvisionUser,
};
