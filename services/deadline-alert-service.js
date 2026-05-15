/**
 * services/deadline-alert-service.js — 5-waterway deadline email alerts.
 * Owns: scanning upcoming deadlines, sending alert emails, dedup via deadline_alert_log.
 * Does NOT own: deadline creation (done by filing routes), email infrastructure, user prefs storage.
 *
 * Runs every 30 minutes. Alert windows per waterway:
 *   Panama:   48h, 24h, 6h
 *   Suez:     72h, 48h, 24h
 *   Bosporus: 48h, 24h, 6h  (dangerous cargo: 48h)
 *   Malacca:  24h, 12h, 6h
 *   Cape:     96h, 48h, 24h
 */
'use strict';

const { sendEmail, emailWrapper } = require('./alert-service');
const {
  getUpcomingDeadlines,
  hasAlertBeenSent,
  recordAlertSent,
  getUserWaterwayPrefs,
  defaultWindowsFor,
} = require('../db/filing-deadlines');

// ─── Waterway metadata ────────────────────────────────────────────────────────

const WATERWAY_META = {
  panama:   { label: 'Panama Canal',    authority: 'ACP',   filing: 'VUMPA' },
  suez:     { label: 'Suez Canal',      authority: 'SCA',   filing: 'SCA Convoy Booking' },
  bosporus: { label: 'Bosporus/Turkish Straits', authority: 'TBMMK', filing: 'SP-1' },
  malacca:  { label: 'Strait of Malacca', authority: 'VTIS', filing: 'STRAITREP' },
  cape:     { label: 'Cape of Good Hope', authority: 'SAMSA', filing: 'ISPS Pre-Arrival' },
};

// ─── Window thresholds in hours ───────────────────────────────────────────────

const WINDOW_HOURS = {
  '96h': 96, '72h': 72, '48h': 48, '24h': 24, '12h': 12, '6h': 6,
};

// ─── Email template ───────────────────────────────────────────────────────────

function buildDeadlineAlertEmail({ waterway, filingType, vesselName, imoNumber, deadlineAt, hoursLeft, alertWindow, complianceIssues, filingUrl, userName }) {
  const meta = WATERWAY_META[waterway] || { label: waterway, authority: '', filing: filingType };

  const isUrgent = hoursLeft <= 12;
  const isCritical = hoursLeft <= 6;
  const urgencyColor = isCritical ? '#ef4444' : isUrgent ? '#f97316' : '#eab308';
  const badge = isCritical ? '🚨 CRITICAL' : isUrgent ? '🔴 URGENT' : '⚠️ ACTION NEEDED';

  const deadlineStr = new Date(deadlineAt).toUTCString();
  const issuesList = Array.isArray(complianceIssues) && complianceIssues.length
    ? `<ul style="margin:8px 0 0;padding:0 0 0 18px;color:#94a3b8;font-size:13px;line-height:1.8;">
        ${complianceIssues.slice(0, 5).map(i => `<li>${i}</li>`).join('')}
      </ul>`
    : '';

  const ctaUrl = filingUrl || 'https://canal-clear.polsia.app/app';

  const content = `
    <div style="display:inline-block;background:${urgencyColor}22;border:1px solid ${urgencyColor}44;border-radius:8px;padding:6px 14px;margin-bottom:20px;">
      <span style="color:${urgencyColor};font-size:13px;font-weight:600;">${badge}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f1f5f9;line-height:1.3;">
      ${meta.filing} filing due in ${hoursLeft}h
    </h2>
    <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">
      Hi ${userName || 'there'} — MV <strong style="color:#f1f5f9;">${vesselName}</strong>${imoNumber ? ` (IMO: ${imoNumber})` : ''} has an upcoming ${meta.label} deadline.
    </p>

    <div style="background:#0f172a;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:20px;margin-bottom:16px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#64748b;width:120px;">Waterway</td>
          <td style="padding:4px 0;font-size:14px;color:#f1f5f9;font-weight:600;">${meta.label}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#64748b;">Filing Type</td>
          <td style="padding:4px 0;font-size:14px;color:#f1f5f9;">${meta.filing}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#64748b;">Vessel</td>
          <td style="padding:4px 0;font-size:14px;color:#f1f5f9;">MV ${vesselName}${imoNumber ? ` — IMO ${imoNumber}` : ''}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#64748b;">Deadline</td>
          <td style="padding:4px 0;font-size:14px;color:${urgencyColor};font-weight:700;">${deadlineStr}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#64748b;">Time Left</td>
          <td style="padding:4px 0;font-size:14px;color:${urgencyColor};font-weight:700;">~${hoursLeft} hours</td>
        </tr>
      </table>
    </div>

    ${issuesList ? `
    <div style="background:#1e1a00;border:1px solid rgba(234,179,8,0.3);border-radius:10px;padding:16px 20px;margin-bottom:16px;">
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#eab308;text-transform:uppercase;letter-spacing:0.5px;">Compliance Issues</p>
      ${issuesList}
    </div>` : ''}

    <p style="font-size:14px;color:#94a3b8;margin:0 0 20px;line-height:1.6;">
      The ${meta.authority} requires this filing to be submitted before the deadline.
      Failure to comply may result in transit delays or financial penalties.
    </p>

    <a href="${ctaUrl}"
       style="display:inline-block;background:#00d4aa;color:#0f172a;text-decoration:none;
              font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;">
      Complete Filing Now →
    </a>

    <p style="margin:20px 0 0;font-size:12px;color:#475569;line-height:1.6;">
      Manage alert preferences at
      <a href="https://canal-clear.polsia.app/settings/alerts" style="color:#00d4aa;text-decoration:none;">Settings → Alerts</a>.
    </p>
  `;

  return emailWrapper(content, {
    preheader: `${badge}: ${meta.filing} for MV ${vesselName} due in ~${hoursLeft}h — ${meta.label}`,
  });
}

// ─── Alert window logic ───────────────────────────────────────────────────────

/**
 * Given hours remaining until deadline, return which alert window label applies.
 * Returns null if no window matches (i.e., we're between windows or past them all).
 *
 * A window "fires" when hoursLeft drops into its band:
 *   96h window fires at 85h–103h remaining (±9h tolerance)
 *   72h window fires at 63h–79h remaining
 *   48h window fires at 40h–56h remaining
 *   24h window fires at 18h–30h remaining
 *   12h window fires at 6h–18h remaining
 *    6h window fires at 0h–10h remaining
 *
 * The ±tolerance prevents missed alerts from drift in a 30-minute scheduler.
 */
function matchAlertWindow(hoursLeft, enabledWindows) {
  const BANDS = {
    '96h': [85, 103],
    '72h': [63, 79],
    '48h': [40, 56],
    '24h': [18, 30],
    '12h': [6, 18],
    '6h':  [0, 10],
  };

  for (const window of enabledWindows) {
    const band = BANDS[window];
    if (band && hoursLeft >= band[0] && hoursLeft <= band[1]) {
      return window;
    }
  }
  return null;
}

// ─── Main check runner ────────────────────────────────────────────────────────

/**
 * Scans all upcoming deadlines within 110h and fires alerts for any
 * matching window not yet sent. Called every 30 minutes from the scheduler.
 */
async function checkDeadlineAlerts(pool) {
  console.log('[DeadlineAlerts] Running check...');
  let sent = 0;
  let skipped = 0;

  let deadlines;
  try {
    deadlines = await getUpcomingDeadlines(pool, 110);
  } catch (err) {
    // Tables may not exist yet on first boot — silently skip
    if (err.message && err.message.includes('does not exist')) {
      console.log('[DeadlineAlerts] Tables not yet created — skipping.');
      return;
    }
    throw err;
  }

  if (!deadlines.length) {
    console.log('[DeadlineAlerts] No upcoming deadlines found.');
    return;
  }

  const now = Date.now();

  for (const deadline of deadlines) {
    const msLeft = new Date(deadline.deadline_at) - now;
    if (msLeft <= 0) continue; // already past deadline

    const hoursLeft = Math.round(msLeft / (60 * 60 * 1000));

    // Get user's preferences for this waterway
    let prefs;
    try {
      prefs = await getUserWaterwayPrefs(pool, deadline.user_id, deadline.waterway);
    } catch (_) {
      prefs = { enabled: true, alert_windows: defaultWindowsFor(deadline.waterway) };
    }

    if (!prefs.enabled) { skipped++; continue; }

    const alertWindow = matchAlertWindow(hoursLeft, prefs.alert_windows);
    if (!alertWindow) { skipped++; continue; }

    const recipient = deadline.user_email;
    if (!recipient) { skipped++; continue; }

    // Dedup check
    let alreadySent = false;
    try {
      alreadySent = await hasAlertBeenSent(pool, deadline.id, recipient, alertWindow);
    } catch (_) { /* table missing, treat as not sent */ }

    if (alreadySent) { skipped++; continue; }

    const meta = WATERWAY_META[deadline.waterway] || { label: deadline.waterway, filing: deadline.filing_type };
    const subject = `⚠ ${deadline.vessel_name} — ${meta.label} ${meta.filing} due in ${hoursLeft}h`;

    let complianceIssues = [];
    try {
      complianceIssues = JSON.parse(deadline.compliance_issues || '[]');
    } catch (_) { complianceIssues = []; }

    const html = buildDeadlineAlertEmail({
      waterway:         deadline.waterway,
      filingType:       deadline.filing_type,
      vesselName:       deadline.vessel_name,
      imoNumber:        deadline.imo_number,
      deadlineAt:       deadline.deadline_at,
      hoursLeft,
      alertWindow,
      complianceIssues,
      filingUrl:        deadline.filing_url,
      userName:         deadline.user_name,
    });

    const ok = await sendEmail({ to: recipient, subject, html });

    if (ok) {
      try {
        await recordAlertSent(pool, {
          deadlineId:  deadline.id,
          userId:      deadline.user_id,
          recipient,
          alertWindow,
          subject,
        });
      } catch (_) {}
      sent++;
      console.log(`[DeadlineAlerts] Sent ${alertWindow} alert → ${recipient} | ${deadline.waterway} | MV ${deadline.vessel_name}`);
    }
  }

  console.log(`[DeadlineAlerts] Done — ${sent} sent, ${skipped} skipped.`);
}

module.exports = { checkDeadlineAlerts, buildDeadlineAlertEmail, matchAlertWindow };
