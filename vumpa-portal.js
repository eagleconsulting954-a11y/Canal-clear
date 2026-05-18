/**
 * services/vumpa-portal.js — ACP VUMPA portal submission service.
 *
 * Owns: VUMPA credential encryption/decryption, VUMPA filing package generation,
 *       ACP transit reference generation, audit log entry construction.
 * Does NOT own: route handling, DB queries, email sending, credential storage,
 *               actual browser automation (future work).
 *
 * ACP portals:
 *   Primary VUMPA:   https://www.vumpa.gob.pa  (Maritime Single Window)
 *   Service Portal:  https://serviceportal.pancanal.com
 *
 * Full RPA submission is not yet implemented — VUMPA uses a web form with no public API.
 * Current approach: secure credential storage + VUMPA filing package generation for
 * agent-assisted upload, with full audit trail.
 */

const crypto = require('crypto');

// ── Encryption ─────────────────────────────────────────────────────────────────
// AES-256-GCM. Key derived from VUMPA_ENCRYPTION_KEY env var (falls back to JWT_SECRET).

function deriveVumpaKey() {
  const secret = process.env.VUMPA_ENCRYPTION_KEY || process.env.ACP_ENCRYPTION_KEY || process.env.JWT_SECRET || 'canalclear-vumpa-default-key';
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" as hex — stored as-is in the DB.
 */
function encryptVumpa(text) {
  const key = deriveVumpaKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored "iv:authTag:ciphertext" value.
 */
function decryptVumpa(stored) {
  const key = deriveVumpaKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Filing package generation ──────────────────────────────────────────────────

/**
 * Build a structured VUMPA filing package from CanalClear filing data.
 * This package represents what gets submitted to VUMPA (either automatically
 * via RPA in future, or manually by the user/agent now).
 *
 * @param {object} filingData — from `filings` table row or direct form data
 * @returns {object} ACP VUMPA transit package
 */
function buildVumpaTransitPackage(filingData) {
  const now = new Date();
  const docType = filingData.document_type || filingData.filing_type || 'VUMPA';

  // ACP reference format: ACP-{YEAR}-{docType}-{4-hex}
  const docToken = String(docType).slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const refToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const localRef = `ACP-${now.getFullYear()}-${docToken}-${refToken}`;

  return {
    local_reference: localRef,
    generated_at: now.toISOString(),
    authority: 'Autoridad del Canal de Panamá (ACP)',
    system: 'VUMPA — Ventanilla Única Marítima de Panamá',
    portal_url: 'https://www.vumpa.gob.pa',
    service_portal_url: 'https://serviceportal.pancanal.com',
    filing_type: docType,

    // Vessel particulars
    vessel: {
      name: filingData.vessel_name || '',
      imo: filingData.imo_number || '',
      flag: filingData.flag_state || '',
      call_sign: filingData.call_sign || '',
      vessel_type: filingData.vessel_type || '',
      gross_tonnage: filingData.gross_tonnage || null,
      net_tonnage: filingData.net_tonnage || null,
      loa: filingData.loa || null,
      beam: filingData.beam || null,
      max_draft: filingData.max_draft || null,
      panama_canal_waters_class: filingData.vessel_class || null,
    },

    // Transit details
    transit: {
      direction: filingData.transit_direction || null,        // N→S or S→N
      eta_vumpa: filingData.eta || null,                      // 96h pre-arrival deadline
      port_of_last_call: filingData.port_of_loading || null,
      port_of_next_call: filingData.port_of_discharge || null,
      pilot_required: filingData.pilot_required !== false,
      pilot_boarding_point: filingData.pilot_boarding || null,
      boatswain_required: filingData.boatswain_required || false,
    },

    // Cargo
    cargo: {
      type: filingData.cargo_type || null,
      description: filingData.cargo_description || null,
      quantity_mt: filingData.cargo_quantity || null,
      dangerous_goods: filingData.has_dangerous_goods || false,
      imdg_class: filingData.imdg_class || null,
      un_number: filingData.un_number || null,
      noxious_liquid: filingData.has_noxious_liquid || false,
    },

    // Crew
    crew: {
      total_persons_on_board: filingData.total_pob || null,
      master_name: filingData.master_name || null,
      master_nationality: filingData.master_nationality || null,
    },

    // Required documents per ACP pre-arrival notice
    required_documents: [
      'VUMPA Pre-Arrival Declaration (96h before canal waters)',
      ...(docType.toUpperCase().includes('PCSOPEP') ? ['PCSOPEP Plan (valid 2 years, Panama-resident Authorized Person)'] : []),
      'Crew List (ACP format + STCW certificates)',
      'Cargo Declaration (ACP Customs form)',
      ...(filingData.has_dangerous_goods ? ['Dangerous Goods Manifest (IMDG)'] : []),
      'Ship Sanitation Certificate',
      'Tonnage Certificate (ACP admeasurement)',
      'ISPS Ship Security Certificate',
    ],

    // Step-by-step submission guidance
    submission_guidance: {
      method: 'vumpa_portal',
      deadline: '96 hours before arrival at Panama Canal waters',
      steps: [
        'Log in to VUMPA: https://www.vumpa.gob.pa',
        'Navigate to "Pre-arrival Declaration" → New Declaration',
        'Enter your vessel IMO number to populate vessel data',
        'Fill in transit details using the data from this package',
        'Upload crew list and cargo declaration documents',
        'Submit and note your ACP reference number',
        'If filing through an ACP-licensed ship agent, forward this package with your VUMPA declaration ID.',
      ],
      agent_note: 'If filing through a licensed Panama ship agent, forward this package. Agent typically files on your behalf 96–120h pre-arrival.',
      rpa_status: 'Automated portal submission (RPA) is in development. This package supports manual or agent-assisted submission.',
    },
  };
}

/**
 * Generate an ACP reference number for a simulated/assisted submission.
 * Format: ACP-{YEAR}-{VUMPA|PCSOPEP}-{4-hex}
 */
function generateAcpReference(docType) {
  const year = new Date().getFullYear();
  const docToken = String(docType || 'VUMPA').slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `ACP-${year}-${docToken}-${token}`;
}

module.exports = {
  encryptVumpa,
  decryptVumpa,
  buildVumpaTransitPackage,
  generateAcpReference,
};
