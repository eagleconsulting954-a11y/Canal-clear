'use strict';

/**
 * CanalClear Alert Service
 *
 * Handles:
 *  1. Certificate expiry alerts (90 / 30 / 7 / 0 days before expiry)
 *  2. VUMPA filing deadline reminders (96h / 48h / 24h)
 *  3. Alert preference management
 *
 * Email is sent via the Polsia email proxy (POLSIA_R2_BASE_URL/email/send).
 * Falls back to console logging if not configured.
 *
 * Designed to be called once daily from server.js.
 */

const { checkFilingsTableExists } = require('../db/validations');
const {
  checkAlertSent,
  insertAlert,
  getRecentFilingStatusChanges,
  getCertificatesNearExpiry,
  getDailyDigestCerts,
  getPendingIspsNotifications,
  markIspsAlert6hSent,
  markIspsAlertOverdueSent,
} = require('../db/alert-history');

// ─── Certificate type display names ──────────────────────────────────────────
const CERT_TYPE_LABELS = {
  iopp: 'IOPP Certificate',
  issc: 'International Ship Security Certificate (ISSC)',
  class_cert: 'Class Certificate',
  smc: 'Safety Management Certificate (SMC)',
  pcsopep: 'SOPEP / PCSOPEP (Panama Canal Spill Plan)',
  pi_insurance: 'P&I Insurance Certificate',
  load_line: 'Loadline Certificate',
  tonnage: 'International Tonnage Certificate',
  registry: 'Certificate of Registry',
  doc: 'Document of Compliance (DOC)',
  solas_safety: 'SOLAS Safety Certificate',
  marpol_annex_v: 'MARPOL Annex V Garbage Management Plan',
  marpol_annex_vi: 'MARPOL Annex VI IAPP Certificate',
  flag_state: 'Flag State Certificate',
  other: 'Certificate',
};

// ─── Email sending ────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.POLSIA_API_KEY;

  if (!apiKey) {
    console.log(`[Alerts] Email (no api key) → ${to}: ${subject}`);
    return false;
  }

  try {
    const res = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, subject, body: subject, html }),
    });

    if (res.ok) {
      console.log(`[Alerts] Email sent → ${to}: ${subject}`);
      return true;
    }

    const body = await res.text().catch(() => '');
    console.warn(`[Alerts] Email API ${res.status}: ${body.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.error(`[Alerts] Email send error: ${err.message}`);
    return false;
  }
}

// ─── HTML email templates ─────────────────────────────────────────────────────

function urgencyStyle(daysLeft) {
  if (daysLeft <= 0) return { badge: '🚨 EXPIRED', color: '#ef4444', label: 'Critical' };
  if (daysLeft <= 7) return { badge: '🔴 URGENT', color: '#f97316', label: 'Urgent' };
  if (daysLeft <= 30) return { badge: '⚠️ WARNING', color: '#eab308', label: 'Warning' };
  return { badge: 'ℹ️ NOTICE', color: '#22d3ee', label: 'Info' };
}

function emailWrapper(content, { preheader = '' } = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CanalClear Alert</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background:#1e293b;border-radius:12px 12px 0 0;padding:28px 36px;border-bottom:1px solid rgba(0,212,170,0.15);">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="font-size:20px;font-weight:700;color:#f1f5f9;letter-spacing:-0.5px;">Canal<span style="color:#00d4aa;">Clear</span></span>
                </td>
                <td align="right">
                  <span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Fleet Alerts</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background:#1e293b;padding:36px;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;border-radius:0 0 12px 12px;padding:24px 36px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">
              You're receiving this because you have alert notifications enabled on
              <a href="https://canalclear.org" style="color:#00d4aa;text-decoration:none;">CanalClear</a>.<br>
              To manage your alert preferences, visit
              <a href="https://canalclear.org/settings/alerts" style="color:#00d4aa;text-decoration:none;">Settings → Alerts</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildCertExpiryEmail({ vessel, cert, daysLeft, lang }) {
  const { badge, color } = urgencyStyle(daysLeft);
  const certLabel = CERT_TYPE_LABELS[cert.cert_type] || cert.cert_type;
  const expiryStr = new Date(cert.expiry_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const statusLine = daysLeft <= 0
    ? `<strong style="color:#ef4444;">This certificate has expired.</strong> The vessel cannot transit until it is renewed.`
    : `Expires in <strong style="color:${color};">${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong> on ${expiryStr}.`;

  const content = `
    <div style="display:inline-block;background:${color}22;border:1px solid ${color}44;border-radius:8px;padding:6px 14px;margin-bottom:20px;">
      <span style="color:${color};font-size:13px;font-weight:600;">${badge}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      ${certLabel} expiry alert
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">MV ${vessel.name}${vessel.imo ? ' &bull; IMO ' + vessel.imo : ''}${vessel.flag ? ' &bull; ' + vessel.flag : ''}</p>

    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:14px;color:#64748b;">Certificate</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#f1f5f9;">${certLabel}${cert.cert_number ? ' <span style="color:#64748b;font-weight:400;">(' + cert.cert_number + ')</span>' : ''}</p>
      <p style="margin:0 0 6px;font-size:14px;color:#64748b;">Status</p>
      <p style="margin:0;font-size:15px;color:#cbd5e1;">${statusLine}</p>
    </div>

    <div style="background:#0f172a;border:1px solid rgba(0,212,170,0.15);border-radius:10px;padding:20px;margin-bottom:28px;">
      <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#00d4aa;text-transform:uppercase;letter-spacing:0.5px;">Required Action</p>
      <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">
        Contact your classification society or flag state authority to initiate renewal.
        ${daysLeft <= 0 ? 'This vessel <strong>cannot file for Panama Canal transit</strong> until the certificate is renewed and uploaded.' : 'Ensure the updated certificate is uploaded to CanalClear before your next transit filing.'}
      </p>
    </div>

    <a href="https://canalclear.org/app"
       style="display:inline-block;background:#00d4aa;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">
      View Fleet Dashboard →
    </a>
  `;

  return emailWrapper(content, {
    preheader: `${badge}: ${certLabel} for MV ${vessel.name} ${daysLeft <= 0 ? 'has expired' : `expires in ${daysLeft} days`}`,
  });
}

function buildFilingReminderEmail({ vessel, filing, hoursLeft }) {
  const urgency = hoursLeft <= 24 ? { badge: '🔴 URGENT', color: '#ef4444' }
    : hoursLeft <= 48 ? { badge: '⚠️ ACTION NEEDED', color: '#eab308' }
    : { badge: 'ℹ️ REMINDER', color: '#22d3ee' };

  const content = `
    <div style="display:inline-block;background:${urgency.color}22;border:1px solid ${urgency.color}44;border-radius:8px;padding:6px 14px;margin-bottom:20px;">
      <span style="color:${urgency.color};font-size:13px;font-weight:600;">${urgency.badge}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      VUMPA filing window reminder
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">MV ${vessel.name} &bull; Transit in ~${hoursLeft} hours</p>

    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:14px;color:#64748b;">Vessel</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:#f1f5f9;">${vessel.name}</p>
      <p style="margin:0 0 6px;font-size:14px;color:#64748b;">VUMPA Filing Status</p>
      <p style="margin:0;font-size:15px;color:${filing.filed ? '#00d4aa' : '#ef4444'};">
        ${filing.filed ? '✅ Filed' : '❌ Not yet filed'}
      </p>
    </div>

    ${!filing.filed ? `
    <div style="background:#ef444422;border:1px solid #ef444444;border-radius:10px;padding:20px;margin-bottom:28px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#ef4444;text-transform:uppercase;letter-spacing:0.5px;">Action Required</p>
      <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">
        ACP requires VUMPA pre-arrival notice at least <strong style="color:#f1f5f9;">96 hours before arrival</strong>.
        ${hoursLeft <= 96 ? `You have approximately <strong style="color:#ef4444;">${hoursLeft} hours</strong> remaining.` : ''}
        File immediately to avoid open-queue delays (3–7 days).
      </p>
    </div>
    ` : ''}

    <a href="https://canalclear.org/filing"
       style="display:inline-block;background:#00d4aa;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">
      Open Filing Wizard →
    </a>
  `;

  return emailWrapper(content, {
    preheader: `VUMPA filing ${filing.filed ? 'filed ✅' : 'needed ⚠️'} for MV ${vessel.name} — transit in ~${hoursLeft}h`,
  });
}

// ─── Dedup key helpers ────────────────────────────────────────────────────────

function certAlertKey(certId, daysLeft) {
  // One alert per cert per threshold milestone (30/14/7/0)
  // Dedup: same day for <=14 days, monthly bucket for 30-day notice
  const threshold = daysLeft <= 0 ? 0 : daysLeft <= 7 ? 7 : daysLeft <= 14 ? 14 : daysLeft <= 30 ? 30 : 90;
  const period = threshold <= 14
    ? new Date().toISOString().slice(0, 10) // daily key for urgent alerts
    : `${new Date().getFullYear()}-W${Math.ceil(new Date().getDate() / 7)}-M${new Date().getMonth()}`; // monthly bucket for early notice
  return `cert:${certId}:${threshold}:${period}`;
}

// ─── Filing status change alert templates ─────────────────────────────────────

function buildFilingStatusEmail({ user, filing, status }) {
  const statusConfig = {
    submitted: { badge: '📋 SUBMITTED',   color: '#22d3ee', title: 'Filing Submitted',        action: 'Your VUMPA filing has been received by CanalClear and is awaiting review by the ACP portal.' },
    approved:  { badge: '✅ APPROVED',     color: '#00d4aa', title: 'Filing Approved',          action: 'Your VUMPA filing has been approved. Your vessel is cleared for Panama Canal transit.' },
    rejected:  { badge: '❌ REJECTED',     color: '#ef4444', title: 'Filing Requires Revision', action: 'Your VUMPA filing was rejected or requires revision. Please review the filing and resubmit with the required corrections.' },
    needs_revision: { badge: '⚠️ REVISION NEEDED', color: '#eab308', title: 'Revision Required', action: 'Your VUMPA filing needs revision before approval. Log in to review and update the filing.' },
  };

  const cfg = statusConfig[status] || statusConfig.submitted;
  const vessel = filing.vessel_name ? `MV ${filing.vessel_name}` : 'Your vessel';
  const refText = filing.reference_number ? ` (Ref: ${filing.reference_number})` : '';

  const content = `
    <div style="display:inline-block;background:${cfg.color}22;border:1px solid ${cfg.color}44;border-radius:8px;padding:6px 14px;margin-bottom:20px;">
      <span style="color:${cfg.color};font-size:13px;font-weight:600;">${cfg.badge}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      ${cfg.title}
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">${vessel}${refText}</p>

    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 6px;font-size:14px;color:#64748b;">Status</p>
      <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:${cfg.color};">${cfg.badge}</p>
      <p style="margin:0;font-size:14px;color:#94a3b8;line-height:1.6;">${cfg.action}</p>
    </div>

    <a href="https://canalclear.org/filing"
       style="display:inline-block;background:#00d4aa;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">
      View Filing Wizard →
    </a>
  `;

  return emailWrapper(content, {
    preheader: `${cfg.badge}: VUMPA filing status update for ${vessel}`,
  });
}

// ─── Filing status alerts ─────────────────────────────────────────────────────

/**
 * Checks for recently-changed filing statuses and sends notifications.
 * Looks back 25 hours to catch filings updated since the last run.
 */
async function checkFilingStatusAlerts(pool) {
  // Check if filings table exists
  const filingsExist = await checkFilingsTableExists(pool);
  if (!filingsExist) return;

  // Fetch filings with notable status changes in the last 25h
  const filings = await getRecentFilingStatusChanges(pool);

  for (const filing of filings) {
    const alertKey = `filing:${filing.id}:${filing.status}`;

    const recipients = [filing.user_email];
    if (filing.additional_emails && filing.additional_emails.length) {
      filing.additional_emails.forEach(e => {
        if (e && !recipients.includes(e)) recipients.push(e);
      });
    }

    for (const recipient of recipients) {
      // Dedup check
      const alreadySent = await checkAlertSent(pool, alertKey, recipient);
      if (alreadySent) continue;

      const statusConfig = {
        submitted: 'SUBMITTED',
        approved:  'APPROVED ✅',
        rejected:  'REJECTED ❌',
        needs_revision: 'REVISION NEEDED ⚠️',
      };
      const statusLabel = statusConfig[filing.status] || filing.status.toUpperCase();
      const vessel = filing.vessel_name ? `MV ${filing.vessel_name}` : 'Your vessel';
      const subject = `[CanalClear] Filing ${statusLabel} — ${vessel}`;

      const html = buildFilingStatusEmail({
        user: { email: filing.user_email, name: filing.user_name },
        filing,
        status: filing.status,
      });

      const sent = await sendEmail({ to: recipient, subject, html });

      if (sent) {
        try {
          await insertAlert(pool, {
            user_id: filing.user_id,
            alert_key: alertKey,
            alert_category: 'filing',
            recipient_email: recipient,
            subject,
            metadata: { filing_id: filing.id, status: filing.status },
          });
        } catch (dbErr) {
          console.error('[Alerts] Filing history insert error:', dbErr.message);
        }
      }
    }
  }
}

// ─── Main alert runner ────────────────────────────────────────────────────────

/**
 * Runs all alert checks. Called once daily from server.js.
 * @param {Pool} pool - pg Pool
 */
async function runAlertChecks(pool) {
  console.log('[Alerts] Starting daily alert check...');

  try {
    await checkCertificateAlerts(pool);
    console.log('[Alerts] Certificate alerts done.');
  } catch (err) {
    console.error('[Alerts] Certificate check error:', err.message);
  }

  try {
    await checkDailyDigests(pool);
    console.log('[Alerts] Daily digests done.');
  } catch (err) {
    console.error('[Alerts] Daily digest error:', err.message);
  }

  try {
    await checkFilingStatusAlerts(pool);
    console.log('[Alerts] Filing status alerts done.');
  } catch (err) {
    console.error('[Alerts] Filing status check error:', err.message);
  }

  try {
    await checkIspsNotificationAlerts(pool);
    console.log('[Alerts] Suez ISPS notification alerts done.');
  } catch (err) {
    console.error('[Alerts] Suez ISPS notification alert error:', err.message);
  }

  console.log('[Alerts] Daily alert check complete.');
}

async function checkCertificateAlerts(pool) {
  // Fetch all non-expired certificates with vessel + user info
  // Only for users with cert alerts enabled
  const certs = await getCertificatesNearExpiry(pool);

  for (const cert of certs) {
    const expiryDate = new Date(cert.expiry_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((expiryDate - today) / (1000 * 60 * 60 * 24));

    // Default lead times if user hasn't customized
    const leadTimes = cert.lead_times || [30, 14, 7, 0];

    // Only fire if today's daysLeft matches a threshold or is in the expiry window
    const relevantThreshold = leadTimes.find(t => daysLeft === t || (t === 0 && daysLeft <= 0));
    if (relevantThreshold === undefined) continue;

    // Determine recipients
    const recipients = [cert.user_email];
    if (cert.additional_emails && cert.additional_emails.length) {
      cert.additional_emails.forEach(e => {
        if (e && !recipients.includes(e)) recipients.push(e);
      });
    }

    const vessel = { name: cert.vessel_name, imo: cert.vessel_imo, flag: cert.vessel_flag };
    const certInfo = { cert_type: cert.cert_type, cert_number: cert.cert_number, expiry_date: cert.expiry_date };

    for (const recipient of recipients) {
      const key = certAlertKey(cert.cert_id, daysLeft);

      // Dedup check
      const alreadySent = await checkAlertSent(pool, key, recipient);
      if (alreadySent) continue; // already sent

      const certLabel = CERT_TYPE_LABELS[cert.cert_type] || cert.cert_type;
      const subjectPrefix = daysLeft <= 0 ? '🚨 EXPIRED'
        : daysLeft <= 7 ? '🔴 URGENT'
        : daysLeft <= 30 ? '⚠️ Warning'
        : 'ℹ️ Notice';
      const subject = `[CanalClear] ${subjectPrefix}: ${certLabel} ${daysLeft <= 0 ? 'has expired' : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`} — MV ${cert.vessel_name}`;

      const html = buildCertExpiryEmail({ vessel, cert: certInfo, daysLeft });
      const sent = await sendEmail({ to: recipient, subject, html });

      // Record in history (even on failed send, to avoid retrying bad emails)
      if (sent) {
        try {
          await insertAlert(pool, {
            user_id: cert.user_id,
            alert_key: key,
            alert_category: 'certificate',
            recipient_email: recipient,
            subject,
            metadata: { cert_id: cert.cert_id, days_left: daysLeft },
          });
        } catch (dbErr) {
          console.error('[Alerts] History insert error:', dbErr.message);
        }
      }
    }
  }
}

// ─── Daily Digest ─────────────────────────────────────────────────────────────

/**
 * Build a digest email covering all upcoming certificate expirations for a user.
 */
function buildDigestEmail({ userName, certs, vessels }) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Group by urgency
  const expired   = certs.filter(c => c.days_left <= 0);
  const urgent    = certs.filter(c => c.days_left > 0 && c.days_left <= 7);
  const warning   = certs.filter(c => c.days_left > 7 && c.days_left <= 30);
  const upcoming  = certs.filter(c => c.days_left > 30 && c.days_left <= 90);

  const allActionable = [...expired, ...urgent, ...warning, ...upcoming];
  if (!allActionable.length) return null;

  function certRow(c, bg, color) {
    const certLabel = CERT_TYPE_LABELS[c.cert_type] || c.cert_type;
    const dayText = c.days_left <= 0 ? `<strong style="color:#ef4444;">EXPIRED ${Math.abs(c.days_left)}d ago</strong>`
      : `<strong style="color:${color};">${c.days_left}d left</strong>`;
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
        <td style="padding:10px 8px;font-size:13px;color:#f1f5f9;font-weight:500;">${certLabel}</td>
        <td style="padding:10px 8px;font-size:13px;color:#94a3b8;">${c.vessel_name || '—'}</td>
        <td style="padding:10px 8px;font-size:12px;text-align:right;">${dayText}</td>
      </tr>`;
  }

  let tableRows = '';
  expired.forEach(c => { tableRows += certRow(c, '#ef444433', '#ef4444'); });
  urgent.forEach(c => { tableRows += certRow(c, '#f9731633', '#f97316'); });
  warning.forEach(c => { tableRows += certRow(c, '#eab30833', '#eab308'); });
  upcoming.forEach(c => { tableRows += certRow(c, '#22d3ee33', '#22d3ee'); });

  const summaryParts = [];
  if (expired.length) summaryParts.push(`<strong style="color:#ef4444;">${expired.length} expired</strong>`);
  if (urgent.length) summaryParts.push(`<strong style="color:#f97316;">${urgent.length} urgent (≤7d)</strong>`);
  if (warning.length) summaryParts.push(`<strong style="color:#eab308;">${warning.length} expiring soon (≤30d)</strong>`);
  if (upcoming.length) summaryParts.push(`<strong style="color:#22d3ee;">${upcoming.length} upcoming (≤90d)</strong>`);

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      Daily Certificate Digest
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">
      Hi ${userName || 'there'} — here's your fleet compliance summary for today.
    </p>

    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px 16px;margin-bottom:8px;font-size:14px;color:#cbd5e1;line-height:2;">
      ${summaryParts.join(' &bull; ')}
    </div>

    <table width="100%" cellpadding="0" cellspacing="0"
           style="border-collapse:collapse;background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;margin-bottom:24px;">
      <thead>
        <tr style="background:rgba(0,0,0,0.3);">
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Certificate</th>
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Vessel</th>
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:right;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <a href="https://canalclear.org/dashboard"
       style="display:inline-block;background:#00d4aa;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">
      View Fleet Dashboard →
    </a>
  `;

  return emailWrapper(content, {
    preheader: `Fleet digest: ${summaryParts.map(p => p.replace(/<[^>]+>/g, '')).join(' · ')}`,
  });
}

/**
 * Sends daily digest emails for users who have opted for digest frequency.
 */
async function checkDailyDigests(pool) {
  // Fetch all users with digest mode and at least one cert in the alert window
  const userCerts = await getDailyDigestCerts(pool);

  if (!userCerts.length) return;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Group by user
  const byUser = {};
  for (const c of userCerts) {
    if (!byUser[c.user_id]) byUser[c.user_id] = { email: c.user_email, name: c.user_name, additional_emails: c.additional_emails, certs: [] };
    const expiryDate = new Date(c.expiry_date);
    expiryDate.setHours(0, 0, 0, 0);
    byUser[c.user_id].certs.push({ ...c, days_left: Math.round((expiryDate - now) / (1000 * 60 * 60 * 24)) });
  }

  const today = now.toISOString().slice(0, 10);

  for (const [userId, userData] of Object.entries(byUser)) {
    const digestKey = `digest:${userId}:${today}`;
    const recipients = [userData.email, ...(userData.additional_emails || [])].filter(Boolean);

    for (const recipient of recipients) {
      // Dedup check
      const alreadySent = await checkAlertSent(pool, digestKey, recipient);
      if (alreadySent) continue;

      const html = buildDigestEmail({ userName: userData.name, certs: userData.certs });
      if (!html) continue;

      const actionableCerts = userData.certs.filter(c => c.days_left <= 90);
      const subject = `[CanalClear] Daily Fleet Digest — ${actionableCerts.length} certificate${actionableCerts.length === 1 ? '' : 's'} need attention`;
      const sent = await sendEmail({ to: recipient, subject, html });

      if (sent) {
        try {
          await insertAlert(pool, {
            user_id: userId,
            alert_key: digestKey,
            alert_category: 'digest',
            recipient_email: recipient,
            subject,
            metadata: { cert_count: actionableCerts.length },
          });
        } catch (dbErr) {
          console.error('[Alerts] Digest history insert error:', dbErr.message);
        }
      }
    }
  }
}

// ─── Suez ISPS Pre-Arrival Notification Alerts ────────────────────────────────

const FALLBACK_EMAIL = 'eagleconsulting954@gmail.com';

/**
 * Build the HTML email for an approaching ISPS notification deadline (6h warning).
 */
function buildIspsApproachingEmail({ userName, vesselName, imoNumber, stage, deadline, hoursLeft, filingId }) {
  const stageLabels = {
    '72h': 'Initial 72-Hour Security Notification',
    '48h': '48-Hour Updated Notification',
    '24h': '24-Hour Final Confirmation',
  };
  const stageLabel = stageLabels[stage] || `${stage} Notification`;
  const deadlineStr = new Date(deadline).toUTCString();

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      ⏰ ISPS Deadline Approaching — ${stage} Notification
    </h2>
    <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
      Hi ${userName || 'there'}, your <strong style="color:#ffd93d;">${stageLabel}</strong>
      for <strong style="color:#f1f5f9;">MV ${vesselName}</strong> (IMO: ${imoNumber})
      is due in approximately <strong style="color:#ffd93d;">${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}</strong>.
    </p>

    <div style="background:#2a2000;border:1px solid rgba(255,217,61,.3);border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:13px;color:#ffd93d;font-weight:700;margin-bottom:6px;">⚠️ DEADLINE</div>
      <div style="font-size:16px;color:#f1f5f9;font-weight:700;">${deadlineStr}</div>
    </div>

    <p style="font-size:14px;color:#94a3b8;margin:0 0 16px;">
      The Suez Canal Authority (SCA) requires this notification to be submitted before the deadline.
      Failure to submit on time may result in transit delays or additional SCA fees.
    </p>

    <a href="https://canalclear.org/suez/notifications?filing=${filingId}"
       style="display:inline-block;background:#ffd93d;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;margin-bottom:16px;">
      Submit ${stage} Notification Now →
    </a>

    <p style="font-size:12px;color:#64748b;margin:0;">
      You are receiving this alert because you have an active Suez filing with CanalClear.
    </p>
  `;

  return emailWrapper(content, {
    preheader: `⏰ ${stage} ISPS notification for MV ${vesselName} due in ${hoursLeft}h`,
  });
}

/**
 * Build the HTML email for an overdue ISPS notification.
 */
function buildIspsOverdueEmail({ userName, vesselName, imoNumber, stage, deadline, hoursOverdue, filingId }) {
  const stageLabels = {
    '72h': 'Initial 72-Hour Security Notification',
    '48h': '48-Hour Updated Notification',
    '24h': '24-Hour Final Confirmation',
  };
  const stageLabel = stageLabels[stage] || `${stage} Notification`;
  const deadlineStr = new Date(deadline).toUTCString();

  const content = `
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#ff6b6b;line-height:1.3;">
      🚨 OVERDUE: ISPS ${stage} Notification Not Sent
    </h2>
    <p style="margin:0 0 20px;font-size:15px;color:#94a3b8;">
      Hi ${userName || 'there'}, the <strong style="color:#ff6b6b;">${stageLabel}</strong>
      for <strong style="color:#f1f5f9;">MV ${vesselName}</strong> (IMO: ${imoNumber})
      was due <strong style="color:#ff6b6b;">${hoursOverdue} hour${hoursOverdue === 1 ? '' : 's'} ago</strong>.
    </p>

    <div style="background:#2a0000;border:1px solid rgba(255,107,107,.3);border-radius:10px;padding:16px 20px;margin-bottom:20px;">
      <div style="font-size:13px;color:#ff6b6b;font-weight:700;margin-bottom:6px;">🚨 MISSED DEADLINE</div>
      <div style="font-size:16px;color:#f1f5f9;font-weight:700;">${deadlineStr}</div>
      <div style="font-size:13px;color:#94a3b8;margin-top:4px;">
        Overdue by ${hoursOverdue} hour${hoursOverdue === 1 ? '' : 's'}
      </div>
    </div>

    <p style="font-size:14px;color:#94a3b8;margin:0 0 16px;">
      <strong style="color:#f1f5f9;">Act immediately:</strong> Contact your SCA agent and submit the notification
      as soon as possible. Overdue notifications may result in transit delays, port state control action,
      or additional SCA fees.
    </p>

    <a href="https://canalclear.org/suez/notifications?filing=${filingId}"
       style="display:inline-block;background:#ff6b6b;color:#fff;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;margin-bottom:16px;">
      Submit Overdue Notification →
    </a>

    <p style="font-size:12px;color:#64748b;margin:0;">
      If you have already submitted this notification via your SCA agent, please mark it as sent
      in CanalClear to stop these alerts.
    </p>
  `;

  return emailWrapper(content, {
    preheader: `🚨 OVERDUE: ${stage} ISPS notification for MV ${vesselName} — ${hoursOverdue}h past deadline`,
  });
}

/**
 * Check all pending Suez ISPS notifications and send:
 *   - 6h approaching alerts (fires once per stage, via alert_6h_sent flag)
 *   - Overdue alerts (fires once per stage, via alert_overdue_sent flag)
 *
 * Sends to the filing owner + fallback eagleconsulting954@gmail.com if no valid email.
 * This runs as part of the alert scheduler (called from runAlertChecks).
 */
async function checkIspsNotificationAlerts(pool) {
  const now = new Date();

  // Fetch all pending/unsent ISPS notifications that have deadlines set
  const notifs = await getPendingIspsNotifications(pool);

  if (!notifs.length) {
    console.log('[ISPS Alerts] No pending notifications to check.');
    return;
  }

  const THRESHOLD_6H = 6 * 60 * 60 * 1000; // 6 hours in ms

  for (const notif of notifs) {
    const stage = notif.notification_type; // '72h' | '48h' | '24h'
    const deadlineKey = `deadline_${stage.replace('h', '')}h`;
    const deadline = notif[deadlineKey] ? new Date(notif[deadlineKey]) : null;

    if (!deadline) continue;

    const msToDeadline = deadline - now;
    const hoursLeft = Math.round(msToDeadline / (60 * 60 * 1000));

    const isOverdue   = msToDeadline < 0;
    const isApproaching = !isOverdue && msToDeadline <= THRESHOLD_6H;

    const recipient = notif.user_email || FALLBACK_EMAIL;

    // ── 6h approaching alert ───────────────────────────────────────────────
    if (isApproaching && !notif.alert_6h_sent) {
      const subject = `[CanalClear] ⏰ ISPS ${stage} Deadline in ${hoursLeft}h — MV ${notif.vessel_name}`;
      const html = buildIspsApproachingEmail({
        userName:   notif.user_name,
        vesselName: notif.vessel_name,
        imoNumber:  notif.imo_number,
        stage,
        deadline:   deadline.toISOString(),
        hoursLeft:  Math.max(hoursLeft, 0),
        filingId:   notif.filing_id,
      });

      const sent = await sendEmail({ to: recipient, subject, html });

      // Also send to fallback if user email differs
      if (recipient !== FALLBACK_EMAIL) {
        await sendEmail({ to: FALLBACK_EMAIL, subject: `[Fallback] ${subject}`, html }).catch(() => {});
      }

      if (sent) {
        try {
          await markIspsAlert6hSent(pool, notif.id);
          console.log(`[ISPS Alerts] 6h alert sent for filing ${notif.filing_id} stage ${stage}`);
        } catch (dbErr) {
          console.error('[ISPS Alerts] DB update error (6h):', dbErr.message);
        }
      }
    }

    // ── Overdue alert ──────────────────────────────────────────────────────
    if (isOverdue && !notif.alert_overdue_sent) {
      const hoursOverdue = Math.abs(hoursLeft);
      const subject = `[CanalClear] 🚨 OVERDUE: ISPS ${stage} Notification — MV ${notif.vessel_name}`;
      const html = buildIspsOverdueEmail({
        userName:    notif.user_name,
        vesselName:  notif.vessel_name,
        imoNumber:   notif.imo_number,
        stage,
        deadline:    deadline.toISOString(),
        hoursOverdue,
        filingId:    notif.filing_id,
      });

      const sent = await sendEmail({ to: recipient, subject, html });

      // Always send overdue to fallback
      await sendEmail({ to: FALLBACK_EMAIL, subject: `[ISPS OVERDUE] ${subject}`, html }).catch(() => {});

      if (sent) {
        try {
          await markIspsAlertOverdueSent(pool, notif.id);
          console.log(`[ISPS Alerts] Overdue alert sent for filing ${notif.filing_id} stage ${stage}`);
        } catch (dbErr) {
          console.error('[ISPS Alerts] DB update error (overdue):', dbErr.message);
        }
      }
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  runAlertChecks,
  sendEmail,
  emailWrapper,
  buildCertExpiryEmail,
  buildFilingReminderEmail,
  buildFilingStatusEmail,
  buildDigestEmail,
  buildIspsApproachingEmail,
  buildIspsOverdueEmail,
  checkIspsNotificationAlerts,
  CERT_TYPE_LABELS,
};
