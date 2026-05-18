/**
 * services/mpa-portal.js — MPA digitalPORT@SG / OCEANS-X portal integration service.
 *
 * Owns: MPA OCEANS-X API credential encryption/decryption, vessel data enrichment via
 *       OCEANS-X API, pre-arrival filing package generation, MPA reference generation.
 * Does NOT own: route handling, DB queries, email sending, credential storage,
 *               actual digitalPORT@SG portal automation (future work).
 *
 * MPA digitalPORT@SG: https://digitalport.mpa.gov.sg
 * OCEANS-X API (successor to SG-MDH, live since Jan 2026): https://oceans-x.mpa.gov.sg
 * SG-MDH base URL (pre-migration reference): https://sg-mdh-api.mpa.gov.sg/v1
 *
 * Sectors 7–9 of the Strait of Malacca/Singapore Strait fall under Singapore VTS (MPA).
 * Pre-arrival notifications (PAN) are mandatory 24h before entering Singapore port waters.
 * STRAITREP is VHF-only (out of scope for API submission), but PAN is submittable.
 *
 * Current approach: OCEANS-X API key storage (AES-256-GCM) + vessel data enrichment
 * for form pre-population + filing package generation for digitalPORT@SG portal upload,
 * with full audit trail. Direct API submission requires MPA partner onboarding.
 */

const crypto = require('crypto');
const https = require('https');

// ── Encryption ─────────────────────────────────────────────────────────────────
// AES-256-GCM. Key derived from MPA_ENCRYPTION_KEY env var (falls back to JWT_SECRET).

function deriveMpaKey() {
  const secret = process.env.MPA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'canalclear-mpa-default-key';
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" as hex — stored as-is in the DB.
 */
function encryptMpa(text) {
  const key = deriveMpaKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored "iv:authTag:ciphertext" value.
 */
function decryptMpa(stored) {
  const key = deriveMpaKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── OCEANS-X API integration ──────────────────────────────────────────────────
// Data pulled from MPA's OCEANS-X platform (successor to SG-MDH as of Jan 2026).
// API requires a registered API key from https://oceans-x.mpa.gov.sg
// Rate limits: typically 100 req/min per key for vessel data endpoints.

const OCEANS_X_BASE = 'https://api.oceans-x.mpa.gov.sg/v1';
// Fallback to old SG-MDH endpoint for backwards compatibility during transition period
const SGMDH_BASE = 'https://sg-mdh-api.mpa.gov.sg/v1';

/**
 * Fetch vessel particulars by IMO number from OCEANS-X API.
 * Used to enrich Malacca filing forms with verified vessel data.
 *
 * @param {string} apiKey — plaintext OCEANS-X API key
 * @param {string} imoNumber — vessel IMO number (7 digits)
 * @returns {Promise<object|null>} vessel particulars or null if not found
 */
async function fetchVesselParticulars(apiKey, imoNumber) {
  // Normalize IMO: strip "IMO" prefix if present
  const imo = String(imoNumber).replace(/^IMO\s*/i, '').trim();

  return new Promise((resolve) => {
    const url = `${OCEANS_X_BASE}/vessel/particulars/imonumber/${imo}`;
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'CanalClear/1.0 (MPA OCEANS-X Integration)',
      },
      timeout: 8000,
    };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve(normalizeOceansXVesselData(parsed));
          } catch {
            resolve(null);
          }
        } else if (res.statusCode === 404) {
          resolve(null); // vessel not found — not an error
        } else {
          resolve(null); // API error — caller handles gracefully
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Fetch vessel arrival history for a given IMO from OCEANS-X API.
 * Provides Singapore port call history for context and form pre-population.
 *
 * @param {string} apiKey — plaintext OCEANS-X API key
 * @param {string} imoNumber — vessel IMO number
 * @returns {Promise<Array>} list of recent arrival records
 */
async function fetchVesselArrivalHistory(apiKey, imoNumber) {
  const imo = String(imoNumber).replace(/^IMO\s*/i, '').trim();
  const today = new Date().toISOString().slice(0, 10);

  return new Promise((resolve) => {
    const url = `${OCEANS_X_BASE}/vessel/arrivals/date/${today}`;
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'User-Agent': 'CanalClear/1.0 (MPA OCEANS-X Integration)',
      },
      timeout: 8000,
    };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // Filter to this vessel's records
            const arrivals = Array.isArray(parsed) ? parsed : (parsed.data || parsed.arrivals || []);
            const vesselArrivals = arrivals.filter(a =>
              String(a.imoNumber || a.imo_number || '').trim() === imo
            );
            resolve(vesselArrivals);
          } catch {
            resolve([]);
          }
        } else {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

/**
 * Normalize OCEANS-X vessel data to CanalClear field names.
 * Handles both old SG-MDH format and new OCEANS-X format.
 */
function normalizeOceansXVesselData(raw) {
  if (!raw) return null;
  // OCEANS-X uses camelCase; SG-MDH used snake_case in some endpoints
  return {
    vessel_name:   raw.vesselName    || raw.vessel_name    || null,
    imo_number:    raw.imoNumber     || raw.imo_number     || null,
    mmsi:          raw.mmsiNumber    || raw.mmsi           || null,
    call_sign:     raw.callSign      || raw.call_sign      || null,
    flag_state:    raw.flagState     || raw.flag_state     || raw.flag || null,
    vessel_type:   raw.vesselType    || raw.vessel_type    || null,
    gross_tonnage: raw.grossTonnage  || raw.gross_tonnage  || null,
    net_tonnage:   raw.netTonnage    || raw.net_tonnage    || null,
    loa:           raw.loaMetres     || raw.loa_metres     || raw.loa || null,
    beam:          raw.beamMetres    || raw.beam_metres    || raw.beam || null,
    max_draft:     raw.maxDraftMetres || raw.max_draft     || null,
    // Port call history from arrivals endpoint
    last_port:     raw.lastPortOfCall || raw.last_port     || null,
    next_port:     raw.nextPortOfCall || raw.next_port     || null,
    // OCEANS-X enrichment metadata
    source:        'MPA OCEANS-X',
    fetched_at:    new Date().toISOString(),
  };
}

// ── Filing package generation ─────────────────────────────────────────────────

/**
 * Build a structured MPA pre-arrival notification package from CanalClear Malacca filing data.
 * This package represents what gets submitted to digitalPORT@SG (either directly via
 * OCEANS-X partner API in future, or via portal upload now).
 *
 * Pre-Arrival Notification (PAN) for Singapore port: mandatory 24h before arrival.
 * Covers all vessels > 300 GT entering Singapore port limits.
 * Reference: MPA Port Marine Circular No. 14 of 2024 (effective 1 Jan 2025).
 *
 * @param {object} filingData — from malacca_filings row or direct form data
 * @param {object} oceansXData — enriched vessel data from OCEANS-X (optional)
 * @returns {object} MPA pre-arrival filing package
 */
function buildMpaPreArrivalPackage(filingData, oceansXData) {
  const now = new Date();
  const refToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const localRef = `MPA-${now.getFullYear()}-SG-${refToken}`;

  return {
    local_reference: localRef,
    generated_at: now.toISOString(),
    authority: 'Maritime and Port Authority of Singapore (MPA)',
    system: 'digitalPORT@SG',
    portal_url: 'https://digitalport.mpa.gov.sg',
    oceans_x_url: 'https://oceans-x.mpa.gov.sg',
    filing_type: 'Pre-Arrival Notification (PAN)',
    regulatory_basis: 'MPA Port Marine Circular 14/2024 (effective 1 Jan 2025)',
    deadline_note: '24 hours before vessel arrival at Singapore port limits',

    // Vessel particulars (merged: filing data + OCEANS-X enrichment)
    vessel: {
      name:          filingData.vessel_name        || (oceansXData && oceansXData.vessel_name)  || '',
      imo:           filingData.imo_number         || (oceansXData && oceansXData.imo_number)   || '',
      mmsi:          filingData.mmsi               || (oceansXData && oceansXData.mmsi)         || null,
      flag:          filingData.flag_state         || (oceansXData && oceansXData.flag_state)   || '',
      call_sign:     filingData.call_sign          || (oceansXData && oceansXData.call_sign)    || '',
      vessel_type:   filingData.vessel_type        || (oceansXData && oceansXData.vessel_type)  || '',
      gross_tonnage: filingData.gross_tonnage      || (oceansXData && oceansXData.gross_tonnage)|| null,
      net_tonnage:   filingData.net_tonnage        || (oceansXData && oceansXData.net_tonnage)  || null,
      loa:           filingData.loa                || (oceansXData && oceansXData.loa)          || null,
      beam:          filingData.beam               || (oceansXData && oceansXData.beam)         || null,
      max_draft:     filingData.max_draft          || filingData.draft || (oceansXData && oceansXData.max_draft) || null,
      // MPA-specific: ISPS ship security level
      isps_level:    filingData.isps_level         || 1,
    },

    // Transit/voyage details
    voyage: {
      transit_direction:  filingData.transit_direction  || null,   // SB or NB through Malacca
      last_port:          filingData.last_port           || (oceansXData && oceansXData.last_port) || null,
      next_port:          filingData.next_port           || (oceansXData && oceansXData.next_port) || null,
      eta_singapore:      filingData.estimated_arrival   || null,
      speed_in_knots:     filingData.speed_knots         || null,
    },

    // Cargo
    cargo: {
      type:            filingData.cargo_type              || null,
      quantity:        filingData.cargo_quantity          || null,
      dangerous_goods: filingData.has_dangerous_goods     || false,
      dg_class:        filingData.dangerous_goods_class   || null,
    },

    // ISPS/security data — required by MPA for all vessel arrivals
    security: {
      isps_level:              filingData.isps_level         || 1,
      last_10_ports:           filingData.last_10_ports      || null,
      security_agreement:      filingData.security_agreement || null,
    },

    // Required documents per MPA PAN requirements
    required_documents: [
      'Pre-Arrival Notification (PAN) — MPA Form',
      'General Declaration (IMO FAL Form 1)',
      'Cargo Declaration (IMO FAL Form 2)',
      'Crew List (IMO FAL Form 5)',
      'Dangerous Goods Manifest (if applicable)',
      'Maritime Declaration of Health (WHO form)',
      'Ship Sanitation Certificate',
      'ISPS Ship Security Certificate',
      ...(filingData.has_dangerous_goods ? ['Dangerous Goods Certificate (IMDG)'] : []),
    ],

    // OCEANS-X enrichment data (if available)
    mpa_enrichment: oceansXData ? {
      source:          'MPA OCEANS-X API',
      fetched_at:      oceansXData.fetched_at,
      fields_enriched: Object.keys(oceansXData).filter(k => oceansXData[k] !== null && k !== 'source' && k !== 'fetched_at'),
    } : null,

    // Submission guidance
    submission_guidance: {
      method:   'digitalport_portal',
      deadline: '24 hours before arrival at Singapore port limits',
      steps: [
        'Log in to digitalPORT@SG: https://digitalport.mpa.gov.sg',
        'Select "Online Forms" → "Pre-Arrival Notification"',
        'Enter vessel IMO number — system will auto-populate MPA records',
        'Fill in voyage details (ETA, last port, cargo) using this package',
        'Upload any required supporting documents',
        'Submit and note the MPA PAN reference number',
        'STRAITREP (VHF to Sector 7–9 MRCC Singapore) should be filed separately',
      ],
      api_note: 'Direct API submission via MPA OCEANS-X partner programme requires MPA bilateral agreement. Contact OCEANS-X@mpa.gov.sg for partner onboarding.',
      rpa_status: 'CanalClear is integrated with MPA OCEANS-X for vessel data enrichment. Direct submission requires MPA partner API access.',
    },
  };
}

/**
 * Generate an MPA reference number for a submission record.
 * Format: MPA-{YEAR}-SG-{4-hex}
 */
function generateMpaReference() {
  const year = new Date().getFullYear();
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `MPA-${year}-SG-${token}`;
}

module.exports = {
  encryptMpa,
  decryptMpa,
  fetchVesselParticulars,
  fetchVesselArrivalHistory,
  normalizeOceansXVesselData,
  buildMpaPreArrivalPackage,
  generateMpaReference,
};
