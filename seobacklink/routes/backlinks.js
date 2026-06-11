const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { createBacklink, getBacklinksByUser, updateBacklinkStatus, getBacklinkStats } = require('../db/backlinks');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const backlinks = await getBacklinksByUser(req.user.id, {
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0,
    });
    res.json({ backlinks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load backlinks' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { targetUrl, anchorText, sourceUrl, domainAuthority } = req.body;
    if (!targetUrl || !anchorText) return res.status(400).json({ error: 'targetUrl and anchorText required' });
    const backlink = await createBacklink({
      userId: req.user.id,
      targetUrl,
      anchorText,
      sourceUrl,
      domainAuthority: domainAuthority ? parseInt(domainAuthority) : null,
    });
    res.json(backlink);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add backlink' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'active', 'lost', 'rejected'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const backlink = await updateBacklinkStatus(req.params.id, req.user.id, status);
    if (!backlink) return res.status(404).json({ error: 'Backlink not found' });
    res.json(backlink);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update backlink' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const stats = await getBacklinkStats(req.user.id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load backlink stats' });
  }
});

module.exports = router;
