/**
 * generate-per-page-og.js
 *
 * Generates a unique 1200×630 OG image for every page:
 *  - Homepage (/)
 *  - Blog index (/blog)
 *  - Every individual blog post (/blog/*)
 *
 * Each image has the cluster-appropriate gradient background with the
 * page title rendered as centered white text via SVG overlay (sharp).
 * Images are saved to public/images/og/<slug>.png.
 *
 * Run: node scripts/generate-per-page-og.js
 */
'use strict';

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const WIDTH = 1200;
const HEIGHT = 630;
const BLOG_DIR = path.join(__dirname, '../public/blog');
const PUBLIC_DIR = path.join(__dirname, '../public');
const OG_DIR = path.join(PUBLIC_DIR, 'images/og');

// ── Cluster color definitions (same as generate-og-images.js) ─────────────────

const CLUSTERS = {
  'panama-vumpa': {
    top:    [8, 22, 45],
    bottom: [14, 38, 80],
    accent: [0, 164, 154],
  },
  'pcsopep': {
    top:    [6, 30, 20],
    bottom: [12, 55, 38],
    accent: [0, 196, 120],
  },
  'suez-sca': {
    top:    [30, 22, 8],
    bottom: [60, 42, 14],
    accent: [218, 165, 32],
  },
  'compliance-costs': {
    top:    [40, 8, 8],
    bottom: [70, 14, 14],
    accent: [220, 60, 60],
  },
  'lng-tanker': {
    top:    [8, 18, 45],
    bottom: [8, 36, 90],
    accent: [80, 160, 240],
  },
  'general-maritime': {
    top:    [8, 25, 47],
    bottom: [15, 50, 90],
    accent: [30, 140, 200],
  },
  'product': {
    top:    [5, 18, 40],
    bottom: [12, 38, 85],
    accent: [0, 200, 185],
  },
};

// ── Cluster assignment (same logic as generate-og-images.js) ──────────────────

function getCluster(slug) {
  if (slug.startsWith('suez-')) return 'suez-sca';
  if (slug.includes('pcsopep')) return 'pcsopep';
  if (slug.includes('vumpa')) return 'panama-vumpa';
  if (slug.includes('lng') || slug.includes('tanker')) return 'lng-tanker';
  if (slug.includes('non-compliance') || slug.includes('cost') || slug.includes('penalt') || slug.includes('fine')) return 'compliance-costs';
  if (slug.startsWith('panama-') || slug.includes('panama') || slug.includes('acp')) return 'panama-vumpa';
  return 'general-maritime';
}

// ── Extract og:title from HTML file ───────────────────────────────────────────

function extractOgTitle(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  // Try og:title first
  const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (ogMatch) return ogMatch[1];
  // Fallback to <title>
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) return titleMatch[1].replace(/\s*\|\s*CanalClear.*$/i, '').trim();
  return null;
}

// ── SVG text wrapping ─────────────────────────────────────────────────────────

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Wrap text into lines that fit within maxWidth at the given fontSize.
 * Approximate: assumes ~0.55 em per character for sans-serif at the given size.
 */
function wrapText(text, fontSize, maxWidth) {
  const charWidth = fontSize * 0.52;
  const maxCharsPerLine = Math.floor(maxWidth / charWidth);
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (testLine.length > maxCharsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ── Generate OG image as PNG buffer ───────────────────────────────────────────

async function generateOgImage(title, clusterKey, subtitle) {
  const cluster = CLUSTERS[clusterKey];
  const [tr, tg, tb] = cluster.top;
  const [br, bg, bb] = cluster.bottom;
  const [ar, ag, ab] = cluster.accent;

  // Determine font size based on title length
  let fontSize = 48;
  if (title.length > 60) fontSize = 40;
  if (title.length > 90) fontSize = 34;
  if (title.length > 120) fontSize = 30;

  const lineHeight = fontSize * 1.35;
  const maxTextWidth = WIDTH - 160; // 80px padding each side
  const lines = wrapText(title, fontSize, maxTextWidth);

  // Calculate vertical positioning
  const totalTextHeight = lines.length * lineHeight;
  const titleStartY = (HEIGHT - totalTextHeight) / 2 + fontSize * 0.35;

  // Build title tspans
  const titleTspans = lines.map((line, i) => {
    const y = titleStartY + i * lineHeight;
    return `<text x="${WIDTH / 2}" y="${y}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="white" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`;
  }).join('\n    ');

  // Subtitle (blog URL or tagline) at bottom
  const subtitleText = subtitle || 'canalclear.org';
  const subtitleY = HEIGHT - 50;

  // Brand name at top
  const brandY = 55;

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgb(${tr},${tg},${tb})" />
      <stop offset="92%" stop-color="rgb(${br},${bg},${bb})" />
      <stop offset="100%" stop-color="rgb(${ar},${ag},${ab})" />
    </linearGradient>
  </defs>

  <!-- Background gradient -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />

  <!-- Accent bar at bottom -->
  <rect x="0" y="${HEIGHT - 8}" width="${WIDTH}" height="8" fill="rgb(${ar},${ag},${ab})" />

  <!-- Subtle horizontal line separators -->
  <line x1="80" y1="${brandY + 25}" x2="${WIDTH - 80}" y2="${brandY + 25}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
  <line x1="80" y1="${subtitleY - 25}" x2="${WIDTH - 80}" y2="${subtitleY - 25}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

  <!-- Brand name -->
  <text x="${WIDTH / 2}" y="${brandY}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="22" font-weight="600" fill="rgb(${ar},${ag},${ab})" text-anchor="middle" letter-spacing="3">${escapeXml('CANALCLEAR')}</text>

  <!-- Title text -->
  ${titleTspans}

  <!-- Subtitle / URL -->
  <text x="${WIDTH / 2}" y="${subtitleY}" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="18" font-weight="400" fill="rgba(255,255,255,0.6)" text-anchor="middle">${escapeXml(subtitleText)}</text>
</svg>`;

  return sharp(Buffer.from(svg))
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// ── Update og:image + twitter:image + add dimensions in HTML ──────────────────

function updateHtmlOgImage(filePath, newUrl) {
  let html = fs.readFileSync(filePath, 'utf8');
  const before = html;

  // Replace og:image content
  html = html.replace(
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/gi,
    `<meta property="og:image" content="${newUrl}">`
  );

  // Also replace twitter:image
  html = html.replace(
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/gi,
    `<meta name="twitter:image" content="${newUrl}">`
  );

  // Add og:image:width and og:image:height if not present
  if (!html.includes('og:image:width')) {
    html = html.replace(
      /(<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>)/i,
      `$1\n    <meta property="og:image:width" content="1200">\n    <meta property="og:image:height" content="630">`
    );
  }

  if (html !== before) {
    fs.writeFileSync(filePath, html, 'utf8');
    return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Ensure output directory exists
  fs.mkdirSync(OG_DIR, { recursive: true });

  const results = { generated: 0, updated: 0, errors: [] };

  // 1. Homepage
  console.log('[og] Generating homepage OG image...');
  const homepagePath = path.join(PUBLIC_DIR, 'index.html');
  const homepageTitle = extractOgTitle(homepagePath) || 'Panama Canal Compliance Software';
  try {
    const buf = await generateOgImage(homepageTitle, 'product', 'AI-Powered Canal Compliance · canalclear.org');
    const ogPath = path.join(OG_DIR, 'homepage.png');
    fs.writeFileSync(ogPath, buf);
    updateHtmlOgImage(homepagePath, 'https://canal-clear.polsia.app/images/og/homepage.png');
    results.generated++;
    results.updated++;
    console.log(`  ✓ homepage.png (${(buf.length / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(`  ✗ homepage: ${err.message}`);
    results.errors.push({ slug: 'homepage', error: err.message });
  }

  // 2. Blog index
  const blogIndexPath = path.join(BLOG_DIR, 'index.html');
  if (fs.existsSync(blogIndexPath)) {
    console.log('[og] Generating blog index OG image...');
    const blogIndexTitle = extractOgTitle(blogIndexPath) || 'CanalClear Blog — Maritime Compliance Insights';
    try {
      const buf = await generateOgImage(blogIndexTitle, 'general-maritime', 'Expert Guides & Analysis · canalclear.org/blog');
      const ogPath = path.join(OG_DIR, 'blog-index.png');
      fs.writeFileSync(ogPath, buf);
      updateHtmlOgImage(blogIndexPath, 'https://canal-clear.polsia.app/images/og/blog-index.png');
      results.generated++;
      results.updated++;
      console.log(`  ✓ blog-index.png (${(buf.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`  ✗ blog-index: ${err.message}`);
      results.errors.push({ slug: 'blog-index', error: err.message });
    }
  }

  // 3. All blog posts
  console.log('[og] Generating blog post OG images...');
  const blogFiles = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');
  console.log(`  Found ${blogFiles.length} blog posts`);

  for (const file of blogFiles) {
    const slug = file.replace('.html', '');
    const filePath = path.join(BLOG_DIR, file);
    const title = extractOgTitle(filePath);

    if (!title) {
      console.log(`  - ${slug}: no title found, skipping`);
      continue;
    }

    const cluster = getCluster(slug);

    try {
      const buf = await generateOgImage(title, cluster, `canalclear.org/blog/${slug}`);
      const ogPath = path.join(OG_DIR, `${slug}.png`);
      fs.writeFileSync(ogPath, buf);
      updateHtmlOgImage(filePath, `https://canal-clear.polsia.app/images/og/${slug}.png`);
      results.generated++;
      results.updated++;
      console.log(`  ✓ ${slug}.png (${(buf.length / 1024).toFixed(1)} KB) [${cluster}]`);
    } catch (err) {
      console.error(`  ✗ ${slug}: ${err.message}`);
      results.errors.push({ slug, error: err.message });
    }
  }

  // Summary
  console.log(`\n[og] Done!`);
  console.log(`  Generated: ${results.generated} images`);
  console.log(`  Updated:   ${results.updated} HTML files`);
  if (results.errors.length > 0) {
    console.log(`  Errors:    ${results.errors.length}`);
    for (const err of results.errors) {
      console.log(`    - ${err.slug}: ${err.error}`);
    }
  }

  // Save the mapping for reference
  const mapping = {};
  mapping['homepage'] = 'https://canal-clear.polsia.app/images/og/homepage.png';
  if (fs.existsSync(blogIndexPath)) {
    mapping['blog-index'] = 'https://canal-clear.polsia.app/images/og/blog-index.png';
  }
  for (const file of blogFiles) {
    const slug = file.replace('.html', '');
    mapping[slug] = `https://canal-clear.polsia.app/images/og/${slug}.png`;
  }
  fs.writeFileSync(
    path.join(__dirname, 'og-page-urls.json'),
    JSON.stringify(mapping, null, 2),
    'utf8'
  );
  console.log('[og] URL mapping saved to scripts/og-page-urls.json');
}

main().catch(err => {
  console.error('[og] FATAL:', err.message);
  process.exit(1);
});
