/**
 * routes/pricing-slots.js — Founding slot counter endpoints
 *
 * Owns: GET /api/pricing-slots (public read), POST /api/pricing-slots/webhook (Stripe event decrement).
 * Does NOT own: user auth, subscription logic, Stripe checkout creation.
 *
 * The webhook endpoint is called by the Polsia platform when a checkout.session.completed
 * event fires on Stripe. It decrements the founding-slots counter once per session (idempotent).
 * Secured by POLSIA_API_KEY Bearer token — same key used by subscription-sync.
 */
const express = require('express');
const router = express.Router();
const { getSlots, decrementSlot } = require('../db/pricing-slots');

/**
 * GET /api/pricing-slots
 * Returns live founding-slot counts for frontend display.
 * Public — no auth required.
 */
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const slots = await getSlots(pool);
    res.json({
      success: true,
      total: slots.total,
      remaining: slots.remaining,
      sold_out: slots.remaining <= 0,
    });
  } catch (err) {
    console.error('[pricing-slots] GET error:', err.message);
    // Fail open — return a safe fallback so the page still renders
    res.json({ success: true, total: 20, remaining: 20, sold_out: false });
  }
});

/**
 * POST /api/pricing-slots/webhook
 * Called by Polsia when checkout.session.completed fires.
 * Body: { event_type: 'checkout.session.completed', session_id: 'cs_...' }
 * Secured by POLSIA_API_KEY Authorization header.
 */
router.post('/webhook', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const polsiaApiKey = process.env.POLSIA_API_KEY;

    // Verify caller is Polsia
    const authHeader = req.headers.authorization;
    if (!polsiaApiKey || !authHeader || authHeader !== `Bearer ${polsiaApiKey}`) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { event_type, session_id } = req.body;

    // Only decrement on completed checkouts
    if (event_type !== 'checkout.session.completed') {
      return res.json({ success: true, action: 'ignored', reason: 'not a checkout.session.completed event' });
    }

    if (!session_id) {
      return res.status(400).json({ success: false, message: 'session_id is required' });
    }

    const result = await decrementSlot(pool, session_id);

    console.log(`[pricing-slots] session=${session_id} decremented=${result.decremented} remaining=${result.remaining}`);

    res.json({
      success: true,
      decremented: result.decremented,
      remaining: result.remaining,
    });
  } catch (err) {
    console.error('[pricing-slots] webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
