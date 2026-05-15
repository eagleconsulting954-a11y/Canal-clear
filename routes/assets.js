/**
 * Asset routes — PDF serving, founder portrait, admin image management.
 * Owns: site_assets DB-backed file serving, R2 redirect fallback, admin portrait upload.
 * Does NOT own: static file serving (express.static in server.js), blog/podcast audio.
 */
const express = require('express');
const router = express.Router();
const { ensureSiteAssetsTable, getAssetByKey, upsertAsset } = require('../db/site-assets');

// ── Founder portrait: served from DB (ephemeral-disk-safe) ──────────────────
router.get('/images/founder-portrait.png', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await ensureSiteAssetsTable(pool);
    const asset = await getAssetByKey(pool, 'founder-portrait');
    if (asset && asset.data) {
      const buf = Buffer.from(asset.data, 'base64');
      res.set('Content-Type', asset.content_type);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buf);
    }
    res.status(404).json({ error: 'Portrait not yet generated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Replace founder portrait with real headshot ──
router.post('/admin/replace-founder-portrait', async (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  const expectedToken = process.env.ADMIN_TOKEN || 'admin-secret-key';

  if (adminToken !== expectedToken) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { imageUrl } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl required in body' });
  }

  try {
    const pool = req.app.locals.pool;
    console.log('[Admin] Fetching founder portrait from:', imageUrl);

    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return res.status(400).json({ error: `Failed to fetch image: ${imgRes.status}` });
    }

    const buffer = await imgRes.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');

    await ensureSiteAssetsTable(pool);
    await upsertAsset(pool, 'founder-portrait', b64, 'image/png');

    const bytes = Math.round(b64.length * 0.75);
    console.log(`[Admin] Founder portrait replaced — ${bytes} bytes`);
    res.json({ success: true, bytes, message: 'Portrait updated and served at /images/founder-portrait.png' });
  } catch (err) {
    console.error('[Admin] Replace portrait failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: serve a site_asset PDF by key (R2 redirect or DB fallback) ──
async function servePdfAsset(req, res, assetKey, fallbackMsg, downloadName) {
  try {
    const pool = req.app.locals.pool;
    const asset = await getAssetByKey(pool, assetKey);
    if (!asset || !asset.data) {
      return res.status(404).send(fallbackMsg);
    }
    const { data, content_type } = asset;
    if (content_type === 'text/plain' && data.startsWith('http')) {
      return res.redirect(302, data);
    }
    const pdfBuf = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Length', pdfBuf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(pdfBuf);
  } catch (err) {
    console.error(`[${assetKey}] Serve error:`, err.message);
    return res.status(500).send('PDF unavailable');
  }
}

router.get('/assets/vumpa-rejection-checklist.pdf', (req, res) => {
  servePdfAsset(req, res, 'vumpa-checklist-pdf', 'Checklist not yet generated — please try again in a moment.', 'vumpa-rejection-checklist.pdf');
});

router.get('/assets/suez-deadline-cheatsheet.pdf', (req, res) => {
  servePdfAsset(req, res, 'suez-deadline-cheatsheet-pdf', 'Cheat sheet not yet generated — please try again in a moment.', 'suez-deadline-cheatsheet.pdf');
});

// Alias — previous task may have used this path; ensure both work
router.get('/assets/suez-sca-deadline-cheatsheet.pdf', (req, res) => {
  res.redirect(301, '/assets/suez-deadline-cheatsheet.pdf');
});

router.get('/assets/bosporus-sp1-primer.pdf', (req, res) => {
  servePdfAsset(req, res, 'bosporus-sp1-primer-pdf', 'Guide not yet generated — please try again in a moment.', 'bosporus-sp1-primer.pdf');
});

router.get('/assets/panama-vumpa-primer.pdf', (req, res) => {
  servePdfAsset(req, res, 'panama-vumpa-primer-pdf', 'Guide not yet generated — please try again in a moment.', 'panama-vumpa-primer.pdf');
});

router.get('/assets/suez-sca-primer.pdf', (req, res) => {
  servePdfAsset(req, res, 'suez-sca-primer-pdf', 'Guide not yet generated — please try again in a moment.', 'suez-sca-primer.pdf');
});

module.exports = router;
