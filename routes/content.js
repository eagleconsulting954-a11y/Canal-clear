/**
 * Content routes — podcast RSS, blog, glossary, compliance programmatic SEO.
 * Owns: podcast RSS feed generation, blog slug routes, compliance slug routes,
 *       glossary, compliance hub.
 * Does NOT own: page-serving routes (routes/pages.js), API endpoints (routes/api.js).
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { getPodcastAudioMap } = require('../db/podcast-audio');

// ── Podcast hub ──────────────────────────────────────────────────────────────
router.get('/podcast', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'podcast.html'));
});

// Podcast RSS feed — standards-compliant RSS 2.0 with iTunes namespace
router.get('/podcast/feed.xml', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const podcastDir = path.join(__dirname, '..', 'public', 'podcast');
    const siteUrl = 'https://canalclear.org';

    // Fetch audio URLs + actual byte sizes from DB
    let audioMap = {};
    try {
      audioMap = await getPodcastAudioMap(pool);
    } catch (dbErr) {
      console.warn('[RSS] Could not query podcast_audio:', dbErr.message);
    }

    // Read episode HTML files and extract metadata
    const files = fs.readdirSync(podcastDir)
      .filter(f => f.startsWith('episode-') && f.endsWith('.html'))
      .sort((a, b) => {
        const na = parseInt(a.replace('episode-', '').replace('.html', ''), 10);
        const nb = parseInt(b.replace('episode-', '').replace('.html', ''), 10);
        return na - nb;
      });

    // Staggered release dates: weekly from 2026-02-04 (Season 1)
    const baseDate = new Date('2026-02-04T09:00:00Z');
    const episodeDates = {};
    files.forEach((file, idx) => {
      const slug = file.replace('.html', '');
      const d = new Date(baseDate);
      d.setUTCDate(d.getUTCDate() + idx * 7);
      episodeDates[slug] = d.toISOString().slice(0, 10);
    });

    const episodes = [];
    for (const file of files) {
      const slug = file.replace('.html', '');
      const html = fs.readFileSync(path.join(podcastDir, file), 'utf8');
      const epNum = parseInt(slug.replace('episode-', ''), 10);

      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      const title = titleMatch
        ? titleMatch[1].replace(/ — Clear Passage Ep\.\s*\d+$/, '').trim()
        : `Episode ${epNum}`;

      const descMatch = html.match(/<meta name="description" content="([^"]+)"/i);
      const ogDescMatch = !descMatch
        ? html.match(/<meta property="og:description" content="([^"]+)"/i)
        : null;
      const description = (descMatch || ogDescMatch)
        ? (descMatch || ogDescMatch)[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"')
        : '';

      const pubDate = episodeDates[slug] || '2026-04-01';
      const durMatch = html.match(/"timeRequired"\s*:\s*"PT(\d+)M"/);
      const durationSec = durMatch ? parseInt(durMatch[1], 10) * 60 : 780;
      const season = 1;

      const audioEntry = audioMap[slug];
      let audioUrl = audioEntry && audioEntry.audio_url ? audioEntry.audio_url : null;
      if (audioUrl && audioUrl.startsWith('/')) {
        audioUrl = `${siteUrl}${audioUrl}`;
      }
      const fileBytes = audioEntry && audioEntry.file_bytes ? parseInt(audioEntry.file_bytes, 10) : 0;
      const dbDuration = audioEntry && audioEntry.duration_s ? audioEntry.duration_s : null;
      const finalDuration = dbDuration || durationSec;

      const h = Math.floor(finalDuration / 3600);
      const m = Math.floor((finalDuration % 3600) / 60);
      const s = finalDuration % 60;
      const itunesDuration = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;

      episodes.push({
        slug, epNum, title, description, pubDate,
        season, itunesDuration, audioUrl, fileBytes, finalDuration
      });
    }

    const coverArt = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/9d5d2ef6-d9e0-40eb-ad15-df5e737cefc1.png';
    const feedUrl = `${siteUrl}/podcast/feed.xml`;
    const authorEmail = 'eagleconsulting954@gmail.com';

    const esc = (str) => String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const toRFC2822 = (iso) => {
      const d = new Date(iso);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${days[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2, '0')} ` +
        `${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
        `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} +0000`;
    };

    const xmlItems = episodes.map(ep => {
      const epUrl = `${siteUrl}/podcast/${ep.slug}`;
      const epGuid = `canalclear-podcast-${ep.slug}`;
      const enclosureBlock = ep.audioUrl
        ? `\n      <enclosure url="${esc(ep.audioUrl)}" type="audio/mpeg" length="${ep.fileBytes}" />`
        : '';

      return `
    <item>
      <title>${esc(ep.title)}</title>
      <description><![CDATA[${ep.description}]]></description>
      <itunes:summary><![CDATA[${ep.description}]]></itunes:summary>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:episode>${ep.epNum}</itunes:episode>
      <itunes:season>${ep.season}</itunes:season>
      <itunes:duration>${ep.itunesDuration}</itunes:duration>
      <itunes:explicit>false</itunes:explicit>
      <itunes:image href="${coverArt}" />
      <guid isPermaLink="false">${epGuid}</guid>
      <link>${epUrl}</link>
      <pubDate>${toRFC2822(ep.pubDate)}</pubDate>${enclosureBlock}
    </item>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>CanalClear: Panama Canal Compliance</title>
    <link>${siteUrl}/podcast</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <atom:link href="https://www.youtube.com/@CanalClear" rel="related" type="text/html" title="Watch on YouTube" />
    <description>Deep-dive conversations on shipping industry insights, Panama Canal compliance, cargo logistics, and maritime operations. New episodes weekly. Watch on YouTube: https://www.youtube.com/@CanalClear</description>
    <language>en-us</language>
    <itunes:type>episodic</itunes:type>
    <itunes:author>CanalClear</itunes:author>
    <itunes:owner>
      <itunes:name>CanalClear</itunes:name>
      <itunes:email>${authorEmail}</itunes:email>
    </itunes:owner>
    <itunes:explicit>false</itunes:explicit>
    <itunes:image href="${coverArt}" />
    <itunes:category text="Business">
      <itunes:category text="Management &amp; Leadership"/>
    </itunes:category>
    <image>
      <url>${coverArt}</url>
      <title>CanalClear: Panama Canal Compliance</title>
      <link>${siteUrl}/podcast</link>
    </image>${xmlItems}
  </channel>
</rss>`;

    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);

  } catch (err) {
    console.error('[RSS Feed] Error:', err);
    res.status(500).type('text/plain').send('RSS feed error: ' + err.message);
  }
});

// Podcast individual episode pages (public)
router.get('/podcast/:slug', (req, res) => {
  const slug = req.params.slug;
  const filePath = path.join(__dirname, '..', 'public', 'podcast', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'podcast.html'));
  }
});

// Blog index + individual posts
router.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog', 'index.html'));
});
router.get('/blog/:slug', (req, res) => {
  const slug = req.params.slug;
  const filePath = path.join(__dirname, '..', 'public', 'blog', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'blog', 'index.html'));
  }
});

// Glossary hub
router.get('/glossary', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'glossary.html'));
});

// Compliance hub + programmatic SEO pages
router.get('/compliance', (req, res) => {
  const hubPath = path.join(__dirname, '..', 'public', 'compliance', 'index.html');
  if (fs.existsSync(hubPath)) {
    res.sendFile(hubPath);
  } else {
    res.sendFile(path.join(__dirname, '..', 'public', 'compliance.html'));
  }
});
router.get('/compliance-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'compliance.html'));
});
router.get('/compliance/:slug', (req, res) => {
  const slug = req.params.slug;
  const filePath = path.join(__dirname, '..', 'public', 'compliance', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).sendFile(path.join(__dirname, '..', 'public', 'compliance', 'index.html'));
  }
});

module.exports = router;
