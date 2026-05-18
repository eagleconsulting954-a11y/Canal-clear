/**
 * services/sca-portal.js — SCA (Suez Canal Authority) portal submission service.
 *
 * Owns: SCA E-Services portal credential encryption/decryption, submission package
 *       generation, audit log writing, submission status simulation.
 * Does NOT own: route handling, DB queries, email sending, credential storage.
 *
 * SCA E-Services portal: https://www.suezcanal.gov.eg/English/Navigation/Pages/Navigation.aspx
 * Transit Request workspace: https://www.suezcanal.gov.eg/English/Navigation/Pages/TransitRequests.aspx
 *
 * Full RPA submission is not yet implemented — SCA's portal uses multi-factor auth
 * and requires a licensed Suez navigation agent account in many cases.
 * Current approach: secure credential storage + filing package generation for
 * agent-assisted upload, with full audit trail.
 */

const crypto = require('crypto');

// ── Encryption ────────────────────────────────────────────────────────────────
// AES-256-GCM, same pattern as ACP credentials.
// Key derived from SCA_ENCRYPTION_KEY env var (falls back to JWT_SECRET).

function deriveScaKey() {
  const secret = process.env.SCA_ENCRYPTION_KEY || process.env.JWT_SECRET || 'canalclear-sca-default-key';
  return crypto.createHash('sha256').update(secret).digest(); // 32 bytes
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" as hex — stored as-is in the DB.
 */
function encryptSca(text) {
  const key = deriveScaKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a stored "iv:authTag:ciphertext" value.
 */
function decryptSca(stored) {
  const key = deriveScaKey();
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Filing package generation ─────────────────────────────────────────────────

/**
 * Build a structured SCA filing package from CanalClear filing data.
 * This package is what gets submitted to the SCA E-Services portal (either
 * automatically in future or manually by the user/agent now).
 *
 * @param {object} filingData — from `filings` table row
 * @returns {object} SCA transit request package
 */
function buildScaTransitPackage(filingData) {
  const now = new Date();

  // SCA reference format: SCA-{YEAR}-{transit_direction}-{random}
  const direction = filingData.transit_direction || 'NB';
  const refToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  const localRef = `SCA-${now.getFullYear()}-${direction}-${refToken}`;

  return {
    local_reference: localRef,
    generated_at: now.toISOString(),
    authority: 'Suez Canal Authority (SCA)',
    portal_url: 'https://www.suezcanal.gov.eg/English/Navigation/Pages/Navigation.aspx',
    workspace_url: 'https://www.suezcanal.gov.eg/English/Navigation/Pages/TransitRequests.aspx',

    // Vessel particulars
    vessel: {
      name: filingData.vessel_name || '',
      imo: filingData.imo_number || '',
      flag: filingData.flag_state || '',
      call_sign: filingData.call_sign || '',
      vessel_type: filingData.vessel_type || '',
      gross_tonnage: filingData.gross_tonnage || null,
      scnt: filingData.scnt || null,         // Suez Canal Net Tonnage
      loa: filingData.loa || null,
      beam: filingData.beam || null,
      max_draft: filingData.max_draft || null,
      draft_forward: filingData.draft_forward || null,
      draft_aft: filingData.draft_aft || null,
      air_draft: filingData.air_draft || null,  // El-Ferdan bridge clearance: 70m limit
    },

    // Transit details
    transit: {
      direction: filingData.transit_direction || null,
      eta_suez_canal: filingData.eta || null,
      port_of_departure: filingData.port_of_loading || null,
      port_of_destination: filingData.port_of_discharge || null,
      pilot_required: filingData.pilot_required !== false,
      tug_required: filingData.tug_required || false,
    },

    // Cargo
    cargo: {
      type: filingData.cargo_type || null,
      description: filingData.cargo_description || null,
      quantity_mt: filingData.cargo_quantity || null,
      dangerous_goods: filingData.has_dangerous_goods || false,
      imdg_class: filingData.imdg_class || null,
      un_number: filingData.un_number || null,
    },

    // Crew
    crew: {
      total_persons_on_board: filingData.total_pob || null,
      master_name: filingData.master_name || null,
      master_nationality: filingData.master_nationality || null,
    },

    // Documents required per SCA pre-arrival notice
    required_documents: [
      'SCA Pre-Arrival Notice (Transit Application)',
      'Crew List (Suez format with STCW certs)',
      'Cargo Declaration (IMDG Amendment 42-24)',
      'ISPS Declaration (72h/48h/24h notifications)',
      'SCNT Certificate',
      ...(filingData.has_dangerous_goods ? ['DG Manifest (IMDG)'] : []),
      'Ship Sanitation Certificate',
    ],

    // Submission method guidance
    submission_guidance: {
      method: 'portal_upload',
      steps: [
        'Log in to SCA E-Services: https://www.suezcanal.gov.eg',
        'Navigate to Workspace → Transit Requests',
        'Select "New Transit Request" and enter your vessel IMO',
        'Upload this package as supporting documents',
        'Submit and note the SCA Transit Reference Number',
      ],
      agent_note: 'If filing through a licensed Suez navigation agent, forward this package to your agent with your SCA transit request reference.',
    },
  };
}

/**
 * Generate an SCA reference number for a simulated/assisted submission.
 * Format: SCA-{YEAR}-{4-hex}
 */
function generateScaReference() {
  const year = new Date().getFullYear();
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SCA-${year}-${token}`;
}

/**
 * Build an audit log entry for an SCA submission attempt.
 */
function buildSubmissionAuditEntry(userId, filingId, action, details) {
  return {
    user_id: userId,
    filing_id: filingId,
    action,
    actor: `user:${userId}`,
    details,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  encryptSca,
  decryptSca,
  buildScaTransitPackage,
  generateScaReference,
  buildSubmissionAuditEntry,
};
