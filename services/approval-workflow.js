/**
 * services/approval-workflow.js — Filing approval workflow state machine.
 *
 * Owns: transition logic, email notifications, auto-approve rules,
 *       orchestrating db writes + audit entries.
 * Does NOT own: SQL queries (db/approval-workflow.js), route handling, auth.
 *
 * Workflow states:
 *   draft → submitted → in_review → changes_requested → approved → exported
 */

const {
  getApprovalSettings,
  updateFilingWorkflowStatus,
  getFilingWithVesselInfo,
  getFilingWorkflowState,
  appendAuditEntry,
  addReviewComment,
  createNotification,
} = require('../db/approval-workflow');

const { getUserById } = require('../db/users');

const APP_URL = process.env.APP_URL || 'https://canal-clear.polsia.app';

// ─────────────────────────────────────────────────────────────────────────────
// Valid transitions
// ─────────────────────────────────────────────────────────────────────────────

const TRANSITIONS = {
  draft:              ['submitted'],
  submitted:          ['in_review', 'approved', 'changes_requested'],
  in_review:          ['approved', 'changes_requested'],
  changes_requested:  ['submitted'],
  approved:           ['exported'],
  exported:           [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

// ─────────────────────────────────────────────────────────────────────────────
// Email helpers
// ─────────────────────────────────────────────────────────────────────────────

function emailHeader() {
  return `<div style="background:#0A1628;padding:24px 36px;border-radius:10px 10px 0 0;text-align:center;">
  <h1 style="color:#00D4AA;font-size:1.3rem;margin:0;">CanalClear</h1>
  <p style="color:#8899AA;font-size:0.75rem;margin:4px 0 0;">Canal Compliance Automation</p>
</div>`;
}

function emailFooter() {
  return `<div style="background:#f5f7fa;padding:16px 36px;border-radius:0 0 10px 10px;text-align:center;border-top:1px solid #e2e8f0;">
  <p style="color:#94a3b8;font-size:0.75rem;margin:0;">
    <a href="${APP_URL}" style="color:#00D4AA;text-decoration:none;">CanalClear</a> · Canal Compliance Automation
  </p>
</div>`;
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.POLSIA_API_KEY;
  if (!apiKey) {
    console.log('[ApprovalWorkflow] POLSIA_API_KEY not set — skipping email to', to);
    return false;
  }

  try {
    const response = await fetch('https://polsia.com/api/proxy/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ to, subject, body: subject, html }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('[ApprovalWorkflow] Email error', response.status, text.slice(0, 200));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[ApprovalWorkflow] Email send failed:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Email templates
// ─────────────────────────────────────────────────────────────────────────────

function buildSubmittedEmail(filing, reviewerEmail, reviewUrl) {
  return {
    to: reviewerEmail,
    subject: `Filing ready for review: ${filing.vessel_name || 'Unnamed vessel'} (${filing.filing_type?.toUpperCase()})`,
    html: `
${emailHeader()}
<div style="background:#fff;padding:28px 36px;">
  <h2 style="color:#1a2744;font-size:1.1rem;margin:0 0 12px;">A filing is ready for your review</h2>
  <p style="color:#374151;margin:0 0 8px;"><strong>Vessel:</strong> ${filing.vessel_name || '—'} (IMO ${filing.imo_number || '—'})</p>
  <p style="color:#374151;margin:0 0 8px;"><strong>Type:</strong> ${(filing.filing_type || '').toUpperCase()}</p>
  <p style="color:#374151;margin:0 0 20px;"><strong>Submitted:</strong> ${new Date().toUTCString()}</p>
  <a href="${reviewUrl}" style="display:inline-block;background:#00D4AA;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;">
    Review Filing →
  </a>
</div>
${emailFooter()}`,
  };
}

function buildApprovedEmail(filing, operatorEmail) {
  return {
    to: operatorEmail,
    subject: `Filing approved ✓ — ${filing.vessel_name || 'Filing'} is ready for export`,
    html: `
${emailHeader()}
<div style="background:#fff;padding:28px 36px;">
  <h2 style="color:#1a2744;font-size:1.1rem;margin:0 0 12px;">Your filing has been approved</h2>
  <p style="color:#374151;margin:0 0 8px;"><strong>Vessel:</strong> ${filing.vessel_name || '—'} (IMO ${filing.imo_number || '—'})</p>
  <p style="color:#374151;margin:0 0 20px;">The filing is now ready for PDF/CSV export and submission.</p>
  <a href="${APP_URL}/approval-review?type=${filing.filing_type}&id=${filing.id}" style="display:inline-block;background:#00D4AA;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;">
    Export Filing →
  </a>
</div>
${emailFooter()}`,
  };
}

function buildChangesRequestedEmail(filing, operatorEmail, comment) {
  return {
    to: operatorEmail,
    subject: `Changes requested on your filing — ${filing.vessel_name || 'Filing'}`,
    html: `
${emailHeader()}
<div style="background:#fff;padding:28px 36px;">
  <h2 style="color:#1a2744;font-size:1.1rem;margin:0 0 12px;">Your reviewer has requested changes</h2>
  <p style="color:#374151;margin:0 0 8px;"><strong>Vessel:</strong> ${filing.vessel_name || '—'} (IMO ${filing.imo_number || '—'})</p>
  ${comment ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:12px 0;border-radius:4px;"><p style="color:#92400e;margin:0;font-size:0.9rem;">${comment}</p></div>` : ''}
  <p style="color:#374151;margin:12px 0 20px;">Please update the filing and re-submit for review.</p>
  <a href="${APP_URL}/approval-review?type=${filing.filing_type}&id=${filing.id}" style="display:inline-block;background:#0A1628;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.95rem;">
    Edit Filing →
  </a>
</div>
${emailFooter()}`,
  };
}

function buildRejectedEmail(filing, operatorEmail, comment) {
  return {
    to: operatorEmail,
    subject: `Filing rejected — ${filing.vessel_name || 'Filing'}`,
    html: `
${emailHeader()}
<div style="background:#fff;padding:28px 36px;">
  <h2 style="color:#1a2744;font-size:1.1rem;margin:0 0 12px;">Your filing has been rejected</h2>
  <p style="color:#374151;margin:0 0 8px;"><strong>Vessel:</strong> ${filing.vessel_name || '—'} (IMO ${filing.imo_number || '—'})</p>
  ${comment ? `<div style="background:#fee2e2;border-left:4px solid #ef4444;padding:12px 16px;margin:12px 0;border-radius:4px;"><p style="color:#991b1b;margin:0;font-size:0.9rem;">${comment}</p></div>` : ''}
  <p style="color:#374151;margin:12px 0 20px;">Please review the comments and create a corrected filing.</p>
</div>
${emailFooter()}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// State transition helpers
// ─────────────────────────────────────────────────────────────────────────────

// getFilingWithVesselInfo is now imported from db/approval-workflow.js

/**
 * Get user email by id (delegates to db/users.js).
 */
async function getUserEmail(pool, userId) {
  if (!userId) return null;
  const user = await getUserById(pool, userId);
  return user ? user.email : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported transition functions (called by routes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a filing for review.
 * Locks the filing. Notifies reviewers. Supports auto-approve if settings say so.
 */
async function submitForReview(pool, { filingType, filingId, actorUserId }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  if (!canTransition(filing.workflow_status, 'submitted')) {
    return { success: false, error: `Cannot submit from state: ${filing.workflow_status}` };
  }

  // Check org settings for auto-approve
  const settings = await getApprovalSettings(pool, filing.user_id);
  const workflowEnabled = settings && settings.enabled;
  const autoApproveSelf = settings && settings.auto_approve_self;

  // Auto-approve if: workflow is off OR actor is the owner and auto_approve_self is on
  const shouldAutoApprove = !workflowEnabled || (autoApproveSelf && actorUserId === filing.user_id);

  if (shouldAutoApprove) {
    await updateFilingWorkflowStatus(pool, filingType, filingId, {
      workflow_status: 'approved',
      submitted_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: actorUserId,
    });

    await appendAuditEntry(pool, {
      filing_id: filingId,
      filing_type: filingType,
      action: 'auto_approved',
      actor_user_id: actorUserId,
      actor_role: 'operator',
      comment: 'Auto-approved (workflow disabled or self-approval enabled)',
    });

    return { success: true, workflow_status: 'approved', auto_approved: true };
  }

  // Normal submit
  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'submitted',
    submitted_at: new Date().toISOString(),
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'submitted',
    actor_user_id: actorUserId,
    actor_role: 'operator',
  });

  // In-app notification for owner/admin
  await createNotification(pool, {
    user_id: filing.user_id,
    kind: 'filing_submitted',
    title: `Filing submitted for review`,
    body: `${filing.vessel_name || 'Vessel'} (${filingType.toUpperCase()}) is awaiting approval.`,
    filing_id: filingId,
    filing_type: filingType,
  }).catch(() => {});

  // Email notification (fire-and-forget)
  const ownerEmail = await getUserEmail(pool, filing.user_id);
  if (ownerEmail && settings && settings.notify_on_submit) {
    const reviewUrl = `${APP_URL}/approval-review?type=${filingType}&id=${filingId}`;
    sendEmail(buildSubmittedEmail(filing, ownerEmail, reviewUrl)).catch(() => {});
  }

  return { success: true, workflow_status: 'submitted' };
}

/**
 * Start reviewing a filing (transitions submitted → in_review).
 */
async function startReview(pool, { filingType, filingId, actorUserId }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  if (!canTransition(filing.workflow_status, 'in_review')) {
    return { success: false, error: `Cannot start review from state: ${filing.workflow_status}` };
  }

  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'in_review',
    reviewed_by: actorUserId,
    reviewed_at: new Date().toISOString(),
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'review_started',
    actor_user_id: actorUserId,
    actor_role: 'reviewer',
  });

  return { success: true, workflow_status: 'in_review' };
}

/**
 * Approve a filing.
 */
async function approveFiling(pool, { filingType, filingId, actorUserId, comment }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  if (!canTransition(filing.workflow_status, 'approved')) {
    return { success: false, error: `Cannot approve from state: ${filing.workflow_status}` };
  }

  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'approved',
    approved_by: actorUserId,
    approved_at: new Date().toISOString(),
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'approved',
    actor_user_id: actorUserId,
    actor_role: 'reviewer',
    comment,
  });

  // Notify operator
  const settings = await getApprovalSettings(pool, filing.user_id);
  const operatorEmail = await getUserEmail(pool, filing.user_id);

  await createNotification(pool, {
    user_id: filing.user_id,
    kind: 'filing_approved',
    title: 'Filing approved — ready for export',
    body: `${filing.vessel_name || 'Vessel'} (${filingType.toUpperCase()}) was approved.`,
    filing_id: filingId,
    filing_type: filingType,
  }).catch(() => {});

  if (operatorEmail && (!settings || settings.notify_on_approve)) {
    sendEmail(buildApprovedEmail(filing, operatorEmail)).catch(() => {});
  }

  return { success: true, workflow_status: 'approved' };
}

/**
 * Request changes on a filing — unlock for editing.
 */
async function requestChanges(pool, { filingType, filingId, actorUserId, comment, fieldComments }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  if (!canTransition(filing.workflow_status, 'changes_requested')) {
    return { success: false, error: `Cannot request changes from state: ${filing.workflow_status}` };
  }

  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'changes_requested',
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'changes_requested',
    actor_user_id: actorUserId,
    actor_role: 'reviewer',
    comment,
  });

  // Add inline field comments if provided
  if (fieldComments && Array.isArray(fieldComments)) {
    for (const fc of fieldComments) {
      await addReviewComment(pool, {
        filing_id: filingId,
        filing_type: filingType,
        field_name: fc.field_name || null,
        comment: fc.comment,
        author_user_id: actorUserId,
      }).catch(() => {});
    }
  }

  // Notify operator
  const settings = await getApprovalSettings(pool, filing.user_id);
  const operatorEmail = await getUserEmail(pool, filing.user_id);

  await createNotification(pool, {
    user_id: filing.user_id,
    kind: 'filing_changes_requested',
    title: 'Changes requested on your filing',
    body: `${filing.vessel_name || 'Vessel'} (${filingType.toUpperCase()}): ${comment || 'See review comments.'}`,
    filing_id: filingId,
    filing_type: filingType,
  }).catch(() => {});

  if (operatorEmail && (!settings || settings.notify_on_changes)) {
    sendEmail(buildChangesRequestedEmail(filing, operatorEmail, comment)).catch(() => {});
  }

  return { success: true, workflow_status: 'changes_requested' };
}

/**
 * Reject a filing outright (hard rejection — filing stays locked).
 */
async function rejectFiling(pool, { filingType, filingId, actorUserId, comment }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  const validFrom = ['submitted', 'in_review'];
  if (!validFrom.includes(filing.workflow_status)) {
    return { success: false, error: `Cannot reject from state: ${filing.workflow_status}` };
  }

  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'rejected',
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'rejected',
    actor_user_id: actorUserId,
    actor_role: 'reviewer',
    comment,
  });

  // Notify operator
  const settings = await getApprovalSettings(pool, filing.user_id);
  const operatorEmail = await getUserEmail(pool, filing.user_id);

  await createNotification(pool, {
    user_id: filing.user_id,
    kind: 'filing_rejected',
    title: 'Filing rejected',
    body: `${filing.vessel_name || 'Vessel'} (${filingType.toUpperCase()}) was rejected.`,
    filing_id: filingId,
    filing_type: filingType,
  }).catch(() => {});

  if (operatorEmail && (!settings || settings.notify_on_reject)) {
    sendEmail(buildRejectedEmail(filing, operatorEmail, comment)).catch(() => {});
  }

  return { success: true, workflow_status: 'rejected' };
}

/**
 * Mark a filing as exported (after PDF/CSV download).
 */
async function markExported(pool, { filingType, filingId, actorUserId }) {
  const filing = await getFilingWithVesselInfo(pool, filingType, filingId);
  if (!filing) return { success: false, error: 'Filing not found' };

  if (!canTransition(filing.workflow_status, 'exported')) {
    return { success: false, error: `Cannot export from state: ${filing.workflow_status}` };
  }

  await updateFilingWorkflowStatus(pool, filingType, filingId, {
    workflow_status: 'exported',
    exported_at: new Date().toISOString(),
    exported_by: actorUserId,
  });

  await appendAuditEntry(pool, {
    filing_id: filingId,
    filing_type: filingType,
    action: 'exported',
    actor_user_id: actorUserId,
    actor_role: 'operator',
  });

  return { success: true, workflow_status: 'exported' };
}

module.exports = {
  submitForReview,
  startReview,
  approveFiling,
  requestChanges,
  rejectFiling,
  markExported,
};
