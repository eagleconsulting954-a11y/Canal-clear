/**
 * Startup services — background tasks, schedulers, audio generation, IndexNow.
 * Owns: alert scheduler, drip email scheduler, ISPS alert scheduler,
 *       blog/podcast TTS generation, founder portrait fetching, IndexNow ping.
 * Does NOT own: route handling, request processing.
 */
const path = require('path');
const fs = require('fs');
const { ensurePasswordResetsTable: ensurePwResetTable } = require('../db/password-resets');
const { ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');
const {
  getExistingBlogSlugs,
  upsertBlogAudioData,
  upsertBlogAudioUrl,
  getExistingPodcastSlugs,
  upsertPodcastAudioData,
  upsertPodcastAudioUrl,
} = require('../db/podcast-audio');

// ── Password reset table ────────────────────────────────────────────────────
async function ensurePasswordResetsTable(pool) {
  try {
    await ensurePwResetTable(pool);
    console.log('[Auth] password_resets table ready');
  } catch (err) {
    console.error('[Auth] Failed to ensure password_resets table:', err.message);
  }
}

// ── Daily Alert Scheduler ───────────────────────────────────────────────────
function startAlertScheduler(pool) {
  const { runAlertChecks } = require('./alert-service');

  const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const INITIAL_DELAY_MS = 60 * 1000;

  async function tick() {
    try {
      await runAlertChecks(pool);
    } catch (err) {
      console.error('[Alert Scheduler] Uncaught error:', err.message);
    }
  }

  setTimeout(() => {
    tick();
    setInterval(tick, RUN_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log('[Alert Scheduler] Scheduled — first run in 60s, then every 24h');
}

// ── Drip Email Scheduler ─────────────────────────────────────────────────────
function startDripScheduler(pool) {
  const { processDripEmails } = require('./drip-email');

  const RUN_INTERVAL_MS = 60 * 60 * 1000;
  const INITIAL_DELAY_MS = 90 * 1000;

  async function tick() {
    try {
      await processDripEmails(pool);
    } catch (err) {
      console.error('[Drip Scheduler] Uncaught error:', err.message);
    }
  }

  setTimeout(() => {
    tick();
    setInterval(tick, RUN_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log('[Drip Scheduler] Scheduled — first run in 90s, then every 1h');
}

// ── Filing Deadline Alert Scheduler (30-minute, 5 waterways) ─────────────────
function startDeadlineAlertScheduler(pool) {
  const { checkDeadlineAlerts } = require('./deadline-alert-service');
  const { ensureDeadlineTables } = require('../db/filing-deadlines');

  const RUN_INTERVAL_MS  = 30 * 60 * 1000; // every 30 minutes
  const INITIAL_DELAY_MS = 150 * 1000;     // 2.5 min after startup

  async function tick() {
    try {
      await checkDeadlineAlerts(pool);
    } catch (err) {
      console.error('[Deadline Alert Scheduler] Uncaught error:', err.message);
    }
  }

  // Ensure tables exist before first tick
  ensureDeadlineTables(pool)
    .then(() => {
      console.log('[Deadline Alert Scheduler] Tables ready.');
      setTimeout(() => {
        tick();
        setInterval(tick, RUN_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    })
    .catch(err => {
      console.error('[Deadline Alert Scheduler] Table setup error:', err.message);
      // Still schedule — tables may already exist
      setTimeout(() => {
        tick();
        setInterval(tick, RUN_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    });

  console.log('[Deadline Alert Scheduler] Scheduled — first run in 150s, then every 30min');
}

// ── Suez ISPS Notification Alert Scheduler ──────────────────────────────────
function startIspsAlertScheduler(pool) {
  const { checkIspsNotificationAlerts } = require('./alert-service');

  const RUN_INTERVAL_MS  = 60 * 60 * 1000;
  const INITIAL_DELAY_MS = 120 * 1000;

  async function tick() {
    try {
      await checkIspsNotificationAlerts(pool);
    } catch (err) {
      console.error('[ISPS Alert Scheduler] Uncaught error:', err.message);
    }
  }

  setTimeout(() => {
    tick();
    setInterval(tick, RUN_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log('[ISPS Alert Scheduler] Scheduled — first run in 120s, then every 1h');
}

// ── Founder Portrait Generation ─────────────────────────────────────────────
async function generateFounderPortrait(pool) {
  const realPortraitUrl = process.env.FOUNDER_PORTRAIT_URL || 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/34d613c1-7ebc-4f0b-8784-a5b4815b73ae.png';

  try {
    await ensureSiteAssetsTable(pool);

    console.log('[Founder Portrait] Fetching real headshot from R2:', realPortraitUrl);
    const realRes = await fetch(realPortraitUrl);
    if (!realRes.ok) {
      console.error(`[Founder Portrait] R2 fetch failed: ${realRes.status} ${realRes.statusText}`);
      return;
    }

    const buffer = await realRes.arrayBuffer();
    const b64 = Buffer.from(buffer).toString('base64');

    await upsertAsset(pool, 'founder-portrait', b64, 'image/png');

    const bytes = Math.round(b64.length * 0.75);
    console.log(`[Founder Portrait] Real headshot stored — ${bytes} bytes, served at /images/founder-portrait.png`);
  } catch (err) {
    console.error('[Founder Portrait] Failed:', err.message);
  }
}

// ── Audio text extraction helpers ───────────────────────────────────────────
function blogAudioExtractText(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = html.match(/<article[^>]*class="article-body"[^>]*>([\s\S]*?)<\/article>/i);
  if (!bodyMatch) return title;
  let body = bodyMatch[1];
  body = body.replace(/<div[^>]*class="cta-section"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<p[^>]*style="font-size:0\.875rem[\s\S]*?<\/p>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();
  return title ? `${title}. ${body}` : body;
}

function blogAudioSplitChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cutAt = remaining.lastIndexOf('. ', maxLen);
    if (cutAt < maxLen * 0.5) cutAt = remaining.lastIndexOf(' ', maxLen);
    if (cutAt <= 0) cutAt = maxLen;
    const chunk = remaining.slice(0, cutAt).trim();
    chunks.push(chunk);
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.map(chunk => {
    if (chunk.length > maxLen) {
      const subchunks = [];
      let text2 = chunk;
      while (text2.length > maxLen) {
        const cut = text2.lastIndexOf(' ', maxLen);
        subchunks.push(text2.slice(0, cut > 0 ? cut : maxLen));
        text2 = text2.slice(cut > 0 ? cut : maxLen);
      }
      if (text2) subchunks.push(text2);
      return subchunks;
    }
    return [chunk];
  }).flat();
}

function podcastAudioExtractText(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = html.match(/class="article-inner"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!bodyMatch) return title;
  let body = bodyMatch[1];
  body = body.replace(/<div[^>]*class="stats-box"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<div[^>]*class="show-notes"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, ' — ').replace(/&ndash;/g, ' – ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();
  return title ? `${title}. ${body}` : body;
}

// ── Blog Audio Auto-generation ─────────────────────────────────────────────
async function generateMissingBlogAudio(pool) {
  const openaiKey  = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiToken   = process.env.POLSIA_API_TOKEN;

  if (!openaiKey) {
    console.log('[Blog Audio] Skipping auto-generation: missing OPENAI_API_KEY');
    return;
  }

  const blogDir = path.join(__dirname, '..', 'public', 'blog');
  const blogFiles = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');

  const existingSlugs = await getExistingBlogSlugs(pool);
  const doneSet = new Set(existingSlugs);
  const todo = blogFiles.map(f => f.replace('.html', '')).filter(s => !doneSet.has(s));

  if (todo.length === 0) {
    console.log('[Blog Audio] All posts have audio. Nothing to generate.');
    return;
  }

  console.log(`[Blog Audio] Generating audio for ${todo.length} post(s): ${todo.join(', ')}`);

  for (const slug of todo) {
    try {
      const html = fs.readFileSync(path.join(blogDir, `${slug}.html`), 'utf8');
      const text = blogAudioExtractText(html);
      if (!text || text.length < 50) {
        console.log(`[Blog Audio] Skipping ${slug}: text too short`);
        continue;
      }

      const chunks = blogAudioSplitChunks(text, 4096);
      const buffers = [];

      for (let i = 0; i < chunks.length; i++) {
        const ttsRes = await fetch(`${openaiBase}/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'tts-1-hd', input: chunks[i], voice: 'onyx', response_format: 'mp3' }),
        });
        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`TTS API error (chunk ${i + 1}): ${ttsRes.status} ${errText.slice(0, 200)}`);
        }
        buffers.push(Buffer.from(await ttsRes.arrayBuffer()));
      }

      const audioBuffer = Buffer.concat(buffers);
      const fileName = `blog-${slug}.mp3`;

      let audioUrl = null;
      if (apiToken) {
        try {
          const nodeFetch = require('node-fetch');
          const FormData = require('form-data');
          const formData = new FormData();
          formData.append('file', audioBuffer, { filename: fileName, contentType: 'audio/mpeg' });
          const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              ...formData.getHeaders(),
            },
            body: formData,
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success) {
            audioUrl = uploadData.file.url;
            console.log(`[Blog Audio] R2 upload OK: ${audioUrl}`);
          } else {
            console.log(`[Blog Audio] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
          }
        } catch (e) {
          console.log(`[Blog Audio] R2 upload error: ${e.message}`);
        }
      }

      if (!audioUrl) {
        console.log(`[Blog Audio] Falling back to DB storage for ${slug}`);
        await upsertBlogAudioData(pool, slug, `/api/blog/${slug}/audio-file`, audioBuffer);
        console.log(`[Blog Audio] DB storage OK for ${slug} (${audioBuffer.length} bytes)`);
        continue;
      }

      await upsertBlogAudioUrl(pool, slug, audioUrl);

      console.log(`[Blog Audio] Generated audio for ${slug}: ${audioUrl}`);
    } catch (err) {
      console.error(`[Blog Audio] Failed for ${slug}:`, err.message);
    }
  }

  console.log('[Blog Audio] Auto-generation complete.');
}

// ── Podcast Audio Auto-generation ──────────────────────────────────────────
async function generateMissingPodcastAudio(pool) {
  const openaiKey  = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiToken   = process.env.POLSIA_API_TOKEN;

  if (!openaiKey) {
    console.log('[Podcast Audio] Skipping auto-generation: missing OPENAI_API_KEY');
    return;
  }

  const podcastDir = path.join(__dirname, '..', 'public', 'podcast');
  const podcastFiles = fs.readdirSync(podcastDir).filter(f => f.endsWith('.html'));

  const existingSlugs = await getExistingPodcastSlugs(pool);
  const doneSet = new Set(existingSlugs);
  const todo = podcastFiles.map(f => f.replace('.html', '')).filter(s => !doneSet.has(s));

  if (todo.length === 0) {
    console.log('[Podcast Audio] All episodes have audio. Nothing to generate.');
    return;
  }

  console.log(`[Podcast Audio] Generating audio for ${todo.length} episode(s): ${todo.join(', ')}`);

  for (const slug of todo) {
    try {
      const html = fs.readFileSync(path.join(podcastDir, `${slug}.html`), 'utf8');
      const text = podcastAudioExtractText(html);
      if (!text || text.length < 50) {
        console.log(`[Podcast Audio] Skipping ${slug}: text too short`);
        continue;
      }

      const chunks = blogAudioSplitChunks(text, 4096);
      const buffers = [];

      for (let i = 0; i < chunks.length; i++) {
        const ttsRes = await fetch(`${openaiBase}/audio/speech`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'tts-1-hd', input: chunks[i], voice: 'onyx', response_format: 'mp3' }),
        });
        if (!ttsRes.ok) {
          const errText = await ttsRes.text();
          throw new Error(`TTS API error (chunk ${i + 1}): ${ttsRes.status} ${errText.slice(0, 200)}`);
        }
        buffers.push(Buffer.from(await ttsRes.arrayBuffer()));
      }

      const audioBuffer = Buffer.concat(buffers);
      const fileName = `podcast-${slug}.mp3`;

      let audioUrl = null;
      if (apiToken) {
        try {
          const nodeFetch = require('node-fetch');
          const FormData = require('form-data');
          const formData = new FormData();
          formData.append('file', audioBuffer, { filename: fileName, contentType: 'audio/mpeg' });
          const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              ...formData.getHeaders(),
            },
            body: formData,
          });
          const uploadData = await uploadRes.json();
          if (uploadData.success) {
            audioUrl = uploadData.file.url;
            console.log(`[Podcast Audio] R2 upload OK: ${audioUrl}`);
          } else {
            console.log(`[Podcast Audio] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
          }
        } catch (e) {
          console.log(`[Podcast Audio] R2 upload error: ${e.message}`);
        }
      }

      if (!audioUrl) {
        await upsertPodcastAudioData(pool, slug, `/api/podcast/${slug}/audio-file`, audioBuffer);
        console.log(`[Podcast Audio] DB storage OK for ${slug} (${audioBuffer.length} bytes)`);
      } else {
        await upsertPodcastAudioUrl(pool, slug, audioUrl);
        console.log(`[Podcast Audio] Generated audio for ${slug}: ${audioUrl}`);
      }
    } catch (err) {
      console.error(`[Podcast Audio] Error for ${slug}:`, err.message);
    }
  }
}

// ── IndexNow ────────────────────────────────────────────────────────────────
const INDEXNOW_KEY = 'cd87c88d39a1488d8f0608dc4bb0314d';
const INDEXNOW_URLS = [
  'https://canalclear.org/', 'https://canalclear.org/pricing', 'https://canalclear.org/demo',
  'https://canalclear.org/compliance-score', 'https://canalclear.org/hazmat',
  'https://canalclear.org/case-study', 'https://canalclear.org/compliance-guide',
  'https://canalclear.org/guide', 'https://canalclear.org/compare',
  'https://canalclear.org/knowledge-base', 'https://canalclear.org/about',
  'https://canalclear.org/panama', 'https://canalclear.org/suez',
  'https://canalclear.org/bosporus', 'https://canalclear.org/blog',
  'https://canalclear.org/blog/why-ai-is-the-future-of-panama-canal-compliance',
  'https://canalclear.org/blog/how-to-avoid-panama-canal-compliance-fines-in-2026',
  'https://canalclear.org/blog/panama-canal-transit-documents-required',
  'https://canalclear.org/blog/what-is-port-state-control',
  'https://canalclear.org/blog/marpol-compliance-checklist-ship-operators-2026',
  'https://canalclear.org/blog/how-to-reduce-shipping-delays',
  'https://canalclear.org/blog/true-cost-of-non-compliance-global-shipping',
  'https://canalclear.org/blog/panama-canal-compliance-complete-guide-2026',
  'https://canalclear.org/blog/vumpa-filing-requirements-step-by-step',
  'https://canalclear.org/blog/pcsopep-documentation-complete-guide',
  'https://canalclear.org/blog/vessel-readiness-inspection-panama-canal',
  'https://canalclear.org/blog/best-maritime-compliance-podcasts-2026',
  'https://canalclear.org/blog/stay-compliant-panama-canal-regulations-listen-while-you-work',
  'https://canalclear.org/blog/panama-canal-toll-calculator-2026',
  'https://canalclear.org/blog/panama-canal-compliance-bulk-carriers',
  'https://canalclear.org/blog/panama-canal-transit-documents-lng-tankers',
  'https://canalclear.org/blog/container-ship-vumpa-filing-guide-2026',
  'https://canalclear.org/blog/ro-ro-vessel-panama-canal-documentation',
  'https://canalclear.org/blog/cruise-ship-panama-canal-requirements',
  'https://canalclear.org/blog/panama-canal-crew-manifest-requirements',
  'https://canalclear.org/blog/cargo-declaration-rules-panama-canal-transit',
  'https://canalclear.org/blog/panama-canal-environmental-compliance',
  'https://canalclear.org/blog/panama-canal-non-compliance-cost',
  'https://canalclear.org/blog/panama-canal-filing-mistakes-delays',
  'https://canalclear.org/blog/panama-canal-filing-automation-vs-manual',
  'https://canalclear.org/blog/panama-canal-transit-denial-reasons',
  'https://canalclear.org/blog/best-panama-canal-compliance-tools-2026',
  'https://canalclear.org/blog/suez-canal-transit-requirements-complete-guide-2026',
  'https://canalclear.org/blog/suez-canal-vs-panama-canal-compliance-compared',
  'https://canalclear.org/blog/suez-canal-compliance-mistakes-delays',
  'https://canalclear.org/blog/suez-canal-isps-compliance-guide',
  'https://canalclear.org/blog/suez-canal-transit-checklist-fleet-operators',
  'https://canalclear.org/blog/suez-canal-convoy-delays-paperwork-problem',
  'https://canalclear.org/blog/suez-canal-convoy-scheduling',
  'https://canalclear.org/blog/suez-canal-tonnage-certificate',
  'https://canalclear.org/blog/suez-canal-dangerous-goods-compliance',
  'https://canalclear.org/blog/suez-canal-pilotage-requirements',
  'https://canalclear.org/blog/suez-canal-transit-cost-2026',
  'https://canalclear.org/blog/vumpa-rejections-cost-more-than-transit-fee',
  'https://canalclear.org/podcast',
  'https://canalclear.org/podcast/episode-1', 'https://canalclear.org/podcast/episode-2',
  'https://canalclear.org/podcast/episode-3', 'https://canalclear.org/podcast/episode-4',
  'https://canalclear.org/podcast/episode-5', 'https://canalclear.org/podcast/episode-6',
  'https://canalclear.org/podcast/episode-7', 'https://canalclear.org/podcast/episode-8',
  'https://canalclear.org/podcast/episode-9', 'https://canalclear.org/podcast/episode-10',
  'https://canalclear.org/podcast/episode-11', 'https://canalclear.org/podcast/episode-12',
  'https://canalclear.org/podcast/episode-13', 'https://canalclear.org/podcast/episode-14',
  'https://canalclear.org/podcast/episode-15',
  'https://canalclear.org/glossary', 'https://canalclear.org/compliance',
  'https://canalclear.org/compliance/bulk-carrier-vumpa', 'https://canalclear.org/compliance/bulk-carrier-pcsopep',
  'https://canalclear.org/compliance/bulk-carrier-crew-manifest', 'https://canalclear.org/compliance/bulk-carrier-cargo-declaration',
  'https://canalclear.org/compliance/container-ship-vumpa', 'https://canalclear.org/compliance/container-ship-pcsopep',
  'https://canalclear.org/compliance/container-ship-crew-manifest', 'https://canalclear.org/compliance/container-ship-cargo-declaration',
  'https://canalclear.org/compliance/tanker-vumpa', 'https://canalclear.org/compliance/tanker-pcsopep',
  'https://canalclear.org/compliance/tanker-crew-manifest', 'https://canalclear.org/compliance/tanker-cargo-declaration',
  'https://canalclear.org/compliance/ro-ro-vessel-vumpa', 'https://canalclear.org/compliance/ro-ro-vessel-pcsopep',
  'https://canalclear.org/compliance/ro-ro-vessel-crew-manifest', 'https://canalclear.org/compliance/ro-ro-vessel-cargo-declaration',
  'https://canalclear.org/compliance/lng-carrier-vumpa', 'https://canalclear.org/compliance/lng-carrier-pcsopep',
  'https://canalclear.org/compliance/lng-carrier-crew-manifest', 'https://canalclear.org/compliance/lng-carrier-cargo-declaration',
];

async function pingIndexNow() {
  try {
    const https = require('https');
    const body = JSON.stringify({
      host: 'canalclear.org',
      key: INDEXNOW_KEY,
      keyLocation: `https://canalclear.org/${INDEXNOW_KEY}.txt`,
      urlList: INDEXNOW_URLS,
    });
    const options = {
      hostname: 'api.indexnow.org',
      path: '/indexnow',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    await new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        console.log(`[IndexNow] Pinged ${INDEXNOW_URLS.length} URLs → HTTP ${res.statusCode}`);
        resolve();
      });
      req.on('error', (err) => {
        console.warn('[IndexNow] Ping failed (non-critical):', err.message);
        resolve();
      });
      req.setTimeout(10000, () => {
        console.warn('[IndexNow] Ping timeout (non-critical)');
        req.destroy();
        resolve();
      });
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.warn('[IndexNow] Error (non-critical):', err.message);
  }
}

// ── Geofence Detection Scheduler (5-minute, all 5 canals) ────────────────────
function startGeofenceScheduler(pool) {
  const { runGeofenceTick } = require('./geofence-engine');
  const { ensureGeofenceTables } = require('../db/geofence');

  const RUN_INTERVAL_MS  = 5 * 60 * 1000; // every 5 minutes
  const INITIAL_DELAY_MS = 180 * 1000;    // 3 min after startup (after AIS layer may have ticked)

  async function tick() {
    try {
      await runGeofenceTick(pool);
    } catch (err) {
      console.error('[Geofence Scheduler] Uncaught error:', err.message);
    }
  }

  ensureGeofenceTables(pool)
    .then(() => {
      console.log('[Geofence Scheduler] Tables ready.');
      setTimeout(() => {
        tick();
        setInterval(tick, RUN_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    })
    .catch(err => {
      console.error('[Geofence Scheduler] Table setup error:', err.message);
      // Still schedule — tables may already exist from migration
      setTimeout(() => {
        tick();
        setInterval(tick, RUN_INTERVAL_MS);
      }, INITIAL_DELAY_MS);
    });

  console.log('[Geofence Scheduler] Scheduled — first run in 180s, then every 5min');
}

module.exports = {
  ensurePasswordResetsTable,
  startAlertScheduler,
  startDripScheduler,
  startIspsAlertScheduler,
  startDeadlineAlertScheduler,
  startGeofenceScheduler,
  generateFounderPortrait,
  generateMissingBlogAudio,
  generateMissingPodcastAudio,
  pingIndexNow,
  INDEXNOW_URLS,
};
