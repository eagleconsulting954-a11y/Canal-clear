const router = require('express').Router();
const requireAuth = require('../middleware/requireAuth');
const { createArticle, getArticlesByUser, getArticleById, updateArticle, countArticlesThisMonth, deleteArticle } = require('../db/articles');
const { generateArticle, generateKeywordCluster } = require('../services/ai-content');
const { sendArticleReady } = require('../services/email');

const PLAN_LIMITS = { free: 2, starter: 10, growth: 30, agency: 100 };

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const articles = await getArticlesByUser(req.user.id, {
      limit: parseInt(req.query.limit) || 20,
      offset: parseInt(req.query.offset) || 0,
    });
    const usedThisMonth = await countArticlesThisMonth(req.user.id);
    const limit = PLAN_LIMITS[req.user.plan_type] || 2;
    res.json({ articles, usedThisMonth, limit });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load articles' });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const { keyword, tone, wordCount } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });
    const limit = PLAN_LIMITS[req.user.plan_type] || 2;
    const used = await countArticlesThisMonth(req.user.id);
    if (used >= limit) {
      return res.status(402).json({ error: `Monthly limit of ${limit} articles reached`, upgrade: '/pricing' });
    }
    const article = await createArticle({ userId: req.user.id, keyword });
    res.json({ id: article.id, status: 'generating' });
    // Generate in background
    setImmediate(async () => {
      try {
        const result = await generateArticle(keyword, { tone, wordCount: parseInt(wordCount) || 1500 });
        await updateArticle(article.id, req.user.id, {
          title: result.title,
          meta_description: result.meta,
          slug: result.slug,
          content: result.content,
          word_count: result.word_count,
          status: 'ready',
        });
        await sendArticleReady(req.user.email, req.user.name, result.title, article.id).catch(() => {});
      } catch (err) {
        await updateArticle(article.id, req.user.id, { status: 'failed' }).catch(() => {});
      }
    });
  } catch (err) {
    console.error('generate error', err);
    res.status(500).json({ error: 'Failed to start generation' });
  }
});

router.post('/keywords/cluster', async (req, res) => {
  try {
    const { keyword } = req.body;
    if (!keyword) return res.status(400).json({ error: 'Keyword required' });
    const cluster = await generateKeywordCluster(keyword);
    res.json(cluster);
  } catch (err) {
    res.status(500).json({ error: 'Keyword clustering failed' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const article = await getArticleById(req.params.id, req.user.id);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load article' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const allowed = ['title', 'content', 'meta_description', 'slug'];
    const fields = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    const article = await updateArticle(req.params.id, req.user.id, fields);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    res.json(article);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update article' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteArticle(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete article' });
  }
});

module.exports = router;
