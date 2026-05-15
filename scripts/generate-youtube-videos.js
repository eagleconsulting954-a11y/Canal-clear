#!/usr/bin/env node
/**
 * generate-youtube-videos.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates 1080p YouTube-ready MP4 files from CanalClear podcast audio.
 *
 * REQUIREMENTS (local machine only — do not run on Render):
 *   1. ffmpeg installed and in PATH
 *      - macOS:   brew install ffmpeg
 *      - Ubuntu:  sudo apt install ffmpeg
 *      - Windows: https://ffmpeg.org/download.html
 *   2. Node.js 18+
 *   3. DATABASE_URL env var set (to pull audio from DB) OR audio files
 *      downloaded to ./youtube-videos/audio/ manually.
 *
 * USAGE:
 *   node scripts/generate-youtube-videos.js
 *   node scripts/generate-youtube-videos.js --episode 1      # single episode
 *   node scripts/generate-youtube-videos.js --dry-run         # check ffmpeg, no output
 *   node scripts/generate-youtube-videos.js --no-db           # use pre-downloaded audio files
 *
 * OUTPUT:
 *   ./youtube-videos/mp4/episode-{N}.mp4   — 1920×1080 MP4, H.264 + AAC
 *   ./youtube-videos/thumbs/episode-{N}.png — 1920×1080 thumbnail PNG
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { execFileSync, execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Config ──────────────────────────────────────────────────────────────────

const YOUTUBE_CHANNEL = 'https://www.youtube.com/@CanalClear';
const SITE_URL        = 'https://canalclear.org';
const BRAND_PRIMARY   = '0x00D4AA';  // teal (ffmpeg hex format)
const BRAND_BG        = '0x0A1628';  // navy
const BRAND_ACCENT    = '0x1A2B45';  // slate
const LOGO_URL        = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/9d5d2ef6-d9e0-40eb-ad15-df5e737cefc1.png';

const OUT_DIR      = path.join(__dirname, '..', 'youtube-videos');
const AUDIO_DIR    = path.join(OUT_DIR, 'audio');
const MP4_DIR      = path.join(OUT_DIR, 'mp4');
const THUMBS_DIR   = path.join(OUT_DIR, 'thumbs');
const TEMP_DIR     = path.join(OUT_DIR, 'tmp');

// ── Episode data ─────────────────────────────────────────────────────────────

const EPISODES = [
  {
    num: 1, slug: 'episode-1', duration: 13,
    title: "Why Ships Get Stuck at the Panama Canal (And It's Not the Water Level)",
    desc: "The single most common reason ships miss their Panama Canal slots has nothing to do with water levels. It's paperwork. We break down the $65K/day cost of compliance errors and how fleet operators are fixing it.",
    pubDate: '2026-02-04',
  },
  {
    num: 2, slug: 'episode-2', duration: 13,
    title: 'The $2 Billion Paperwork Problem in Global Shipping',
    desc: 'Documentation errors cost the shipping industry $2-3 billion per year. But the real impact is what happens downstream: how one manifest conflict at a canal can stop an automotive assembly line halfway around the world.',
    pubDate: '2026-02-11',
  },
  {
    num: 3, slug: 'episode-3', duration: 13,
    title: 'VUMPA, PCSOPEP, and the Alphabet Soup of Canal Compliance',
    desc: "VUMPA. PCSOPEP. IMDG. DGD. ISM. We untangle the forms - and explain why getting the relationships between them wrong is more expensive than getting any single form wrong.",
    pubDate: '2026-02-18',
  },
  {
    num: 4, slug: 'episode-4', duration: 13,
    title: 'Ship Agents Are Charging You $5,000 for Something Software Can Do',
    desc: 'The traditional ship agent charges $2,000-$5,000 per Panama Canal transit to handle compliance paperwork. The actual labor cost of that work? $480-$860. We break down the economics.',
    pubDate: '2026-02-25',
  },
  {
    num: 5, slug: 'episode-5', duration: 13,
    title: 'Dangerous Goods, Lithium Batteries, and the Filings Nobody Gets Right',
    desc: '18-24% of vessels carrying dangerous goods encounter compliance issues at the Panama Canal. Lithium batteries alone account for 45% of hazmat declaration conflicts.',
    pubDate: '2026-03-04',
  },
  {
    num: 6, slug: 'episode-6', duration: 12,
    title: 'Why Global Shipping Is Still Running on Fax Machines and Excel',
    desc: '25% of cargo owners still use email as their primary shipping tool. The industry moving $2.5 trillion in annual trade processes 80% of documentation manually.',
    pubDate: '2026-03-11',
  },
  {
    num: 7, slug: 'episode-7', duration: 13,
    title: 'Panama vs Suez: Two Canals, Two Compliance Nightmares',
    desc: "Panama Canal and Suez Canal together handle ~25% of world maritime traffic. Their compliance regimes couldn't be more different.",
    pubDate: '2026-03-18',
  },
  {
    num: 8, slug: 'episode-8', duration: 12,
    title: 'The Hidden Cost of Port State Control Inspections',
    desc: 'PSC inspectors detain about 150 vessels per year at $30,000-$50,000 per day. 87% of detentions are preventable with a single pre-arrival audit.',
    pubDate: '2026-03-25',
  },
  {
    num: 9, slug: 'episode-9', duration: 13,
    title: 'Red Sea Diversions and the Compliance Chaos They Create',
    desc: 'When geopolitics forces a reroute, compliance cascades immediately: new port jurisdictions, new documentation requirements, insurance policy gaps.',
    pubDate: '2026-04-01',
  },
  {
    num: 10, slug: 'episode-10', duration: 12,
    title: 'The Future of Maritime Compliance: AI, Blockchain, and What Actually Works',
    desc: "Every conference has a blockchain panel. Most of it is hype. Here's what's actually working today, what's 5-10 years away, and what to invest in for 2026.",
    pubDate: '2026-04-08',
  },
  {
    num: 14, slug: 'episode-14', duration: 10,
    title: 'Ship Agent vs Software: The Future of Panama Canal Compliance',
    desc: 'Traditional ship agents charge $2,000-$5,000 per transit for compliance work. CanalClear automates the data-entry layer. We look at what each does best.',
    pubDate: '2026-04-15',
  },
  {
    num: 15, slug: 'episode-15', duration: 10,
    title: 'Panama Canal Shipping Costs Breakdown - Where Your Money Actually Goes',
    desc: 'Canal tolls, booking fees, tugboat charges, pilot fees, agent fees, and penalties. A full breakdown of every cost layer in a Panama Canal transit.',
    pubDate: '2026-04-22',
  },
];

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const NO_DB      = args.includes('--no-db');
const EP_ARG     = (() => {
  const idx = args.indexOf('--episode');
  return idx >= 0 ? parseInt(args[idx + 1], 10) : null;
})();

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[youtube-gen] ${msg}`); }
function warn(msg) { console.warn(`[youtube-gen] ⚠️  ${msg}`); }
function fatal(msg) { console.error(`[youtube-gen] ❌  ${msg}`); process.exit(1); }

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function checkFFmpeg() {
  try {
    const result = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    if (result.status !== 0) fatal('ffmpeg not found. Install: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)');
    const version = (result.stdout || '').split('\n')[0];
    log(`ffmpeg found: ${version}`);
  } catch (e) {
    fatal('ffmpeg not found. Install: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)');
  }
}

/** Wrap text to max `width` chars, returning array of lines */
function wrapText(text, width) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= width) {
      current = (current + ' ' + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Escape text for ffmpeg drawtext filter */
function ffEsc(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,');
}

// ── Generate thumbnail PNG (no audio needed) ─────────────────────────────────

function generateThumbnail(ep, outPath) {
  const titleLines  = wrapText(ep.title, 36);
  const epLabel     = `EP ${String(ep.num).padStart(2, '0')}`;
  const durationStr = `${ep.duration} min`;
  const siteLabel   = 'canalclear.org/podcast';

  // Build drawtext filter chain
  const filters = [];

  // Background gradient (dark navy → slightly lighter)
  // Use lavfi color source
  const bgFilter = `color=c=0x0A1628:size=1920x1080:rate=1[bg]`;

  // Teal accent bar on left edge
  const accentBarFilter = `[bg]drawbox=x=0:y=0:w=8:h=1080:color=0x00D4AA:t=fill[bg2]`;

  // Subtle grid overlay (horizontal lines every 180px)
  const gridFilter = `[bg2]drawgrid=x=0:y=0:width=96:height=96:color=0x1A2B45@0.3:t=1[bg3]`;

  // Episode number badge
  const epBadgeBoxFilter = `[bg3]drawbox=x=120:y=120:w=160:h=52:color=0x00D4AA@0.15:t=fill[bg4]`;
  const epBadgeBorderFilter = `[bg4]drawbox=x=120:y=120:w=160:h=52:color=0x00D4AA:t=2[bg5]`;
  const epLabelFilter = `[bg5]drawtext=text='${ffEsc(epLabel)}':x=200:y=146:fontcolor=0x00D4AA:fontsize=28:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:anchor=tc[bg6]`;

  // Duration badge
  const durBoxFilter = `[bg6]drawbox=x=300:y=120:w=140:h=52:color=0x1A2B45:t=fill[bg7]`;
  const durBorderFilter = `[bg7]drawbox=x=300:y=120:w=140:h=52:color=0x1A2B45:t=1[bg8]`;
  const durTextFilter = `[bg8]drawtext=text='${ffEsc(durationStr)}':x=370:y=146:fontcolor=0x8899AA:fontsize=22:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:anchor=tc[bg9]`;

  // Title lines (up to 3 lines, large font)
  let titleFilter = 'bg9';
  titleLines.slice(0, 3).forEach((line, i) => {
    const yPos = 280 + i * 90;
    titleFilter = `[${titleFilter}]drawtext=text='${ffEsc(line)}':x=120:y=${yPos}:fontcolor=0xF0F4F8:fontsize=62:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[t${i}]`;
    if (i < titleLines.slice(0, 3).length - 1) titleFilter = `t${i}`;
    else titleFilter = `[t${i}]`;
  });
  // flatten last title step
  let lastTitleTag = `t${Math.min(2, titleLines.length - 1)}`;

  // Separator line
  const sepFilter = `[${lastTitleTag}]drawbox=x=120:y=600:w=600:h=3:color=0x00D4AA:t=fill[sep]`;

  // Site label at bottom
  const siteFilter = `[sep]drawtext=text='${ffEsc(siteLabel)}':x=120:y=960:fontcolor=0x8899AA:fontsize=28:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf[site]`;

  // "Clear Passage" podcast name
  const podcastFilter = `[site]drawtext=text='Clear Passage Podcast':x=120:y=660:fontcolor=0x00D4AA:fontsize=32:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[final]`;

  // Build full filter_complex
  const filterComplex = [
    bgFilter,
    accentBarFilter,
    gridFilter,
    epBadgeBoxFilter,
    epBadgeBorderFilter,
    epLabelFilter,
    durBoxFilter,
    durBorderFilter,
    durTextFilter,
    ...titleLines.slice(0, 3).map((line, i) => {
      const yPos = 280 + i * 90;
      const inTag = i === 0 ? '[bg9]' : `[t${i-1}]`;
      return `${inTag}drawtext=text='${ffEsc(line)}':x=120:y=${yPos}:fontcolor=0xF0F4F8:fontsize=62:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[t${i}]`;
    }),
    `[t${Math.min(2, titleLines.length - 1)}]drawbox=x=120:y=600:w=600:h=3:color=0x00D4AA:t=fill[sep]`,
    `[sep]drawtext=text='Clear Passage Podcast':x=120:y=640:fontcolor=0x00D4AA:fontsize=32:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf[cp]`,
    `[cp]drawtext=text='${ffEsc(siteLabel)}':x=120:y=960:fontcolor=0x8899AA:fontsize=28:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf[final]`,
  ].join(';');

  const cmd = [
    'ffmpeg', '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x0A1628:size=1920x1080:rate=1`,
    '-vf', buildDrawtextFilters(ep),
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ];

  log(`  Generating thumbnail: ${path.basename(outPath)}`);
  const result = spawnSync('ffmpeg', cmd.slice(1), { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    warn(`  Thumbnail generation failed for EP ${ep.num}: ${result.stderr.slice(0, 300)}`);
    return false;
  }
  return true;
}

/** Build a simpler single-pass drawtext filter for the thumbnail */
function buildDrawtextFilters(ep) {
  const titleLines = wrapText(ep.title, 32);
  const epLabel    = `EP ${String(ep.num).padStart(2, '0')}`;
  const fontBold   = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const fontReg    = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
  const fallbackFont = 'monospace';

  // Check if font exists, use fallback
  const useFontBold = fs.existsSync(fontBold) ? `fontfile=${fontBold}` : `font=Sans`;
  const useFontReg  = fs.existsSync(fontReg)  ? `fontfile=${fontReg}`  : `font=Sans`;

  const filters = [];

  // Left accent bar
  filters.push(`drawbox=x=0:y=0:w=8:h=1080:color=0x00D4AA:t=fill`);

  // Episode badge background
  filters.push(`drawbox=x=120:y=100:w=180:h=58:color=0x00D4AA@0.2:t=fill`);
  filters.push(`drawbox=x=120:y=100:w=180:h=58:color=0x00D4AA:t=2`);

  // Episode number
  filters.push(`drawtext=text='${ffEsc(epLabel)}':x=210:y=129:fontcolor=0x00D4AA:fontsize=30:${useFontBold}:anchor=tc`);

  // Duration
  filters.push(`drawtext=text='${ep.duration} min':x=360:y=129:fontcolor=0x8899AA:fontsize=24:${useFontReg}:anchor=tc`);

  // Title lines
  titleLines.slice(0, 3).forEach((line, i) => {
    filters.push(`drawtext=text='${ffEsc(line)}':x=120:y=${260 + i * 80}:fontcolor=0xF0F4F8:fontsize=58:${useFontBold}`);
  });

  // Separator
  filters.push(`drawbox=x=120:y=${260 + Math.min(3, titleLines.length) * 80 + 20}:w=560:h=3:color=0x00D4AA:t=fill`);

  // Podcast name
  filters.push(`drawtext=text='Clear Passage — CanalClear Podcast':x=120:y=${260 + Math.min(3, titleLines.length) * 80 + 45}:fontcolor=0x00D4AA:fontsize=28:${useFontBold}`);

  // Site URL
  filters.push(`drawtext=text='canalclear.org/podcast':x=120:y=1000:fontcolor=0x8899AA:fontsize=24:${useFontReg}`);

  return filters.join(',');
}

// ── Generate video MP4 from audio file ──────────────────────────────────────

function generateVideo(ep, audioPath, thumbPath, outPath) {
  log(`  Generating video: ${path.basename(outPath)}`);

  const vfFilters = buildDrawtextFilters(ep);

  // Strategy: loop still image + overlay text, mux with audio
  const cmd = [
    '-y',
    '-loop', '1',
    '-f', 'lavfi', '-i', `color=c=0x0A1628:size=1920x1080:rate=25`,
    '-i', audioPath,
    '-vf', vfFilters,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-tune', 'stillimage',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-shortest',
    outPath,
  ];

  const result = spawnSync('ffmpeg', cmd, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 600000, // 10 minutes per episode
  });

  if (result.status !== 0) {
    warn(`  Video generation failed for EP ${ep.num}:\n${(result.stderr || '').slice(-500)}`);
    return false;
  }

  const stats = fs.statSync(outPath);
  log(`  ✅  EP ${ep.num} → ${path.basename(outPath)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  return true;
}

// ── Pull audio from DB ───────────────────────────────────────────────────────

async function pullAudioFromDB(ep, destPath) {
  if (!process.env.DATABASE_URL) {
    warn(`DATABASE_URL not set — cannot pull audio from DB for EP ${ep.num}`);
    return false;
  }

  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    const { rows } = await pool.query(
      'SELECT audio_data, audio_url FROM podcast_audio WHERE slug = $1',
      [ep.slug]
    );
    await pool.end();

    if (!rows.length) {
      warn(`No DB audio found for ${ep.slug}`);
      return false;
    }

    const row = rows[0];

    if (row.audio_data && row.audio_data.length > 1000) {
      fs.writeFileSync(destPath, row.audio_data);
      log(`  Pulled ${(row.audio_data.length / 1024).toFixed(0)}KB from DB for ${ep.slug}`);
      return true;
    }

    if (row.audio_url && row.audio_url.startsWith('http')) {
      log(`  Downloading audio from ${row.audio_url}`);
      return await downloadFile(row.audio_url, destPath);
    }

    warn(`Audio for ${ep.slug} is stored as relative URL: ${row.audio_url}. Download manually to ${AUDIO_DIR}/${ep.slug}.mp3`);
    return false;
  } catch (e) {
    warn(`DB pull failed for ${ep.slug}: ${e.message}`);
    return false;
  }
}

async function downloadFile(url, dest) {
  try {
    const res = await fetch(url);
    if (!res.ok) { warn(`Download failed: ${url} → ${res.status}`); return false; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
    log(`  Downloaded ${(buf.length / 1024).toFixed(0)}KB`);
    return true;
  } catch (e) {
    warn(`Download error: ${e.message}`);
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('CanalClear YouTube Video Generator');
  log('====================================');

  checkFFmpeg();
  if (DRY_RUN) { log('Dry run — ffmpeg OK. Exiting.'); return; }

  ensureDir(OUT_DIR);
  ensureDir(AUDIO_DIR);
  ensureDir(MP4_DIR);
  ensureDir(THUMBS_DIR);
  ensureDir(TEMP_DIR);

  const episodes = EP_ARG
    ? EPISODES.filter(e => e.num === EP_ARG)
    : EPISODES;

  if (!episodes.length) { fatal(`Episode ${EP_ARG} not found.`); }

  log(`\nProcessing ${episodes.length} episode(s)...\n`);

  let success = 0, skipped = 0, failed = 0;

  for (const ep of episodes) {
    log(`─── EP ${String(ep.num).padStart(2, '0')}: ${ep.title.slice(0, 60)}...`);

    const audioPath = path.join(AUDIO_DIR, `${ep.slug}.mp3`);
    const thumbPath = path.join(THUMBS_DIR, `${ep.slug}.png`);
    const mp4Path   = path.join(MP4_DIR, `${ep.slug}.mp4`);

    // Skip if already generated
    if (fs.existsSync(mp4Path)) {
      const stats = fs.statSync(mp4Path);
      if (stats.size > 100000) {
        log(`  ⏭️  Already exists (${(stats.size/1024/1024).toFixed(1)} MB) — skipping`);
        skipped++;
        continue;
      }
    }

    // Get audio
    let audioOk = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000;
    if (!audioOk && !NO_DB) {
      audioOk = await pullAudioFromDB(ep, audioPath);
    }

    if (!audioOk) {
      warn(`  No audio available for EP ${ep.num}. Place audio at: ${audioPath}`);
      failed++;
      continue;
    }

    // Generate thumbnail
    generateThumbnail(ep, thumbPath);

    // Generate video
    const ok = generateVideo(ep, audioPath, thumbPath, mp4Path);
    if (ok) success++; else failed++;

    log('');
  }

  log('\n====================================');
  log(`Done: ${success} generated, ${skipped} skipped, ${failed} failed`);
  log(`Output directory: ${MP4_DIR}`);
  log('');
  log('Next steps:');
  log('  1. Review videos in youtube-videos/mp4/');
  log('  2. Upload to https://studio.youtube.com');
  log('  3. Use titles/descriptions from public/data/youtube-metadata.json');
  log('  4. Update episode YouTube links in public/podcast/youtube.html');
  log('');
}

main().catch(e => { console.error(e); process.exit(1); });
