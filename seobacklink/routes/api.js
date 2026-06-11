const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { getUserById, updateUser } = require('../db/users');
const { countArticlesThisMonth } = require('../db/articles');
const { getBacklinkStats } = require('../db/backlinks');
const { getVisibilityStats } = require('../db/visibility');
const { PLANS, createCheckoutSession, createPortalSession } = require('../services/stripe');

const PLAN_LIMITS = { free: 2, starter: 10, growth: 30, agency: 100 };

router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const [user, articlesUsed, backlinkStats, visibilityStats] = await Promise.all([
      getUserById(req.user.id),
      countArticlesThisMonth(req.user.id),
      getBacklinkStats(req.user.id),
      getVisibilityStats(req.user.id),
    ]);
    res.json({
      user: { id: user.id, email: user.email, name: user.name, plan_type: user.plan_type, subscription_status: user.subscription_status },
      articles: { used: articlesUsed, limit: PLAN_LIMITS[user.plan_type] || 2 },
      backlinks: backlinkStats,
      visibility: visibilityStats,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

router.put('/settings', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const user = await updateUser(req.user.id, { name });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.get('/plans', (req, res) => {
  res.json(PLANS);
});

router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
    const session = await createCheckoutSession({
      priceId: PLANS[plan].priceId,
      customerId: req.user.stripe_customer_id,
      email: req.user.email,
      successUrl: `${process.env.BASE_URL}/dashboard?upgraded=1`,
      cancelUrl: `${process.env.BASE_URL}/pricing`,
      userId: req.user.id,
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Checkout failed' });
  }
});

router.post('/portal', requireAuth, async (req, res) => {
  try {
    if (!req.user.stripe_customer_id) return res.status(400).json({ error: 'No subscription found' });
    const session = await createPortalSession(req.user.stripe_customer_id, `${process.env.BASE_URL}/settings`);
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: 'Portal failed' });
  }
});

module.exports = router;
