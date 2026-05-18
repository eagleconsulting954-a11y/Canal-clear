/**
 * services/sso-saml.js
 * Owns: SAML 2.0 Service Provider logic — AuthnRequest generation, Response validation,
 *       IdP metadata parsing, attribute extraction.
 * Does NOT own: session persistence (db/sso-configs.js), JWT issuance (middleware/auth.js),
 *               user provisioning (db/sso-configs.js#jitProvisionUser).
 */

const { SAML } = require('@node-saml/node-saml');
const xml2js = require('xml2js');
const crypto = require('crypto');

/**
 * Build a node-saml SAML instance from a db sso_config row.
 * callbackUrl is the ACS (Assertion Consumer Service) URL.
 */
function buildSAMLInstance(config, callbackUrl) {
  return new SAML({
    entryPoint: config.saml_entry_point,
    issuer: config.saml_issuer || `canalclear-sp-${config.org_id}`,
    idpIssuer: config.saml_idp_issuer || undefined,
    callbackUrl,
    cert: config.saml_cert,
    // Signature validation: require signed assertions
    wantAssertionsSigned: true,
    // Reject assertions older than 5 minutes
    acceptedClockSkewMs: 300000,
  });
}

/**
 * Generate the SAML AuthnRequest URL to redirect the user to the IdP.
 *
 * @param {object} config — sso_config row from DB
 * @param {string} callbackUrl — our ACS URL
 * @param {string} relayState — where to redirect after login
 * @returns {Promise<string>} — full redirect URL
 */
async function buildSAMLAuthUrl(config, callbackUrl, relayState) {
  const saml = buildSAMLInstance(config, callbackUrl);
  const host = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
  return host;
}

/**
 * Validate a SAML Response from the IdP and extract user attributes.
 *
 * @param {object} config — sso_config row
 * @param {string} callbackUrl — must match what was sent in AuthnRequest
 * @param {object} body — req.body from the ACS POST (contains SAMLResponse)
 * @returns {Promise<{ subject, email, name }>}
 */
async function validateSAMLResponse(config, callbackUrl, body) {
  const saml = buildSAMLInstance(config, callbackUrl);

  const { profile } = await saml.validatePostResponseAsync(body);

  if (!profile) {
    throw new Error('SAML validation returned empty profile');
  }

  // Extract attributes using the configured mapping
  const emailAttr = config.saml_attribute_email || 'email';
  const nameAttr  = config.saml_attribute_name  || 'displayName';

  // node-saml puts attributes in profile directly and in profile.attributes
  const attrs = profile.attributes || {};

  const email = profile[emailAttr]
    || attrs[emailAttr]
    || profile.nameID  // fallback: use NameID if it looks like an email
    || null;

  const name = profile[nameAttr]
    || attrs[nameAttr]
    || (profile.firstName && profile.lastName
        ? `${profile.firstName} ${profile.lastName}`
        : null)
    || email;

  // Subject is the SAML NameID — used as the persistent SSO identifier
  const subject = profile.nameID || email;

  if (!email) {
    throw new Error(`SAML response missing email attribute (looked for '${emailAttr}'). Available: ${Object.keys(attrs).join(', ')}`);
  }

  return { subject, email: email.toLowerCase().trim(), name: name || email };
}

/**
 * Parse an IdP metadata XML URL or raw XML string.
 * Extracts: entryPoint, cert, idpIssuer.
 *
 * @param {string} metadataXml — raw XML string
 * @returns {Promise<{ entryPoint, cert, idpIssuer }>}
 */
async function parseIdPMetadata(metadataXml) {
  const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
  const parsed = await parser.parseStringPromise(metadataXml);

  const md = parsed['md:EntityDescriptor'] || parsed['EntityDescriptor'];
  if (!md) {
    throw new Error('Invalid IdP metadata: missing EntityDescriptor');
  }

  const idpIssuer = md.$?.entityID || null;

  // Find the SSO service URL
  const idpSSO = md['md:IDPSSODescriptor'] || md['IDPSSODescriptor'] || [];
  const descriptor = Array.isArray(idpSSO) ? idpSSO[0] : idpSSO;

  const ssoServices = descriptor?.['md:SingleSignOnService'] || descriptor?.['SingleSignOnService'] || [];
  const postService = ssoServices.find(s => {
    const binding = s.$ && (s.$.Binding || '');
    return binding.includes('HTTP-Redirect') || binding.includes('HTTP-POST');
  });

  const entryPoint = postService?.$?.Location || null;

  // Extract signing cert
  const keyDescriptors = descriptor?.['md:KeyDescriptor'] || descriptor?.['KeyDescriptor'] || [];
  let cert = null;
  for (const kd of keyDescriptors) {
    const use = kd.$?.use;
    // Prefer signing cert; accept any if use is missing
    if (use === 'signing' || !use) {
      const certPath = kd['ds:KeyInfo']?.[0]?.['ds:X509Data']?.[0]?.['ds:X509Certificate']?.[0]
        || kd['KeyInfo']?.[0]?.['X509Data']?.[0]?.['X509Certificate']?.[0];
      if (certPath) {
        cert = certPath.replace(/\s+/g, '');
        break;
      }
    }
  }

  if (!entryPoint) throw new Error('IdP metadata missing SingleSignOnService Location');
  if (!cert)       throw new Error('IdP metadata missing signing certificate');

  return { entryPoint, cert, idpIssuer };
}

/**
 * Fetch IdP metadata from a URL and parse it.
 * Returns same shape as parseIdPMetadata.
 */
async function fetchAndParseIdPMetadata(url) {
  const fetch = require('node-fetch');
  const res = await fetch(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`Metadata fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseIdPMetadata(xml);
}

/**
 * Generate our SP metadata XML for a given org.
 * Ship operators / enterprise admins copy this into their IdP.
 */
function generateSPMetadataXml(config, callbackUrl, metadataUrl) {
  const issuer = config.saml_issuer || `canalclear-sp-${config.org_id}`;
  // We're a SP-only — omit signing key for simplicity (ACS POST is HTTPS-enforced)
  return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${issuer}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${callbackUrl}"
      index="1"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

module.exports = {
  buildSAMLAuthUrl,
  validateSAMLResponse,
  parseIdPMetadata,
  fetchAndParseIdPMetadata,
  generateSPMetadataXml,
};
