/**
 * routes/vessel-limits.js — Agency vessel limit status API.
 *
 * Owns: vessel limit status endpoint, used by dashboard and filing pages.
 * Does NOT own: vessel CRUD, filing submission, subscription management.
 *
 * All routes require auth. Responses are designed for direct consumption
 * by frontend banner components.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getAgencyLimitStatus } = require('../services/vessel-limit-service');

/**
 * GET /api/vessel-limits/status
 * Returns current vessel usage and limit state for the authenticated user.
 * Frontend uses this to render warning banners and disable submit buttons.
 *
 * Response shape:
 * {
 *   success: true,
 *   isAgency: bool,
 *   vesselCount: number,
 *   vesselLimit: number | null,   // null = unlimited
 *   atLimit: bool,
 *   overLimit: bool,
 *   inGrace: bool,
 *   daysRemaining: number,
 *   graceExpired: bool,
 *   filingBlocked: bool,
 *   tierName: string,
 *   upgradeTierName: string,
 *   upgrade_url: string,
 * }
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getAgencyLimitStatus(req.app.locals.pool, req.user.id);
    res.json({
      success: true,
      ...status,
      upgrade_url: '/pricing?tab=agency',
    });
  } catch (err) {
    console.error('[vessel-limits] status error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
