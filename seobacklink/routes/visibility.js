const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const requireSubscription = require('../middleware/requireSubscription');
const { createVisibilityCheck, getVisibilityByUser, getVisibilityStats } = require('../db/visibility');
const { analyzeVisibility } = require('../services/ai-content');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const checks = await getVisibilityByUser(req.user.id, {
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ checks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load visibility checks' });
  }
});

router.post('/check', requireSubscription, async (req, res) => {
  try {
    const { brand, keyword } = req.body;
    if (!brand || !keyword) return res.status(400).json({ error: 'brand and keyword required' });
    const result = await analyzeVisibility(brand, keyword);
    const check = await createVisibilityCheck({
      userId: req.user.id,
      brand,
      keyword,
      score: result.score,
      mentions: result.mentions,
      analysis: result.analysis,
    });
    res.json(check);
  } catch (err) {
    console.error('visibility check error', err);
    res.status(500).json({ error: 'Visibility analysis failed' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getVisibilityStats(req.user.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load visibility stats' });
  }
});

module.exports = router;
