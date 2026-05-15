/**
 * CanalClear — Approval Workflow Client
 * Renders side-by-side filing review UI, handles all state transitions via REST API.
 */

(function () {
  'use strict';

  // ── Read URL params ──────────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const filingType = params.get('type');   // sp1 | malacca | cape
  const filingId   = parseInt(params.get('id'), 10);
  const viewMode   = params.get('view');   // 'pending' = show pending list

  // ── Toast helper ──────────────────────────────────────────────────────────────
  const toastEl = document.getElementById('toast');
  let toastTimer;
  function toast(msg, kind = 'info') {
    toastEl.textContent = msg;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, 3500);
  }

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({ success: false, message: 'Parse error' }));
    if (!res.ok && !data.success) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  // ── Workflow labels ─────────────────────────────────────────────────────────
  const STATUS_LABELS = {
    draft:              'Draft',
    submitted:          'Submitted for Review',
    in_review:          'In Review',
    changes_requested:  'Changes Requested',
    approved:           'Approved',
    exported:           'Exported',
    rejected:           'Rejected',
  };

  const AUDIT_LABELS = {
    submitted:          'Submitted for review',
    review_started:     'Review started',
    approved:           'Approved',
    auto_approved:      'Auto-approved',
    changes_requested:  'Changes requested',
    rejected:           'Rejected',
    exported:           'Exported',
    created:            'Created',
  };

  function statusBadge(status) {
    return `<span class="status-badge badge-${status}">${STATUS_LABELS[status] || status}</span>`;
  }

  function auditDotClass(action) {
    const map = {
      approved: 'dot-approved', auto_approved: 'dot-auto_approved',
      submitted: 'dot-submitted', review_started: 'dot-review_started',
      changes_requested: 'dot-changes_requested',
      rejected: 'dot-rejected', exported: 'dot-exported',
    };
    return map[action] || 'dot-default';
  }

  function relTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // ── Field helpers ────────────────────────────────────────────────────────────

  function fieldItem(label, value, fieldKey, commentedFields) {
    const hasComment = commentedFields && commentedFields.has(fieldKey);
    return `
    <div class="field-item${hasComment ? ' has-comment' : ''}" data-field="${fieldKey}"
         onclick="window._awShowCommentModal('${fieldKey}')">
      <div class="field-label">${label}</div>
      <div class="field-value${!value ? ' empty' : ''}">${value || '—'}</div>
    </div>`;
  }

  function renderFilingFields(filing, filingType, commentedFields) {
    // Shared vessel fields
    let html = `
    <div class="section">
      <div class="section-title">Vessel Particulars</div>
      <div class="field-grid">
        ${fieldItem('Vessel Name', filing.vessel_name, 'vessel_name', commentedFields)}
        ${fieldItem('IMO Number', filing.imo_number, 'imo_number', commentedFields)}
        ${fieldItem('Flag State', filing.flag_state, 'flag_state', commentedFields)}
        ${fieldItem('Call Sign', filing.call_sign, 'call_sign', commentedFields)}
        ${fieldItem('MMSI', filing.mmsi, 'mmsi', commentedFields)}
        ${fieldItem('Vessel Type', filing.vessel_type, 'vessel_type', commentedFields)}
        ${fieldItem('Gross Tonnage', filing.gross_tonnage, 'gross_tonnage', commentedFields)}
        ${fieldItem('LOA', filing.loa, 'loa', commentedFields)}
        ${fieldItem('Beam', filing.beam, 'beam', commentedFields)}
        ${fieldItem('Draft', filing.draft, 'draft', commentedFields)}
      </div>
    </div>`;

    // Voyage info
    html += `
    <div class="section">
      <div class="section-title">Voyage</div>
      <div class="field-grid">
        ${fieldItem('Transit Direction', filing.transit_direction, 'transit_direction', commentedFields)}
        ${fieldItem('Last Port', filing.last_port, 'last_port', commentedFields)}
        ${fieldItem('Next Port', filing.next_port, 'next_port', commentedFields)}
        ${fieldItem('Est. Arrival', filing.estimated_arrival, 'estimated_arrival', commentedFields)}
      </div>
    </div>`;

    // Cargo
    if (filing.cargo_type !== undefined) {
      html += `
      <div class="section">
        <div class="section-title">Cargo</div>
        <div class="field-grid">
          ${fieldItem('Cargo Type', filing.cargo_type, 'cargo_type', commentedFields)}
          ${fieldItem('Cargo Quantity', filing.cargo_quantity, 'cargo_quantity', commentedFields)}
          ${fieldItem('Dangerous Goods Class', filing.dangerous_goods_class, 'dangerous_goods_class', commentedFields)}
        </div>
      </div>`;
    }

    // Compliance
    html += `
    <div class="section">
      <div class="section-title">Compliance</div>
      <div class="field-grid">
        ${fieldItem('Compliance Score', filing.compliance_score !== null ? filing.compliance_score + ' / 100' : null, 'compliance_score', commentedFields)}
        ${fieldItem('Filing Status', filing.filing_status, 'filing_status', commentedFields)}
      </div>
    </div>`;

    // Crew (cape/malacca have crew info)
    if (filing.crew_count !== undefined) {
      html += `
      <div class="section">
        <div class="section-title">Crew</div>
        <div class="field-grid">
          ${fieldItem('Crew Count', filing.crew_count, 'crew_count', commentedFields)}
          ${fieldItem('Passenger Count', filing.passenger_count, 'passenger_count', commentedFields)}
        </div>
      </div>`;
    }

    return html;
  }

  // ── Comments list renderer ───────────────────────────────────────────────────

  function renderComments(comments) {
    if (!comments || comments.length === 0) {
      return `<p style="color:var(--gray);font-size:0.82rem;">No review comments yet.</p>`;
    }
    return comments.map(c => `
    <div class="comment-item${c.resolved ? ' resolved' : ''}" data-id="${c.id}">
      <div class="comment-meta">
        <span>${c.author_email || 'Reviewer'} · ${relTime(c.created_at)}</span>
        ${!c.resolved ? `<button class="resolve-btn" onclick="window._awResolveComment(${c.id})">Resolve ✓</button>` : '<span style="color:var(--green);font-size:0.7rem;">Resolved</span>'}
      </div>
      ${c.field_name ? `<div class="comment-field">On: ${c.field_name}</div>` : ''}
      <div class="comment-text">${c.comment}</div>
    </div>`).join('');
  }

  // ── Audit log renderer ───────────────────────────────────────────────────────

  function renderAuditLog(log) {
    if (!log || log.length === 0) {
      return `<p style="color:var(--gray);font-size:0.82rem;">No history yet.</p>`;
    }
    return log.map(entry => `
    <div class="audit-item">
      <div class="audit-dot ${auditDotClass(entry.action)}"></div>
      <div>
        <div class="audit-action">${AUDIT_LABELS[entry.action] || entry.action}</div>
        <div class="audit-who">${entry.actor_email || 'System'} · ${relTime(entry.created_at)}</div>
        ${entry.comment ? `<div class="audit-comment">${entry.comment}</div>` : ''}
      </div>
    </div>`).join('');
  }

  // ── Actions builder ─────────────────────────────────────────────────────────

  function renderActions(status) {
    switch (status) {
      case 'draft':
        return `<button class="action-btn action-submit" onclick="window._awAction('submit')">
          <span class="icon">📤</span> Submit for Review
        </button>`;

      case 'submitted':
        return `
        <button class="action-btn action-approve" onclick="window._awAction('start-review')">
          <span class="icon">👁</span> Start Review
        </button>
        <button class="action-btn action-approve" onclick="window._awAction('approve')">
          <span class="icon">✅</span> Approve
        </button>
        <button class="action-btn action-changes" onclick="window._awAction('request-changes')">
          <span class="icon">✏️</span> Request Changes
        </button>
        <button class="action-btn action-reject" onclick="window._awAction('reject')">
          <span class="icon">❌</span> Reject
        </button>`;

      case 'in_review':
        return `
        <button class="action-btn action-approve" onclick="window._awAction('approve')">
          <span class="icon">✅</span> Approve
        </button>
        <button class="action-btn action-changes" onclick="window._awAction('request-changes')">
          <span class="icon">✏️</span> Request Changes
        </button>
        <button class="action-btn action-reject" onclick="window._awAction('reject')">
          <span class="icon">❌</span> Reject
        </button>`;

      case 'changes_requested':
        return `<button class="action-btn action-submit" onclick="window._awAction('submit')">
          <span class="icon">📤</span> Re-submit for Review
        </button>`;

      case 'approved':
        return `<button class="action-btn action-export" onclick="window._awAction('export')">
          <span class="icon">📥</span> Mark as Exported
        </button>`;

      case 'exported':
      case 'rejected':
        return `<p style="color:var(--gray);font-size:0.82rem;font-style:italic;">No further actions available.</p>`;

      default:
        return '';
    }
  }

  // ── Modal helper ─────────────────────────────────────────────────────────────

  function showModal(config) {
    const container = document.getElementById('modal-container');
    const { title, message, confirmLabel, confirmClass, onConfirm, hasComment = false, hasFieldComment = false } = config;
    container.innerHTML = `
    <div class="modal-backdrop" id="modal-bd">
      <div class="modal">
        <h3>${title}</h3>
        <p>${message}</p>
        ${hasComment ? `
          <label class="form-label">Comment${config.commentRequired ? ' *' : ''}</label>
          <textarea class="comment-box" id="modal-comment" placeholder="Add a comment…"></textarea>
        ` : ''}
        ${hasFieldComment ? `
          <label class="form-label" style="margin-top:10px;">Field (optional)</label>
          <input type="text" id="modal-field" style="background:var(--deep);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:#fff;font-family:inherit;font-size:0.85rem;width:100%;" placeholder="e.g. imo_number" />
        ` : ''}
        <div class="modal-actions">
          <button class="modal-cancel" onclick="window._awCloseModal()">Cancel</button>
          <button class="${confirmClass}" onclick="window._awConfirmModal()">${confirmLabel}</button>
        </div>
      </div>
    </div>`;
    window._awModalOnConfirm = onConfirm;
  }

  window._awCloseModal = function () {
    document.getElementById('modal-container').innerHTML = '';
  };

  window._awConfirmModal = function () {
    const comment = document.getElementById('modal-comment')?.value?.trim() || null;
    const field   = document.getElementById('modal-field')?.value?.trim() || null;
    window._awCloseModal();
    if (window._awModalOnConfirm) window._awModalOnConfirm({ comment, field });
  };

  // ── Resolve comment ─────────────────────────────────────────────────────────

  window._awResolveComment = async function (commentId) {
    try {
      await api('PATCH', `/api/workflow/comments/${commentId}/resolve`);
      toast('Comment resolved', 'success');
      loadPage();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // ── Show comment modal (field-level comment from filing panel) ──────────────

  window._awShowCommentModal = function (fieldKey) {
    showModal({
      title: `Add comment on "${fieldKey}"`,
      message: 'Leave a note for the operator about this field.',
      confirmLabel: 'Add Comment',
      confirmClass: 'modal-confirm-changes',
      hasComment: true,
      commentRequired: true,
      onConfirm: async ({ comment }) => {
        if (!comment) return;
        try {
          await api('POST', `/api/workflow/${filingType}/${filingId}/comments`, {
            field_name: fieldKey,
            comment,
          });
          toast('Comment added', 'success');
          loadPage();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  };

  // ── Transition actions ───────────────────────────────────────────────────────

  window._awAction = function (action) {
    const configs = {
      'submit': {
        title: 'Submit for Review',
        message: 'The filing will be locked for editing and sent for compliance review.',
        confirmLabel: 'Submit',
        confirmClass: 'modal-confirm-submit',
        hasComment: false,
        onConfirm: () => doTransition('submit'),
      },
      'start-review': {
        title: 'Start Review',
        message: 'Mark this filing as currently under your review.',
        confirmLabel: 'Start Review',
        confirmClass: 'modal-confirm-approve',
        hasComment: false,
        onConfirm: () => doTransition('start-review'),
      },
      'approve': {
        title: 'Approve Filing',
        message: 'The operator will be notified. The filing becomes exportable.',
        confirmLabel: 'Approve',
        confirmClass: 'modal-confirm-approve',
        hasComment: true,
        onConfirm: ({ comment }) => doTransition('approve', { comment }),
      },
      'request-changes': {
        title: 'Request Changes',
        message: 'The filing will be unlocked and returned to the operator with your comments.',
        confirmLabel: 'Request Changes',
        confirmClass: 'modal-confirm-changes',
        hasComment: true,
        commentRequired: true,
        onConfirm: ({ comment }) => {
          if (!comment) { toast('Comment is required', 'error'); return; }
          doTransition('request-changes', { comment });
        },
      },
      'reject': {
        title: 'Reject Filing',
        message: 'This filing will be permanently rejected. The operator will be notified.',
        confirmLabel: 'Reject',
        confirmClass: 'modal-confirm-reject',
        hasComment: true,
        onConfirm: ({ comment }) => doTransition('reject', { comment }),
      },
      'export': {
        title: 'Mark as Exported',
        message: 'Confirm that this filing has been downloaded/exported. The timestamp and your name will be logged.',
        confirmLabel: 'Mark Exported',
        confirmClass: 'modal-confirm-approve',
        hasComment: false,
        onConfirm: () => doTransition('export'),
      },
    };

    const cfg = configs[action];
    if (!cfg) return;
    showModal(cfg);
  };

  async function doTransition(action, body = {}) {
    try {
      const result = await api('POST', `/api/workflow/${filingType}/${filingId}/${action}`, body);
      if (result.success) {
        toast(
          result.auto_approved ? 'Auto-approved (workflow bypass)' : `Workflow updated: ${STATUS_LABELS[result.workflow_status] || result.workflow_status}`,
          'success'
        );
        loadPage();
      } else {
        toast(result.error || result.message || 'Action failed', 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ── Notification bell ────────────────────────────────────────────────────────

  async function loadNotifBadge() {
    try {
      const data = await api('GET', '/api/workflow/notifications/unread-count');
      const badge = document.getElementById('notif-badge');
      if (data.count > 0) {
        badge.textContent = data.count;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch (_) {}
  }

  document.getElementById('notif-bell').addEventListener('click', async () => {
    try {
      const data = await api('GET', '/api/workflow/notifications?limit=10');
      if (!data.notifications || data.notifications.length === 0) {
        toast('No notifications', 'info');
        return;
      }
      showModal({
        title: 'Notifications',
        message: data.notifications.map(n =>
          `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-weight:600;font-size:0.88rem;color:#fff;">${n.title}</div>
            ${n.body ? `<div style="font-size:0.82rem;color:var(--light);margin-top:2px;">${n.body}</div>` : ''}
            ${n.filing_id ? `<a href="/approval-review?type=${n.filing_type}&id=${n.filing_id}" style="font-size:0.78rem;color:var(--teal);">View filing →</a>` : ''}
          </div>`
        ).join(''),
        confirmLabel: 'Mark All Read',
        confirmClass: 'modal-confirm-approve',
        hasComment: false,
        onConfirm: async () => {
          await api('POST', '/api/workflow/notifications/read', { ids: [] });
          loadNotifBadge();
          toast('All notifications marked read', 'success');
        },
      });
      // Mark as read after viewing
      await api('POST', '/api/workflow/notifications/read', {
        ids: data.notifications.map(n => n.id),
      }).catch(() => {});
      loadNotifBadge();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ── Pending filings list ─────────────────────────────────────────────────────

  async function renderPendingList() {
    const app = document.getElementById('app');
    try {
      const data = await api('GET', '/api/workflow/pending');
      const filings = data.filings || [];

      app.innerHTML = `
      <div class="pending-section" style="max-width:900px;margin:2rem auto;padding-top:2rem;">
        <h2 style="font-size:1.35rem;font-weight:700;margin-bottom:0.25rem;">Pending Approvals</h2>
        <p style="color:var(--gray);font-size:0.88rem;margin-bottom:1.5rem;">${filings.length} filing${filings.length !== 1 ? 's' : ''} awaiting review</p>
        ${filings.length === 0
          ? `<div class="empty-state">
               <div class="icon">✅</div>
               <p>No filings awaiting review.</p>
             </div>`
          : `<table class="pending-table">
               <thead><tr>
                 <th>Vessel</th><th>IMO</th><th>Type</th><th>Status</th><th>Submitted</th><th></th>
               </tr></thead>
               <tbody>
               ${filings.map(f => `
                 <tr>
                   <td>${f.vessel_name || '—'}</td>
                   <td>${f.imo_number || '—'}</td>
                   <td style="text-transform:uppercase;font-size:0.78rem;">${f.filing_type}</td>
                   <td>${statusBadge(f.workflow_status)}</td>
                   <td style="color:var(--gray);font-size:0.82rem;">${relTime(f.submitted_at)}</td>
                   <td><a href="/approval-review?type=${f.filing_type}&id=${f.id}">Review →</a></td>
                 </tr>`).join('')}
               </tbody>
             </table>`
        }
      </div>`;
    } catch (err) {
      app.innerHTML = `<p style="color:var(--red);margin:2rem;">Error loading pending filings: ${err.message}</p>`;
    }
  }

  // ── Main filing review page ──────────────────────────────────────────────────

  async function loadPage() {
    const app = document.getElementById('app');

    if (viewMode === 'pending' || !filingType || !filingId) {
      return renderPendingList();
    }

    try {
      // Parallel fetch: filing state, comments, audit log
      const [stateData, commentsData, auditData, filingData] = await Promise.all([
        api('GET', `/api/workflow/${filingType}/${filingId}/audit`).catch(() => ({ audit_log: [] })),
        api('GET', `/api/workflow/${filingType}/${filingId}/comments`).catch(() => ({ comments: [] })),
        api('GET', `/api/workflow/${filingType}/${filingId}/audit`).catch(() => ({ audit_log: [] })),
        fetchFilingData(),
      ]);

      const comments = commentsData.comments || [];
      const auditLog = stateData.audit_log || auditData.audit_log || [];
      const filing   = filingData;

      if (!filing) {
        app.innerHTML = `<p style="color:var(--red);margin:2rem;">Filing not found.</p>`;
        return;
      }

      // Build set of commented fields for highlighting
      const commentedFields = new Set(comments.filter(c => !c.resolved && c.field_name).map(c => c.field_name));

      const status = filing.workflow_status || 'draft';

      app.innerHTML = `
      <!-- LEFT PANEL -->
      <div class="left-panel">
        <div class="panel-header">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <h2>${filing.vessel_name || 'Unnamed Vessel'}</h2>
            ${statusBadge(status)}
          </div>
          <div class="meta">
            IMO ${filing.imo_number || '—'} ·
            ${(filingType || '').toUpperCase()} ·
            ${filing.submitted_at ? 'Submitted ' + relTime(filing.submitted_at) : 'Not yet submitted'}
          </div>
        </div>
        ${renderFilingFields(filing, filingType, commentedFields)}
      </div>

      <!-- RIGHT PANEL -->
      <div class="right-panel">

        <!-- ACTIONS -->
        <div class="review-section">
          <div class="review-section-title">Actions</div>
          <div class="action-group" id="action-group">
            ${renderActions(status)}
          </div>
        </div>

        <!-- REVIEW COMMENTS -->
        <div class="review-section">
          <div class="review-section-title" style="display:flex;justify-content:space-between;align-items:center;">
            Review Comments
            ${status === 'in_review' || status === 'submitted'
              ? `<button style="font-size:0.72rem;background:rgba(0,212,170,0.12);color:var(--teal);border:1px solid rgba(0,212,170,0.2);padding:3px 10px;border-radius:6px;cursor:pointer;" onclick="window._awShowCommentModal(null)">+ Add</button>`
              : ''}
          </div>
          <div id="comments-list">${renderComments(comments)}</div>
        </div>

        <!-- AUDIT LOG -->
        <div class="review-section">
          <div class="review-section-title">History</div>
          <div id="audit-log">${renderAuditLog(auditLog)}</div>
        </div>

      </div>`;

    } catch (err) {
      app.innerHTML = `<p style="color:var(--red);margin:2rem;">Error: ${err.message}</p>`;
    }
  }

  // ── Fetch full filing row from the appropriate endpoint ─────────────────────

  async function fetchFilingData() {
    const endpoint = {
      sp1:     `/api/bosporus/filings/${filingId}`,
      malacca: `/api/malacca/filings/${filingId}`,
      cape:    `/api/cape/filings/${filingId}`,
    }[filingType];

    if (!endpoint) return null;

    try {
      const data = await api('GET', endpoint);
      return data.filing || data.data || data || null;
    } catch (_) {
      // If the filing API doesn't return full data, fall back to workflow state
      try {
        const stateRes = await fetch(`/api/workflow/${filingType}/${filingId}/audit`);
        return { id: filingId, workflow_status: 'draft', filing_type: filingType };
      } catch (_) {
        return null;
      }
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  loadPage();
  loadNotifBadge();

  // ── Register workflow settings page support (called from settings pages) ─────
  window.CanalClearWorkflow = {
    loadSettings: async () => {
      return api('GET', '/api/workflow/settings');
    },
    saveSettings: async (settings) => {
      return api('PUT', '/api/workflow/settings', settings);
    },
  };

})();
