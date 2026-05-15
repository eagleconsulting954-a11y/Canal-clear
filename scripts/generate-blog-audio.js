/**
 * Generate TTS audio for all CanalClear blog posts.
 *
 * Usage:
 *   node scripts/generate-blog-audio.js              — all posts
 *   node scripts/generate-blog-audio.js <slug>       — one post
 *
 * Requires env vars: DATABASE_URL, OPENAI_API_KEY, POLSIA_API_TOKEN
 * (reads from .env if dotenv is available, or use: node -r dotenv/config scripts/generate-blog-audio.js)
 *
 * Audio is generated with OpenAI tts-1-hd, voice onyx, and stored in R2.
 * URLs are persisted in the blog_audio table.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const fetch = require('node-fetch'); // IMPORTANT: node-fetch v2.x, not native fetch
const FormData = require('form-data');

const BLOG_DIR = path.join(__dirname, '..', 'public', 'blog');

async function main() {
  const targetSlug = process.argv[2] || null;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const openaiKey  = process.env.OPENAI_API_KEY;
  const openaiBase = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const apiToken   = process.env.POLSIA_API_TOKEN;

  if (!openaiKey)       { console.error('ERROR: OPENAI_API_KEY not set'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }

  // Get blog post files
  let files = fs.readdirSync(BLOG_DIR)
    .filter(f => f.endsWith('.html') && f !== 'index.html')
    .sort();

  if (targetSlug) {
    files = files.filter(f => f === `${targetSlug}.html`);
    if (!files.length) {
      console.error(`No blog post found for slug: ${targetSlug}`);
      process.exit(1);
    }
  }

  console.log(`Processing ${files.length} blog post(s)...\n`);

  const results = [];

  for (const file of files) {
    const slug = file.replace('.html', '');
    process.stdout.write(`[${slug}] Extracting text... `);

    const html = fs.readFileSync(path.join(BLOG_DIR, file), 'utf8');
    const text = extractBlogText(html);

    if (!text || text.length < 50) {
      console.log('SKIP (text too short)');
      results.push({ slug, status: 'skipped' });
      continue;
    }

    console.log(`${text.length} chars`);
    process.stdout.write(`[${slug}] Calling TTS... `);

    // OpenAI TTS — split into chunks aimed at 3800 chars (safely under 4096 API limit)
    const chunks = splitIntoChunks(text, 3800);
    console.log(`\n[${slug}] Split into ${chunks.length} chunk(s):`, chunks.map(c => c.length));

    // Validate no chunk exceeds 3800 before making any API calls
    const oversized = chunks.filter(c => c.length > 3800);
    if (oversized.length) {
      console.error(`\n[${slug}] OVERSIZED CHUNKS — forcing word-boundary split`);
      chunks.length = 0;
      chunks.push(...splitIntoChunks(text, 3800));
    }

    const audioBuffers = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkLabel = chunks.length > 1 ? ` (chunk ${i + 1}/${chunks.length})` : '';
      process.stdout.write(`[${slug}] TTS request${chunkLabel} (${chunks[i].length} chars)... `);

      let ttsRes = await fetch(`${openaiBase}/audio/speech`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1-hd',
          input: chunks[i],
          voice: 'onyx',
          response_format: 'mp3',
        }),
      });

      if (!ttsRes.ok) {
        const errText = await ttsRes.text();
        // Retry once with smaller sub-chunks if this chunk appears too large
        if (chunks[i].length > 1500 && errText.includes('4096')) {
          console.log(`RETRY${chunkLabel} (${chunks[i].length} → re-splitting)`);
          const subChunks = splitIntoChunks(chunks[i], 1500);
          let subSuccess = true;
          for (let j = 0; j < subChunks.length; j++) {
            const subRes = await fetch(`${openaiBase}/audio/speech`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'tts-1-hd',
                input: subChunks[j],
                voice: 'onyx',
                response_format: 'mp3',
              }),
            });
            if (!subRes.ok) {
              const subErr = await subRes.text();
              console.log(`\n[${slug}] TTS RETRY FAIL: sub-chunk ${j + 1}: ${subRes.status} ${subErr.slice(0, 200)}`);
              subSuccess = false;
              break;
            }
            audioBuffers.push(Buffer.from(await subRes.arrayBuffer()));
          }
          if (subSuccess) {
            console.log(`OK (${audioBuffers.reduce((a, b) => a + b.length, 0)} bytes accumulated)`);
            continue;
          }
        }
        console.log(`\n[${slug}] TTS ERROR: ${ttsRes.status} ${errText.slice(0, 200)}`);
        results.push({ slug, status: 'tts_error' });
        break;
      }

      audioBuffers.push(Buffer.from(await ttsRes.arrayBuffer()));
      console.log(`OK`);
    }

    if (audioBuffers.length !== chunks.length) continue; // Error in chunk

    const audioBuffer = Buffer.concat(audioBuffers);
    console.log(` OK (${audioBuffer.length} bytes)`);

    // Upload to R2 via canonical proxy endpoint
    process.stdout.write(`[${slug}] Uploading to R2... `);
    const fileName = `blog-${slug}.mp3`;

    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: fileName, contentType: 'audio/mpeg' });

    const uploadRes = await fetch('https://polsia.com/api/proxy/r2/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        ...formData.getHeaders(), // CRITICAL: includes Content-Type with boundary
      },
      body: formData,
    });

    const uploadData = await uploadRes.json();

    if (!uploadData.success) {
      console.log(`\n[${slug}] R2 ERROR: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      results.push({ slug, status: 'upload_error' });
      continue;
    }

    const audioUrl = uploadData.file.url;

    console.log(`OK: ${audioUrl}`);

    // Save to DB
    process.stdout.write(`[${slug}] Saving to database... `);
    await pool.query(
      `INSERT INTO blog_audio (slug, audio_url, voice, updated_at)
       VALUES ($1, $2, 'onyx', NOW())
       ON CONFLICT (slug) DO UPDATE SET audio_url = $2, updated_at = NOW()`,
      [slug, audioUrl]
    );
    console.log('OK');

    results.push({ slug, status: 'success', audio_url: audioUrl });
  }

  await pool.end();

  console.log('\n── Summary ──────────────────────────────────────────────────');
  for (const r of results) {
    const icon = r.status === 'success' ? '✓' : r.status === 'skipped' ? '–' : '✗';
    console.log(`${icon} ${r.slug}: ${r.status}${r.audio_url ? ' → ' + r.audio_url : ''}`);
  }
  const ok = results.filter(r => r.status === 'success').length;
  console.log(`\n${ok}/${results.length} posts audio-generated successfully.`);
}

// ── Text extraction ──────────────────────────────────────────────────────────

function extractBlogText(html) {
  // Title from h1
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch
    ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  // Article body
  const bodyMatch = html.match(/<article[^>]*class="article-body"[^>]*>([\s\S]*?)<\/article>/i);
  if (!bodyMatch) return title;

  let body = bodyMatch[1];

  // Remove CTA sections, scripts, footnotes
  body = body.replace(/<div[^>]*class="cta-section"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<p[^>]*style="font-size:0\.875rem[\s\S]*?<\/p>/gi, '');

  // Strip tags
  body = body.replace(/<[^>]+>/g, ' ');

  // Decode entities
  body = body
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#\d+;/g, ' ');

  body = body.replace(/\s+/g, ' ').trim();

  return title ? `${title}. ${body}` : body;
}

// ── Chunk splitter (split at sentence boundary with safety net) ─────────────

/**
 * Split text into chunks at or below maxLen characters.
 * 1. Tries to split at ". " (sentence boundary)
 * 2. Falls back to nearest space (word boundary)
 * 3. Force-splits any chunk that still exceeds maxLen
 *
 * @param {string} text
 * @param {number} maxLen  — target max chars per chunk (e.g. 3800)
 * @returns {string[]}     — array of safe chunks
 */
function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Try sentence boundary first: ". " (period + space)
    let cutAt = remaining.lastIndexOf('. ', maxLen);
    // If no good sentence break within 60% of maxLen, use word boundary instead
    if (cutAt < maxLen * 0.6) {
      cutAt = remaining.lastIndexOf(' ', maxLen);
    }
    // Last resort: hard cut at maxLen
    if (cutAt <= 0) cutAt = maxLen;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  // Safety net: force-split any chunk that still exceeds maxLen
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxLen) return [chunk];
    const sub = [];
    let s = chunk;
    while (s.length > maxLen) {
      const cut = s.lastIndexOf(' ', maxLen);
      sub.push(s.slice(0, cut > 0 ? cut : maxLen));
      s = s.slice(cut > 0 ? cut : maxLen);
    }
    if (s) sub.push(s);
    return sub;
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
