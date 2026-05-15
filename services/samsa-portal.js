/**
 * services/samsa-portal.js — SAMSA ISPS pre-arrival email submission service.
 *
 * Owns: ISPS pre-arrival message generation, Cape Town Radio email delivery via
 *       Polsia proxy, submission package formatting per SAMSA Marine Notice 12/2008,
 *       audit support.
 * Does NOT own: route handling, DB queries, auth.
 *
 * Authority: South African Maritime Safety Authority (SAMSA)
 * Channel: Email to Cape Town Radio, minimum 96 hours before arrival at South African waters.
 * Regulation: SAMSA Marine Notice 12 of 2008 (ISPS Pre-Arrival Information)
 * Format: Plain text body — NO attachments per Marine Notice 12/2008.
 */

const crypto = require('crypto');

// ── Cape Town Radio Contact ───────────────────────────────────────────────────
// Official ISPS pre-arrival notification address per SAMSA Marine Notice 12/2008.
// Cape Town Radio is operated by Telkom SA and receives pre-arrival ISPS messages
// for all South African ports (Cape Town, Durban, Port Elizabeth, East London, etc.)

const CAPE_TOWN_RADIO = {
  name: 'Cape Town Radio',
  email: 'ctradio@telkom.co.za',
  callSign: 'ZSC',
  vhf: 'Ch 16 / DSC Ch 70',
  authority: 'SAMSA (South African Maritime Safety Authority)',
};

// ── ISPS Pre-Arrival Message Generator ───────────────────────────────────────

/**
 * Format an ISPS pre-arrival notification email body from a Cape of Good Hope filing.
 * Format follows SAMSA Marine Notice 12 of 2008 — structured plain text,
 * no attachments permitted.
 *
 * @param {object} filing — cape_filings row or equivalent data object
 * @returns {{ subject: string, body: string, html: string, samsaRef: string }}
 */
function buildISPSEmail(filing) {
  const now = new Date();
  const generatedAt = now.toUTCString();

  // Normalise common field aliases so callers can pass raw form data OR a DB row
  const imo = (filing.imo_number || '').replace(/^IMO\s*/i, '').trim();
  const vessel = filing.vessel_name || '';
  const flag = filing.flag_state || '';
  const callSign = filing.call_sign || filing.callsign || '';
  const mmsi = filing.mmsi || '';
  const vesselType = (filing.vessel_type || '').replace(/_/g, ' ').toUpperCase();
  const gt = filing.gross_tonnage || '';
  const nt = filing.net_tonnage || '';
  const loa = filing.loa || '';
  const beam = filing.beam || '';
  const draft = filing.draft || '';

  const portOfOrigin = filing.port_of_origin || filing.last_port || '';
  const nextPort = filing.next_port || '';
  const eta = filing.estimated_arrival
    ? new Date(filing.estimated_arrival).toUTCString()
    : '';
  const deadline96h = filing.deadline_96h_at
    ? new Date(filing.deadline_96h_at).toUTCString()
    : '';

  const ispsLevel = filing.isps_security_level || 1;
  const crewCount = filing.crew_count || '';

  // Last 10 ports — stored as JSON array or comma-string
  let last10Ports = [];
  if (Array.isArray(filing.last_10_ports)) {
    last10Ports = filing.last_10_ports;
  } else if (typeof filing.last_10_ports === 'string') {
    try {
      const parsed = JSON.parse(filing.last_10_ports);
      last10Ports = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      last10Ports = filing.last_10_ports.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const hasDG = filing.has_dangerous_goods || false;
  const dgClass = filing.dangerous_goods_class || '';
  const dgDetail = filing.dangerous_goods_detail || '';

  // SSO details
  const ssoName = filing.sso_name || '';
  const ssoContact = filing.sso_contact || '';
  const ssoEmail = filing.sso_email || '';

  const cargoSummary = filing.cargo_summary || 'NOT SPECIFIED';

  // CanalClear audit reference
  const refToken = crypto.randomBytes(3).toString('hex').toUpperCase();
  const samsaRef = `SAMSA-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${refToken}`;

  // ─── Subject ────────────────────────────────────────────────────────────────
  // Marine Notice 12/2008 recommends "ISPS PRE-ARRIVAL NOTIFICATION — [VESSEL] (IMO [NO])"
  const subject = `ISPS PRE-ARRIVAL NOTIFICATION — ${vessel} (IMO ${imo}) — ETA ${eta}`;

  // ─── Plain-text body per Marine Notice 12/2008 ────────────────────────────
  // No attachments. Structured with section headers as specified in the Marine Notice.
  const last10PortsText = last10Ports.length
    ? last10Ports.map((p, i) => {
        if (typeof p === 'object' && p !== null) {
          return `  ${i+1}. ${p.port || p.name || JSON.stringify(p)}${p.date ? ' — ' + p.date : ''}`;
        }
        return `  ${i+1}. ${p}`;
      }).join('\n')
    : '  Not provided';

  const body = `TO: ${CAPE_TOWN_RADIO.name} (${CAPE_TOWN_RADIO.callSign})
DATE: ${generatedAt}
CanalClear Reference: ${samsaRef}

ISPS PRE-ARRIVAL NOTIFICATION
South African Maritime Safety Authority (SAMSA)
Marine Notice 12 of 2008

──────────────────────────────────────────────────────────
SECTION 1 — SHIP PARTICULARS
──────────────────────────────────────────────────────────
Ship Name:              ${vessel || '—'}
IMO Number:             ${imo || '—'}
Flag State:             ${flag || '—'}
Call Sign:              ${callSign || '—'}
MMSI:                   ${mmsi || '—'}
Type of Ship:           ${vesselType || '—'}
Gross Tonnage (GT):     ${gt || '—'}
Net Tonnage (NT):       ${nt || '—'}
Length Overall (LOA):   ${loa ? loa + ' m' : '—'}
Beam:                   ${beam ? beam + ' m' : '—'}
Maximum Draft:          ${draft ? draft + ' m' : '—'}

──────────────────────────────────────────────────────────
SECTION 2 — VOYAGE INFORMATION
──────────────────────────────────────────────────────────
Port of Origin:         ${portOfOrigin || '—'}
Port of Destination:    ${nextPort || '—'}
Estimated Time of Arrival (ETA): ${eta || '—'}
Filing Deadline (96h):  ${deadline96h || '—'}

──────────────────────────────────────────────────────────
SECTION 3 — CARGO
──────────────────────────────────────────────────────────
Cargo Description:      ${cargoSummary}
Dangerous Goods:        ${hasDG ? 'YES — IMDG Class ' + (dgClass || 'SEE MANIFEST') + (dgDetail ? ' — ' + dgDetail : '') : 'NONE DECLARED'}${hasDG ? '\n\n*** DANGEROUS GOODS ON BOARD — Full DG manifest to follow as separate communication ***' : ''}

──────────────────────────────────────────────────────────
SECTION 4 — CREW
──────────────────────────────────────────────────────────
Number of Crew:         ${crewCount || '—'}

──────────────────────────────────────────────────────────
SECTION 5 — ISPS SECURITY INFORMATION
──────────────────────────────────────────────────────────
Current ISPS Security Level: ${ispsLevel || '—'}

Ship Security Officer (SSO):
  Name:    ${ssoName || '—'}
  Contact: ${ssoContact || '—'}
  Email:   ${ssoEmail || '—'}

──────────────────────────────────────────────────────────
SECTION 6 — LAST 10 PORTS OF CALL
(per ISPS Code and SAMSA Marine Notice 12/2008)
──────────────────────────────────────────────────────────
${last10PortsText}

──────────────────────────────────────────────────────────
DECLARATION
──────────────────────────────────────────────────────────
The above information is submitted in accordance with the
International Ship and Port Facility Security (ISPS) Code
and SAMSA Marine Notice 12 of 2008.

The ship Master confirms that the information provided is
accurate and complete to the best of their knowledge.

Any changes to the above particulars (ETA, cargo, crew,
security level) must be reported IMMEDIATELY to Cape Town
Radio via the same channel.

──────────────────────────────────────────────────────────
This notification was generated by CanalClear (canal-clear.polsia.app).
The ship operator/agent/Master is responsible for the accuracy of all
data submitted.

Cape Town Radio VHF: ${CAPE_TOWN_RADIO.vhf}
──────────────────────────────────────────────────────────
END OF ISPS PRE-ARRIVAL NOTIFICATION
CanalClear Reference: ${samsaRef}
──────────────────────────────────────────────────────────
`;

  // ─── HTML version — same content, formatted for email clients ────────────
  const last10PortsHtml = last10Ports.length
    ? last10Ports.map((p, i) => {
        if (typeof p === 'object' && p !== null) {
          return `<tr><td>${i+1}.</td><td>${p.port || p.name || JSON.stringify(p)}</td><td>${p.date || '—'}</td></tr>`;
        }
        return `<tr><td>${i+1}.</td><td colspan="2">${p}</td></tr>`;
      }).join('')
    : '<tr><td colspan="3" style="color:#8fa3b8;font-style:italic;">Not provided</td></tr>';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  body { font-family: 'Courier New', Courier, monospace; background:#f5f7fa; margin:0; padding:20px; color:#1a2332; }
  .wrapper { max-width:720px; margin:0 auto; background:#fff; border:1px solid #d1d9e6; border-radius:8px; overflow:hidden; }
  .header { background:#0A1628; color:#00C49A; padding:18px 24px; }
  .header h1 { margin:0; font-size:1rem; font-family:Arial,sans-serif; }
  .header p { margin:4px 0 0; font-size:0.78rem; color:#8fa3b8; font-family:Arial,sans-serif; }
  .badge { display:inline-block; background:rgba(0,196,154,0.1); border:1px solid #00C49A; border-radius:4px; padding:2px 8px; font-size:0.72rem; color:#00C49A; margin-top:6px; }
  .section { padding:16px 24px; border-bottom:1px solid #e9ecf2; }
  .section h2 { font-family:Arial,sans-serif; font-size:0.78rem; font-weight:700; color:#8fa3b8; text-transform:uppercase; letter-spacing:0.08em; margin:0 0 12px; }
  table { width:100%; border-collapse:collapse; }
  td { padding:5px 0; font-size:0.82rem; vertical-align:top; }
  td:first-child { color:#8fa3b8; width:200px; }
  td:last-child { font-weight:600; color:#1a2332; }
  .ports-table td:first-child { color:#8fa3b8; width:30px; }
  .ports-table td:nth-child(2) { font-weight:600; color:#1a2332; width:200px; }
  .ports-table td:nth-child(3) { font-weight:400; color:#8fa3b8; }
  .hazmat { background:#fff3cd; border:1px solid #ffc107; border-radius:6px; padding:8px 12px; font-family:Arial,sans-serif; font-size:0.8rem; color:#856404; margin-top:8px; }
  .notice { padding:16px 24px; background:#f0fdf8; border-top:2px solid #00C49A; font-family:Arial,sans-serif; font-size:0.78rem; color:#4a5568; line-height:1.6; }
  .footer { padding:12px 24px; background:#f8fafc; font-family:Arial,sans-serif; font-size:0.72rem; color:#8fa3b8; text-align:center; }
  .isps-badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:0.8rem; font-weight:700; }
  .isps-1 { background:rgba(46,213,115,0.1); color:#2ED573; border:1px solid rgba(46,213,115,0.3); }
  .isps-2 { background:rgba(255,165,2,0.1); color:#FFA502; border:1px solid rgba(255,165,2,0.3); }
  .isps-3 { background:rgba(255,71,87,0.1); color:#FF4757; border:1px solid rgba(255,71,87,0.3); }
</style>
</head><body>
<div class="wrapper">
  <div class="header">
    <h1>ISPS Pre-Arrival Notification — ${vessel}</h1>
    <p>SAMSA Marine Notice 12/2008 · Cape Town Radio (ZSC)</p>
    <span class="badge">CanalClear Ref: ${samsaRef}</span>
  </div>

  <div class="section">
    <h2>Section 1 — Ship Particulars</h2>
    <table>
      <tr><td>Ship Name</td><td>${vessel}</td></tr>
      <tr><td>IMO Number</td><td>${imo}</td></tr>
      <tr><td>Flag State</td><td>${flag || '—'}</td></tr>
      <tr><td>Call Sign</td><td>${callSign || '—'}</td></tr>
      <tr><td>MMSI</td><td>${mmsi || '—'}</td></tr>
      <tr><td>Type of Ship</td><td>${vesselType || '—'}</td></tr>
      <tr><td>Gross Tonnage (GT)</td><td>${gt || '—'}</td></tr>
      <tr><td>Net Tonnage (NT)</td><td>${nt || '—'}</td></tr>
      <tr><td>Length Overall (LOA)</td><td>${loa ? loa + ' m' : '—'}</td></tr>
      <tr><td>Beam</td><td>${beam ? beam + ' m' : '—'}</td></tr>
      <tr><td>Maximum Draft</td><td>${draft ? draft + ' m' : '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 2 — Voyage Information</h2>
    <table>
      <tr><td>Port of Origin</td><td>${portOfOrigin || '—'}</td></tr>
      <tr><td>Port of Destination</td><td>${nextPort || '—'}</td></tr>
      <tr><td>ETA</td><td>${eta || '—'}</td></tr>
      <tr><td>Filing Deadline (96h)</td><td>${deadline96h || '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 3 — Cargo</h2>
    <table>
      <tr><td>Cargo Description</td><td>${cargoSummary}</td></tr>
      <tr><td>Dangerous Goods</td><td>${hasDG ? 'YES — IMDG Class ' + (dgClass || 'SEE MANIFEST') : 'None declared'}</td></tr>
    </table>
    ${hasDG ? '<div class="hazmat">⚠ Dangerous Goods on board — full DG manifest must be submitted as a separate communication per IMDG Code requirements.</div>' : ''}
  </div>

  <div class="section">
    <h2>Section 4 — Crew</h2>
    <table>
      <tr><td>Number of Crew</td><td>${crewCount || '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 5 — ISPS Security Information</h2>
    <table>
      <tr><td>Current Security Level</td><td><span class="isps-badge isps-${ispsLevel}">ISPS LEVEL ${ispsLevel}</span></td></tr>
      <tr><td>SSO Name</td><td>${ssoName || '—'}</td></tr>
      <tr><td>SSO Contact</td><td>${ssoContact || '—'}</td></tr>
      <tr><td>SSO Email</td><td>${ssoEmail || '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 6 — Last 10 Ports of Call</h2>
    <table class="ports-table">
      <tr style="border-bottom:1px solid #e9ecf2;"><td></td><td style="color:#8fa3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;">Port</td><td style="color:#8fa3b8;font-size:0.75rem;font-weight:600;text-transform:uppercase;">Date</td></tr>
      ${last10PortsHtml}
    </table>
  </div>

  <div class="notice">
    <strong>Declaration:</strong> The above information is submitted in accordance with the International Ship and Port
    Facility Security (ISPS) Code and SAMSA Marine Notice 12 of 2008.<br><br>
    Any changes to ETA, cargo, crew count, or security level must be reported <strong>immediately</strong> to
    Cape Town Radio via the same channel.<br>
    VHF Contact: <strong>${CAPE_TOWN_RADIO.vhf}</strong>
  </div>

  <div class="footer">
    Generated by CanalClear · <a href="https://canal-clear.polsia.app" style="color:#00C49A;text-decoration:none;">canal-clear.polsia.app</a><br>
    The ship operator/agent/Master is responsible for the accuracy of all data submitted.<br>
    <strong>${samsaRef}</strong>
  </div>
</div>
</body></html>`;

  return { subject, body, html, samsaRef };
}

// ── Email Send ────────────────────────────────────────────────────────────────

/**
 * Send ISPS pre-arrival notification to Cape Town Radio via Polsia email proxy.
 * Returns { success, samsaRef, recipientEmail, messageHash, error? }
 *
 * @param {object} filing — cape_filings row or equivalent data object
 */
async function sendISPSToCapeRadio(filing) {
  const { subject, body, html, samsaRef } = buildISPSEmail(filing);
  const recipientEmail = CAPE_TOWN_RADIO.email;

  // SHA-256 of the email body — stored in audit log, no PII saved separately
  const messageHash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);

  const polsiaKey = process.env.POLSIA_API_KEY;
  if (!polsiaKey) {
    return {
      success: false,
      error: 'POLSIA_API_KEY not configured — email proxy unavailable',
      samsaRef,
      recipientEmail,
      messageHash,
    };
  }

  try {
    const resp = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${polsiaKey}`,
      },
      body: JSON.stringify({
        to: recipientEmail,
        subject,
        body,
        html,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      return {
        success: false,
        error: `Email proxy returned ${resp.status}: ${errBody.slice(0, 200)}`,
        samsaRef,
        recipientEmail,
        messageHash,
      };
    }

    return { success: true, samsaRef, recipientEmail, messageHash, subject };
  } catch (err) {
    return {
      success: false,
      error: `Email send failed: ${err.message}`,
      samsaRef,
      recipientEmail,
      messageHash,
    };
  }
}

// ── Reference Generation ──────────────────────────────────────────────────────

function generateSamsaReference() {
  const year = new Date().getFullYear();
  const mo = String(new Date().getMonth() + 1).padStart(2, '0');
  const token = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SAMSA-${year}-${mo}-${token}`;
}

module.exports = {
  buildISPSEmail,
  sendISPSToCapeRadio,
  generateSamsaReference,
  CAPE_TOWN_RADIO,
};
