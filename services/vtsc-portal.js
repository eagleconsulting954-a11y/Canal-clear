/**
 * services/vtsc-portal.js — Turkish Straits VTSC SP-1 email submission service.
 *
 * Owns: SP-1 email generation, VTSC email delivery via Polsia proxy, submission
 *       package formatting per Turkish Straits VTS regulations, audit support.
 * Does NOT own: route handling, DB queries, auth, credential storage.
 *
 * Authority: Directorate General of Coastal Safety (Kıyı Emniyeti)
 * Channel: SP-1 sent via email to Istanbul VTS and/or Çanakkale VTS at least
 *          72 hours before arrival (24h hard minimum; 48h recommended for hazmat).
 * Regulation: Turkish Straits Maritime Traffic Regulations (OG 28-11-1998, updated 2003)
 */

const crypto = require('crypto');

// ── VTSC Email Addresses ──────────────────────────────────────────────────────
// Official notification addresses per Kıyı Emniyeti (Turkish Coastal Safety).
// Istanbul VTS covers the Bosporus (İstanbul Boğazı).
// Çanakkale VTS covers the Dardanelles (Çanakkale Boğazı).

const VTSC_CONTACTS = {
  istanbul: {
    name: 'Istanbul VTS',
    email: 'istanbul.vts@kiyi.gov.tr',
    waterway: 'Bosporus (İstanbul Boğazı)',
    vhf_working: 'Ch 16, 12',
  },
  canakkale: {
    name: 'Çanakkale VTS',
    email: 'canakkale.vts@kiyi.gov.tr',
    waterway: 'Dardanelles (Çanakkale Boğazı)',
    vhf_working: 'Ch 16, 11',
  },
};

// ── SP-1 Report Generator ─────────────────────────────────────────────────────

/**
 * Format an SP-1 Pre-Arrival Notification email body from a Bosporus filing.
 * Format follows Turkish Straits VTS requirements per the Vessel Traffic Service
 * Regulations for Turkish Straits (1998/2003).
 *
 * @param {object} filing — sp1_filings row or equivalent data object
 * @param {string} vtsCenterKey — 'istanbul' | 'canakkale' | 'both'
 * @returns {{ subject: string, body: string, html: string }}
 */
function buildSP1Email(filing, vtsCenterKey) {
  const vts = VTSC_CONTACTS[vtsCenterKey === 'both' ? 'istanbul' : vtsCenterKey];
  const now = new Date();
  const generatedAt = now.toUTCString();

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
  const transitDir = (filing.transit_direction || '').toUpperCase();
  const lastPort = filing.last_port || '';
  const nextPort = filing.next_port || '';
  const eta = filing.estimated_arrival
    ? new Date(filing.estimated_arrival).toUTCString()
    : '';
  const cargoType = (filing.cargo_type || '').replace(/_/g, ' ').toUpperCase();
  const cargoQty = filing.cargo_quantity || '';
  const hasDG = (filing.document_data || {}).has_dangerous_goods;
  const dgClass = filing.dangerous_goods_class || '';
  const crewCount = filing.crew_count || '';
  const paxCount = filing.passenger_count || 0;
  const agentName = filing.agent_name || '';
  const agentContact = filing.agent_contact || '';
  const piClub = filing.pi_club || '';
  const pilotBooked = (filing.document_data || {}).pilot_booked ? 'YES' : 'TO BE CONFIRMED';

  const dirLabel = transitDir === 'NORTHBOUND'
    ? 'NORTHBOUND (Black Sea → Mediterranean / Marmara)'
    : transitDir === 'SOUTHBOUND'
    ? 'SOUTHBOUND (Mediterranean / Marmara → Black Sea)'
    : transitDir;

  // Local CanalClear reference
  const refToken = crypto.randomBytes(3).toString('hex').toUpperCase();
  const vtscRef = `VTSC-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${refToken}`;

  const subject = `SP-1 PRE-ARRIVAL NOTIFICATION — ${vessel} (IMO ${imo}) — ${dirLabel} ETA ${eta}`;

  const body = `TO: ${vts ? vts.name : 'Turkish Straits VTS'}
${vtsCenterKey === 'both' ? 'CC: ' + VTSC_CONTACTS.canakkale.name + ' <' + VTSC_CONTACTS.canakkale.email + '>\n' : ''}DATE: ${generatedAt}
CanalClear Reference: ${vtscRef}

SP-1 PRE-ARRIVAL NOTIFICATION
Turkish Straits Vessel Traffic Service (TBSS)
Turkish Straits Maritime Traffic Regulations

──────────────────────────────────────────────────────────
SECTION 1 — VESSEL PARTICULARS
──────────────────────────────────────────────────────────
Vessel Name:         ${vessel}
IMO Number:          ${imo}
Flag State:          ${flag}
Call Sign:           ${callSign || '—'}
MMSI:                ${mmsi || '—'}
Vessel Type:         ${vesselType || '—'}
Gross Tonnage (GT):  ${gt || '—'}
Net Tonnage (NT):    ${nt || '—'}
Length Overall (LOA):${loa ? loa + ' m' : '—'}
Beam:                ${beam ? beam + ' m' : '—'}
Loaded Draft (Max):  ${draft ? draft + ' m' : '—'}

──────────────────────────────────────────────────────────
SECTION 2 — TRANSIT DETAILS
──────────────────────────────────────────────────────────
Transit Direction:   ${dirLabel || '—'}
Last Port of Call:   ${lastPort || '—'}
Next Port of Call:   ${nextPort || '—'}
Estimated Arrival (ETA): ${eta || '—'}

──────────────────────────────────────────────────────────
SECTION 3 — CARGO DECLARATION
──────────────────────────────────────────────────────────
Cargo Type:          ${cargoType || 'NO CARGO / IN BALLAST'}
Cargo Quantity:      ${cargoQty ? cargoQty + ' MT' : '—'}
Dangerous Goods:     ${hasDG ? 'YES — IMDG Class ' + (dgClass || 'SEE MANIFEST') : 'NONE DECLARED'}${hasDG ? '\n\n*** HAZARDOUS CARGO — 48h minimum advance notice required per Turkish Straits Traffic Regulations ***' : ''}

──────────────────────────────────────────────────────────
SECTION 4 — CREW AND PERSONS ON BOARD
──────────────────────────────────────────────────────────
Total Crew:          ${crewCount || '—'}
Passengers:          ${paxCount || 0}
Total POB:           ${crewCount && paxCount !== undefined ? (parseInt(crewCount)||0) + (parseInt(paxCount)||0) : '—'}

──────────────────────────────────────────────────────────
SECTION 5 — PILOTAGE AND SERVICES
──────────────────────────────────────────────────────────
Pilotage Required:   ${(parseFloat(loa) > 150 || parseFloat(gt) > 10000) ? 'MANDATORY' : 'NOT REQUIRED'}
Pilot Booking:       ${pilotBooked}

──────────────────────────────────────────────────────────
SECTION 6 — SHIP AGENT AND P&I DETAILS
──────────────────────────────────────────────────────────
Ship Agent:          ${agentName || '—'}
Agent Contact:       ${agentContact || '—'}
P&I Club:            ${piClub || '—'}

──────────────────────────────────────────────────────────
NOTICE
──────────────────────────────────────────────────────────
Any changes to the above particulars (ETA, cargo, draft, pilotage)
must be communicated IMMEDIATELY to the relevant VTS Center via the
same channel.

For VHF contact: ${vts ? vts.vhf_working : 'See VTS regulations for working channels'}.

This notification was generated by CanalClear (canal-clear.polsia.app).
The ship operator/agent is responsible for the accuracy of all data submitted.

──────────────────────────────────────────────────────────
END OF SP-1 PRE-ARRIVAL NOTIFICATION
CanalClear Reference: ${vtscRef}
──────────────────────────────────────────────────────────
`;

  // HTML version — same content, formatted for readability in email clients
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
  td:first-child { color:#8fa3b8; width:180px; }
  td:last-child { font-weight:600; color:#1a2332; }
  .hazmat { background:#fff3cd; border:1px solid #ffc107; border-radius:6px; padding:8px 12px; font-family:Arial,sans-serif; font-size:0.8rem; color:#856404; margin-top:8px; }
  .notice { padding:16px 24px; background:#f0fdf8; border-top:2px solid #00C49A; font-family:Arial,sans-serif; font-size:0.78rem; color:#4a5568; line-height:1.6; }
  .footer { padding:12px 24px; background:#f8fafc; font-family:Arial,sans-serif; font-size:0.72rem; color:#8fa3b8; text-align:center; }
</style>
</head><body>
<div class="wrapper">
  <div class="header">
    <h1>SP-1 Pre-Arrival Notification — ${vessel}</h1>
    <p>Turkish Straits Vessel Traffic Service (TBSS) · ${dirLabel}</p>
    <span class="badge">CanalClear Ref: ${vtscRef}</span>
  </div>

  <div class="section">
    <h2>Section 1 — Vessel Particulars</h2>
    <table>
      <tr><td>Vessel Name</td><td>${vessel}</td></tr>
      <tr><td>IMO Number</td><td>${imo}</td></tr>
      <tr><td>Flag State</td><td>${flag}</td></tr>
      <tr><td>Call Sign</td><td>${callSign || '—'}</td></tr>
      <tr><td>MMSI</td><td>${mmsi || '—'}</td></tr>
      <tr><td>Vessel Type</td><td>${vesselType || '—'}</td></tr>
      <tr><td>Gross Tonnage (GT)</td><td>${gt || '—'}</td></tr>
      <tr><td>Net Tonnage (NT)</td><td>${nt || '—'}</td></tr>
      <tr><td>Length Overall (LOA)</td><td>${loa ? loa + ' m' : '—'}</td></tr>
      <tr><td>Beam</td><td>${beam ? beam + ' m' : '—'}</td></tr>
      <tr><td>Loaded Draft (Max)</td><td>${draft ? draft + ' m' : '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 2 — Transit Details</h2>
    <table>
      <tr><td>Transit Direction</td><td>${dirLabel || '—'}</td></tr>
      <tr><td>Last Port of Call</td><td>${lastPort || '—'}</td></tr>
      <tr><td>Next Port of Call</td><td>${nextPort || '—'}</td></tr>
      <tr><td>Estimated Arrival (ETA)</td><td>${eta || '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 3 — Cargo Declaration</h2>
    <table>
      <tr><td>Cargo Type</td><td>${cargoType || 'NO CARGO / IN BALLAST'}</td></tr>
      <tr><td>Cargo Quantity</td><td>${cargoQty ? cargoQty + ' MT' : '—'}</td></tr>
      <tr><td>Dangerous Goods</td><td>${hasDG ? 'YES — IMDG Class ' + (dgClass || 'SEE MANIFEST') : 'None declared'}</td></tr>
    </table>
    ${hasDG ? '<div class="hazmat">⚠ Hazardous Cargo — 48h minimum advance notice required per Turkish Straits Traffic Regulations. Ensure DG manifest and IMDG certificates are attached.</div>' : ''}
  </div>

  <div class="section">
    <h2>Section 4 — Crew and Persons on Board</h2>
    <table>
      <tr><td>Total Crew</td><td>${crewCount || '—'}</td></tr>
      <tr><td>Passengers</td><td>${paxCount || 0}</td></tr>
      <tr><td>Total POB</td><td>${crewCount ? (parseInt(crewCount)||0) + (parseInt(paxCount)||0) : '—'}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 5 — Pilotage and Services</h2>
    <table>
      <tr><td>Pilotage Required</td><td>${(parseFloat(loa) > 150 || parseFloat(gt) > 10000) ? '<strong style="color:#e65c00">MANDATORY</strong>' : 'Not required'}</td></tr>
      <tr><td>Pilot Booking</td><td>${pilotBooked}</td></tr>
    </table>
  </div>

  <div class="section">
    <h2>Section 6 — Ship Agent and P&I Details</h2>
    <table>
      <tr><td>Ship Agent</td><td>${agentName || '—'}</td></tr>
      <tr><td>Agent Contact</td><td>${agentContact || '—'}</td></tr>
      <tr><td>P&I Club</td><td>${piClub || '—'}</td></tr>
    </table>
  </div>

  <div class="notice">
    <strong>Important Notice:</strong> Any changes to the above particulars (ETA, cargo, draft, pilotage)
    must be communicated <strong>immediately</strong> to the relevant VTS Center via the same channel.<br>
    For VHF contact: <strong>${vts ? vts.vhf_working : 'See VTS regulations'}</strong>.
  </div>

  <div class="footer">
    Generated by CanalClear · <a href="https://canal-clear.polsia.app" style="color:#00C49A;text-decoration:none;">canal-clear.polsia.app</a><br>
    The ship operator/agent is responsible for the accuracy of all data submitted.<br>
    <strong>${vtscRef}</strong>
  </div>
</div>
</body></html>`;

  return { subject, body, html, vtscRef };
}

// ── Email Send ────────────────────────────────────────────────────────────────

/**
 * Determine the recipient email address(es) for a VTSC submission.
 * Istanbul VTS covers Bosporus. Çanakkale VTS covers Dardanelles.
 * For 'both', the primary recipient is Istanbul and Çanakkale is CC'd.
 */
function getVtscRecipient(vtsCenterKey) {
  if (vtsCenterKey === 'canakkale') {
    return { primary: VTSC_CONTACTS.canakkale.email, cc: null };
  }
  // Default istanbul or both — Istanbul is primary
  return {
    primary: VTSC_CONTACTS.istanbul.email,
    cc: vtsCenterKey === 'both' ? VTSC_CONTACTS.canakkale.email : null,
  };
}

/**
 * Send SP-1 email to Turkish Straits VTS Center via Polsia email proxy.
 * Returns { success, vtscRef, recipientEmail, messageHash, error? }
 *
 * @param {object} filing — sp1_filings row
 * @param {string} vtsCenterKey — 'istanbul' | 'canakkale' | 'both'
 */
async function sendSP1ToVTSC(filing, vtsCenterKey) {
  const { subject, body, html, vtscRef } = buildSP1Email(filing, vtsCenterKey);
  const { primary: recipientEmail } = getVtscRecipient(vtsCenterKey);

  // SHA-256 of the email body — stored in audit log, no sensitive data saved
  const messageHash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);

  const polsiaKey = process.env.POLSIA_API_KEY;
  if (!polsiaKey) {
    return {
      success: false,
      error: 'POLSIA_API_KEY not configured — email proxy unavailable',
      vtscRef,
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
        vtscRef,
        recipientEmail,
        messageHash,
      };
    }

    return { success: true, vtscRef, recipientEmail, messageHash };
  } catch (err) {
    return {
      success: false,
      error: `Email send failed: ${err.message}`,
      vtscRef,
      recipientEmail,
      messageHash,
    };
  }
}

// ── Reference Generation ──────────────────────────────────────────────────────

function generateVtscReference() {
  const year = new Date().getFullYear();
  const mo = String(new Date().getMonth() + 1).padStart(2, '0');
  const token = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `VTSC-${year}-${mo}-${token}`;
}

module.exports = {
  buildSP1Email,
  sendSP1ToVTSC,
  generateVtscReference,
  getVtscRecipient,
  VTSC_CONTACTS,
};
