/**
 * routes/approval-workflow.js — Filing approval workflow REST API
 *
 * Owns: all /api/workflow/* endpoints for state transitions, settings,
 *       notifications, audit log, and review comments.
 * Does NOT own: state machine logic (services/approval-workflow.js),
 *               SQL (db/approval-workflow.js), auth middleware.
 *
 * Endpoints:
 *   GET    /api/workflow/settings                    — get org approval settings
 *   PUT    /api/workflow/settings                    — update org approval settings
 *   POST   /api/workflow/:type/:id/submit            — submit for review
 *   POST   /api/workflow/:type/:id/start-review      — mark in_review (reviewer)
 *   POST   /api/workflow/:type/:id/approve           — approve (reviewer/admin)
 *   POST   /api/workflow/:type/:id/request-changes   — request changes (reviewer)
 *   POST   /api/workflow/:type/:id/reject            — reject (reviewer/admin)
 *   POST   /api/workflow/:type/:id/export            — mark exported
 *   GET    /api/workflow/:type/:id/audit             — full audit log
 *   GET    /api/workflow/:type/:id/comments          — review comments
 *   POST   /api/workflow/:type/:id/comments          — add review comment
 *   PATCH  /api/workflow/comments/:commentId/resolve — resolve a comment
 *   GET    /api/workflow/pending                     — list pending approvals
 *   GET    /api/workflow/pending/count               — badge count
 *   GET    /api/notifications                        — in-app notifications
 *   POST   /api/notifications/read                   — mark read
 *   GET    /api/notifications/unread-count           — bell badge count
 */

const express = require('express');
const router  = express.Router();

const { requireAuth } = require('../middleware/auth');
const {
  getApprovalSettings,
  upsertApprovalSettings,
  listPendingReviewFilings,
  countPendingApprovals,
  getAuditLog,
  getReviewComments,
  addReviewComment,
  resolveReviewComment,
  listNotifications,
  markNotificationsRead,
  countUnreadNotifications,
} = require('../db/approval-workflow');

const {
  submitForReview,
  startReview,
  approveFiling,
  requestChanges,
  rejectFiling,
  markExported,
} = require('../services/approval-workflow');

// Allowed filing types
const VALID_TYPES = ['sp1', 'malacca', 'cape'];

function validateType(req, res, next) {
  if (!VALID_TYPES.includes(req.params.type)) {
    return res.status(400).json({ success: false, message: `Invalid filing type. Must be one of: ${VALID_TYPES.join(', ')}` });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/settings', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const settings = await getApprovalSettings(pool, req.user.id);
    return res.json({ success: true, settings: settings || { enabled: false } });
  } catch (err) {
    console.error('[Workflow] GET /settings error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load settings' });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const settings = await upsertApprovalSettings(pool, req.user.id, req.body);
    return res.json({ success: true, settings });
  } catch (err) {
    console.error('[Workflow] PUT /settings error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save settings' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STATE TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:type/:id/submit', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await submitForReview(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] submit error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/start-review', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await startReview(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] start-review error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/approve', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await approveFiling(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
      comment: req.body.comment,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] approve error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/request-changes', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!req.body.comment) {
      return res.status(400).json({ success: false, message: 'Comment is required when requesting changes' });
    }
    const result = await requestChanges(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
      comment: req.body.comment,
      fieldComments: req.body.field_comments,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] request-changes error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/reject', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await rejectFiling(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
      comment: req.body.comment,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] reject error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/export', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await markExported(pool, {
      filingType: req.params.type,
      filingId: parseInt(req.params.id, 10),
      actorUserId: req.user.id,
    });
    return res.json(result);
  } catch (err) {
    console.error('[Workflow] export error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:type/:id/audit', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const log = await getAuditLog(pool, req.params.type, parseInt(req.params.id, 10));
    return res.json({ success: true, audit_log: log });
  } catch (err) {
    console.error('[Workflow] audit error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REVIEW COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:type/:id/comments', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const comments = await getReviewComments(pool, req.params.type, parseInt(req.params.id, 10));
    return res.json({ success: true, comments });
  } catch (err) {
    console.error('[Workflow] comments GET error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:type/:id/comments', requireAuth, validateType, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!req.body.comment) {
      return res.status(400).json({ success: false, message: 'comment is required' });
    }
    const comment = await addReviewComment(pool, {
      filing_id: parseInt(req.params.id, 10),
      filing_type: req.params.type,
      field_name: req.body.field_name,
      comment: req.body.comment,
      author_user_id: req.user.id,
    });
    return res.json({ success: true, comment });
  } catch (err) {
    console.error('[Workflow] comments POST error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/comments/:commentId/resolve', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const comment = await resolveReviewComment(pool, parseInt(req.params.commentId, 10));
    if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });
    return res.json({ success: true, comment });
  } catch (err) {
    console.error('[Workflow] resolve comment error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PENDING APPROVALS (dashboard widgets)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/pending', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const filings = await listPendingReviewFilings(pool, req.user.id);
    return res.json({ success: true, filings });
  } catch (err) {
    console.error('[Workflow] pending error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/pending/count', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const count = await countPendingApprovals(pool, req.user.id);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[Workflow] pending count error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IN-APP NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/notifications', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const unreadOnly = req.query.unread === 'true';
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const notifications = await listNotifications(pool, req.user.id, { limit, unreadOnly });
    return res.json({ success: true, notifications });
  } catch (err) {
    console.error('[Workflow] notifications error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await markNotificationsRead(pool, req.user.id, req.body.ids || []);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Workflow] mark read error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/notifications/unread-count', requireAuth, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const count = await countUnreadNotifications(pool, req.user.id);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[Workflow] unread count error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
