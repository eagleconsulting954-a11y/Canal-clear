/**
 * admin-suez.js — Suez Monitor tab logic for /admin
 * Extracted from admin.html for maintainability.
 * Depends on: esc(), statCard(), filingBadge(), fmtDate() (defined in admin.html inline script)
 */

/* ── ISPS stage badge helper ──────────────────────────────────────────────── */
function ispsStageBadges(stages) {
  if (!stages || (Array.isArray(stages) && stages.length === 0)) {
    return '<span style="color:var(--gray);font-size:0.75rem;">—</span>';
  }
  const arr = Array.isArray(stages)
    ? stages
    : String(stages).replace(/[{}"]/g, '').split(',').filter(Boolean);
  return arr.map(s => {
    const color = s === '72h' ? '#A78BFA' : s === '48h' ? '#00D4AA' : s === '24h' ? '#FFD93D' : '#8899AA';
    return `<span style="background:${color}22;border:1px solid ${color}44;border-radius:6px;padding:1px 6px;font-size:0.7rem;color:${color};font-weight:600;">${s}</span>`;
  }).join(' ');
}

/* ── Stats row ────────────────────────────────────────────────────────────── */
async function loadSuezStats() {
  const grid = document.getElementById('suez-stats-grid');
  grid.innerHTML = '<div class="loading"><span class="spinner"></span> Loading...</div>';
  try {
    const res = await fetch('/api/admin/suez/stats', { credentials: 'include' }).then(r => r.json());
    if (!res.success) { grid.innerHTML = '<div style="color:var(--red);padding:1rem;">Failed to load Suez stats</div>'; return; }
    const { filings, validation, submissions } = res;
    const passRate = validation.pass_rate != null ? `${validation.pass_rate}%` : '—';
    grid.innerHTML = `
      ${statCard('🇪🇬 Suez Filings', filings.suez_total, '<span>' + filings.suez_month + '</span> this month · <span>' + filings.suez_week + '</span> this week')}
      ${statCard('🇵🇦 Panama Filings', filings.panama_total, '<span>' + filings.panama_month + '</span> this month')}
      ${statCard('Suez Submitted', filings.suez_submitted, filings.suez_draft + ' draft · ' + filings.suez_approved + ' approved · ' + filings.suez_rejected + ' rejected')}
      ${statCard('Suez Val. Pass Rate', passRate, '<span>' + validation.pass + '</span> pass / ' + validation.total + ' total')}
      ${statCard('SCA Submissions', submissions.total_submissions, '<span>' + submissions.unique_users + '</span> unique users · <span>' + submissions.unique_convoys + '</span> convoys')}
    `;
    if (res.common_errors && res.common_errors.length) {
      const rows = res.common_errors.map(e =>
        '<tr>' +
          '<td class="cell-mono">' + esc(e.rule_key || '—') + '</td>' +
          '<td>' + esc(e.check_name || '—') + '</td>' +
          '<td><span style="color:var(--red);font-weight:700;">' + e.fail_count + '</span></td>' +
        '</tr>'
      ).join('');
      grid.insertAdjacentHTML('afterend',
        '<div class="panel" style="margin-top:1.5rem;margin-bottom:0;">' +
          '<div class="panel-header"><span class="panel-title">🔴 Most Common Suez Validation Errors</span></div>' +
          '<div class="table-wrap"><table><thead><tr><th>Rule</th><th>Check Name</th><th>Fail Count</th></tr></thead>' +
          '<tbody>' + rows + '</tbody></table></div></div>'
      );
    }
  } catch (err) {
    grid.innerHTML = '<div style="color:var(--red);padding:1rem;">Error: ' + esc(err.message) + '</div>';
  }
}

/* ── Overdue ISPS alerts ──────────────────────────────────────────────────── */
async function loadOverdueAlerts() {
  const tbody = document.getElementById('suez-overdue-tbody');
  const countEl = document.getElementById('suez-overdue-count');
  const panel = document.getElementById('suez-overdue-panel');
  try {
    const res = await fetch('/api/admin/suez/overdue-alerts', { credentials: 'include' }).then(r => r.json());
    if (!res.success) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--red);padding:1rem;">Error loading alerts</td></tr>'; return; }
    countEl.textContent = res.overdue_count;
    if (res.overdue_notifications.length === 0) {
      panel.style.display = 'none';
    } else {
      panel.style.display = '';
      tbody.innerHTML = res.overdue_notifications.map(n =>
        '<tr>' +
          '<td class="cell-primary">' + esc(n.vessel_name || '—') + '</td>' +
          '<td class="cell-mono">' + esc(n.imo_number || '—') + '</td>' +
          '<td>' + ispsStageBadges([n.notification_type]) + '</td>' +
          '<td><span style="background:var(--red-dim);color:var(--red);border-radius:6px;padding:2px 8px;font-size:0.72rem;font-weight:600;">' + esc(n.status) + '</span></td>' +
          '<td>' + esc(n.user_email) + '</td>' +
          '<td class="cell-mono" style="color:var(--red);">' + fmtDate(n.created_at) + '</td>' +
        '</tr>'
      ).join('');
      const badge = document.getElementById('suez-overdue-badge');
      if (badge) { badge.textContent = res.overdue_count; badge.style.display = 'inline'; }
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--red);padding:1rem;">Error: ' + esc(err.message) + '</td></tr>';
  }
}

/* ── ISPS notification timeline ──────────────────────────────────────────── */
async function loadIspsTimeline() {
  const tbody = document.getElementById('suez-isps-tbody');
  try {
    const res = await fetch('/api/admin/suez/isps-timeline', { credentials: 'include' }).then(r => r.json());
    if (!res.success) { tbody.innerHTML = '<tr><td colspan="9" style="color:var(--red);padding:1rem;">Error loading timeline</td></tr>'; return; }
    if (res.filings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><p>No Suez filings yet</p></td></tr>';
      return;
    }
    const needed = ['72h', '48h', '24h'];
    tbody.innerHTML = res.filings.map(f => {
      const stages = Array.isArray(f.stages_sent) ? f.stages_sent : [];
      const stagePips = needed.map(s => {
        const done = stages.includes(s);
        const color = done ? (s === '72h' ? '#A78BFA' : s === '48h' ? '#00D4AA' : '#FFD93D') : '#1E3350';
        const border = done ? color : 'rgba(255,255,255,0.1)';
        return '<span style="display:inline-block;background:' + color + '22;border:1px solid ' + border + ';border-radius:6px;padding:1px 6px;font-size:0.7rem;color:' + (done ? color : 'rgba(255,255,255,0.3)') + ';font-weight:600;">' + s + '</span>';
      }).join(' ');
      const notifStatusColor = f.latest_notif_status === 'sent' ? 'var(--teal)' : f.latest_notif_status === 'failed' ? 'var(--red)' : 'var(--gray)';
      return '<tr>' +
        '<td class="cell-primary">' + esc(f.vessel_name || '—') + '</td>' +
        '<td class="cell-mono">' + esc(f.imo_number || '—') + '</td>' +
        '<td style="font-size:0.8rem;">' + esc(f.user_email) + '</td>' +
        '<td>' + filingBadge(f.status) + '</td>' +
        '<td>' + stagePips + '</td>' +
        '<td style="text-align:center;color:var(--gray);">' + (f.notif_count || 0) + '</td>' +
        '<td class="cell-mono">' + (f.last_notif_at ? fmtDate(f.last_notif_at) : '—') + '</td>' +
        '<td>' + (f.latest_notif_status ? '<span style="color:' + notifStatusColor + ';font-size:0.75rem;font-weight:600;">' + esc(f.latest_notif_status) + '</span>' : '—') + '</td>' +
        '<td class="cell-mono">' + fmtDate(f.created_at) + '</td>' +
      '</tr>';
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="9" style="color:var(--red);padding:1rem;">Error: ' + esc(err.message) + '</td></tr>';
  }
}

/* ── Convoy booking status ────────────────────────────────────────────────── */
async function loadConvoyStatus() {
  const tbody = document.getElementById('suez-convoy-tbody');
  const countEl = document.getElementById('convoy-count');
  try {
    const res = await fetch('/api/admin/suez/convoy-status', { credentials: 'include' }).then(r => r.json());
    if (!res.success) { tbody.innerHTML = '<tr><td colspan="8" style="color:var(--red);padding:1rem;">Error loading convoy data</td></tr>'; return; }
    countEl.textContent = res.submissions.length + ' total';
    if (res.submissions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><p>No SCA submissions yet</p></td></tr>';
      return;
    }
    const DIR = { first_northbound: '⬆️ 1st NB', second_northbound: '⬆️ 2nd NB', southbound: '⬇️ SB', single: 'Single' };
    tbody.innerHTML = res.submissions.map(s =>
      '<tr>' +
        '<td class="cell-primary">' + esc(s.vessel_name || '—') + '</td>' +
        '<td>' + esc(DIR[s.transit_direction] || s.transit_direction || '—') + '</td>' +
        '<td><span class="cell-mono" style="color:var(--teal);">' + esc(s.convoy_number || '—') + '</span></td>' +
        '<td class="cell-mono">' + esc(s.sca_reference || '—') + '</td>' +
        '<td>' + filingBadge(s.status) + '</td>' +
        '<td style="font-size:0.8rem;">' + esc(s.user_email) + '</td>' +
        '<td class="cell-mono">' + esc(s.filing_ref || '—') + '</td>' +
        '<td class="cell-mono">' + fmtDate(s.submitted_at) + '</td>' +
      '</tr>'
    ).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--red);padding:1rem;">Error: ' + esc(err.message) + '</td></tr>';
  }
}

/* ── Fee audit trail ──────────────────────────────────────────────────────── */
async function loadFeeAudit() {
  const container = document.getElementById('suez-fee-audit-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading fee audit...</div>';
  try {
    const res = await fetch('/api/admin/suez/fee-audit', { credentials: 'include' }).then(r => r.json());
    if (!res.success || !res.fee_audit || res.fee_audit.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><p>No fee calculations recorded yet</p></div>';
      return;
    }
    const rows = res.fee_audit.map(r =>
      '<tr>' +
        '<td class="cell-primary">' + esc(r.vessel_name || '—') + '</td>' +
        '<td class="cell-mono">' + (r.scnt != null ? Number(r.scnt).toLocaleString() : '—') + '</td>' +
        '<td>' + esc(r.vessel_type || '—') + '</td>' +
        '<td style="color:var(--teal);font-weight:600;">' + (r.total_usd != null ? '$' + Number(r.total_usd).toLocaleString() : '—') + '</td>' +
        '<td><span style="font-size:0.75rem;color:var(--yellow);">' + (r.rebate_applied ? esc(r.rebate_applied) : '—') + '</span></td>' +
        '<td style="font-size:0.8rem;">' + esc(r.user_email || '—') + '</td>' +
        '<td class="cell-mono">' + fmtDate(r.calculated_at) + '</td>' +
      '</tr>'
    ).join('');
    container.innerHTML =
      '<table>' +
        '<thead><tr>' +
          '<th>Vessel</th><th>SCNT</th><th>Type</th><th>Est. Toll (USD)</th><th>Rebate</th><th>User</th><th>Calculated</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  } catch (err) {
    container.innerHTML = '<div style="color:var(--red);padding:1rem;">Error: ' + esc(err.message) + '</div>';
  }
}

/* ── Main loader (called by switchTab) ───────────────────────────────────── */
async function loadSuez() {
  await Promise.all([
    loadSuezStats(),
    loadOverdueAlerts(),
    loadIspsTimeline(),
    loadConvoyStatus(),
    loadFeeAudit(),
  ]);
}

/* Backward-compat alias (old inline code used loadSuezMonitor) */
function loadSuezMonitor() { return loadSuez(); }
