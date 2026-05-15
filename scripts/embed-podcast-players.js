#!/usr/bin/env node
/**
 * scripts/embed-podcast-players.js
 *
 * Injects podcast embed widgets into:
 *   1. All blog posts → inline player card + Related Episodes section
 *   2. All podcast episode pages → Related Blog Posts section
 *
 * Idempotent: checks for existing markers before inserting.
 * Run: node scripts/embed-podcast-players.js
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '../public/blog');
const POD_DIR  = path.join(__dirname, '../public/podcast');

// ── Episode metadata ──────────────────────────────────────────────────────
const EPISODES = {
  'episode-1':  { num: 1,  title: 'Why Ships Get Stuck at the Panama Canal (And It\'s Not the Water Level)', duration: 13 },
  'episode-2':  { num: 2,  title: 'The $2 Billion Paperwork Problem in Global Shipping',                      duration: 13 },
  'episode-3':  { num: 3,  title: 'VUMPA, PCSOPEP, and the Alphabet Soup of Canal Compliance',               duration: 13 },
  'episode-4':  { num: 4,  title: 'Ship Agents Are Charging You $5,000 for Something Software Can Do',        duration: 13 },
  'episode-5':  { num: 5,  title: 'Dangerous Goods, Lithium Batteries, and the Filings Nobody Gets Right',   duration: 13 },
  'episode-6':  { num: 6,  title: 'Why Global Shipping Is Still Running on Fax Machines and Excel',          duration: 12 },
  'episode-7':  { num: 7,  title: 'Panama vs Suez: Two Canals, Two Compliance Nightmares',                   duration: 13 },
  'episode-8':  { num: 8,  title: 'The Hidden Cost of Port State Control Inspections',                       duration: 12 },
  'episode-9':  { num: 9,  title: 'Red Sea Diversions and the Compliance Chaos They Create',                 duration: 13 },
  'episode-10': { num: 10, title: 'The Future of Maritime Compliance: AI, Blockchain, and What Actually Works', duration: 12 },
  'episode-14': { num: 14, title: 'Ship Agent vs Software: The Future of Panama Canal Compliance',           duration: 10 },
  'episode-15': { num: 15, title: 'Panama Canal Shipping Costs Breakdown — Where Your Money Actually Goes',  duration: 10 },
};

// ── Blog post metadata ────────────────────────────────────────────────────
const BLOG_POSTS = {
  'how-to-avoid-panama-canal-compliance-fines-in-2026': {
    title: 'How to Avoid Panama Canal Compliance Fines in 2026',
  },
  'how-to-file-pcsopep-panama-canal': {
    title: 'How to File PCSOPEP for Panama Canal Transit',
  },
  'how-to-file-vumpa-panama-canal': {
    title: 'How to File VUMPA for Panama Canal Transit — Step-by-Step',
  },
  'how-to-reduce-shipping-delays': {
    title: 'How to Reduce Shipping Delays at the Panama Canal',
  },
  'marpol-compliance-checklist-ship-operators-2026': {
    title: 'MARPOL Compliance Checklist for Ship Operators 2026',
  },
  'panama-canal-compliance-checklist-2026': {
    title: 'Panama Canal Compliance Checklist 2026: Complete Pre-Transit Guide',
  },
  'panama-canal-compliance-checklist-fleet-operators': {
    title: 'Panama Canal Compliance Checklist for Fleet Operators',
  },
  'panama-canal-compliance-complete-guide-2026': {
    title: 'Panama Canal Compliance Complete Guide 2026',
  },
  'panama-canal-transit-documents-required': {
    title: 'What Documents Do You Need for Panama Canal Transit?',
  },
  'panama-canal-vumpa-requirements-2026': {
    title: 'Panama Canal VUMPA Requirements 2026',
  },
  'pcsopep-documentation-complete-guide': {
    title: 'PCSOPEP Documentation: Complete Guide',
  },
  'pcsopep-requirements-2026': {
    title: 'PCSOPEP Requirements 2026',
  },
  'pcsopep-requirements-panama-canal': {
    title: 'PCSOPEP Requirements for Panama Canal Transit',
  },
  'true-cost-of-non-compliance-global-shipping': {
    title: 'The True Cost of Non-Compliance in Global Shipping',
  },
  'vessel-readiness-inspection-panama-canal': {
    title: 'Vessel Readiness Inspection at the Panama Canal',
  },
  'vumpa-digital-submission-guide-2026': {
    title: 'VUMPA Digital Submission Guide 2026',
  },
  'vumpa-filing-requirements-step-by-step': {
    title: 'VUMPA Filing Requirements: Step-by-Step',
  },
  'what-is-port-state-control': {
    title: 'What Is Port State Control? A Ship Operator\'s Guide',
  },
  'why-ai-is-the-future-of-panama-canal-compliance': {
    title: 'Why AI Is the Future of Panama Canal Compliance',
  },
};

// ── Blog → Episode mapping ────────────────────────────────────────────────
// primary: slug shown as inline player
// related: 2-3 episodes listed in "Related Podcast Episodes" section
const BLOG_TO_EPISODES = {
  'how-to-avoid-panama-canal-compliance-fines-in-2026': {
    primary: 'episode-1',
    related: ['episode-1', 'episode-3', 'episode-2'],
  },
  'how-to-file-pcsopep-panama-canal': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-5', 'episode-8'],
  },
  'how-to-file-vumpa-panama-canal': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-6'],
  },
  'how-to-reduce-shipping-delays': {
    primary: 'episode-1',
    related: ['episode-1', 'episode-6', 'episode-9'],
  },
  'marpol-compliance-checklist-ship-operators-2026': {
    primary: 'episode-5',
    related: ['episode-5', 'episode-8', 'episode-3'],
  },
  'panama-canal-compliance-checklist-2026': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-4'],
  },
  'panama-canal-compliance-checklist-fleet-operators': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-4', 'episode-1'],
  },
  'panama-canal-compliance-complete-guide-2026': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-4'],
  },
  'panama-canal-transit-documents-required': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-14'],
  },
  'panama-canal-vumpa-requirements-2026': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-4'],
  },
  'pcsopep-documentation-complete-guide': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-5', 'episode-8'],
  },
  'pcsopep-requirements-2026': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-5', 'episode-1'],
  },
  'pcsopep-requirements-panama-canal': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-5', 'episode-8'],
  },
  'true-cost-of-non-compliance-global-shipping': {
    primary: 'episode-2',
    related: ['episode-2', 'episode-1', 'episode-8'],
  },
  'vessel-readiness-inspection-panama-canal': {
    primary: 'episode-8',
    related: ['episode-8', 'episode-1', 'episode-3'],
  },
  'vumpa-digital-submission-guide-2026': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-6', 'episode-1'],
  },
  'vumpa-filing-requirements-step-by-step': {
    primary: 'episode-3',
    related: ['episode-3', 'episode-1', 'episode-6'],
  },
  'what-is-port-state-control': {
    primary: 'episode-8',
    related: ['episode-8', 'episode-2', 'episode-7'],
  },
  'why-ai-is-the-future-of-panama-canal-compliance': {
    primary: 'episode-10',
    related: ['episode-10', 'episode-4', 'episode-14'],
  },
};

// ── Episode → Blog mapping ────────────────────────────────────────────────
// 2-3 blog posts listed in "Related Blog Posts" on episode page
const EPISODE_TO_BLOGS = {
  'episode-1':  ['panama-canal-compliance-checklist-2026', 'how-to-avoid-panama-canal-compliance-fines-in-2026', 'how-to-reduce-shipping-delays'],
  'episode-2':  ['true-cost-of-non-compliance-global-shipping', 'what-is-port-state-control', 'panama-canal-compliance-complete-guide-2026'],
  'episode-3':  ['how-to-file-pcsopep-panama-canal', 'how-to-file-vumpa-panama-canal', 'panama-canal-vumpa-requirements-2026'],
  'episode-4':  ['panama-canal-compliance-checklist-fleet-operators', 'why-ai-is-the-future-of-panama-canal-compliance', 'panama-canal-compliance-complete-guide-2026'],
  'episode-5':  ['marpol-compliance-checklist-ship-operators-2026', 'pcsopep-requirements-panama-canal', 'pcsopep-documentation-complete-guide'],
  'episode-6':  ['how-to-reduce-shipping-delays', 'vumpa-digital-submission-guide-2026', 'vumpa-filing-requirements-step-by-step'],
  'episode-7':  ['what-is-port-state-control', 'panama-canal-compliance-complete-guide-2026', 'panama-canal-vumpa-requirements-2026'],
  'episode-8':  ['vessel-readiness-inspection-panama-canal', 'what-is-port-state-control', 'true-cost-of-non-compliance-global-shipping'],
  'episode-9':  ['how-to-reduce-shipping-delays', 'panama-canal-compliance-complete-guide-2026', 'panama-canal-transit-documents-required'],
  'episode-10': ['why-ai-is-the-future-of-panama-canal-compliance', 'panama-canal-compliance-complete-guide-2026', 'how-to-avoid-panama-canal-compliance-fines-in-2026'],
  'episode-14': ['why-ai-is-the-future-of-panama-canal-compliance', 'panama-canal-transit-documents-required', 'panama-canal-compliance-checklist-fleet-operators'],
  'episode-15': ['true-cost-of-non-compliance-global-shipping', 'panama-canal-compliance-complete-guide-2026', 'panama-canal-compliance-checklist-2026'],
};

// ── HTML builders ─────────────────────────────────────────────────────────

function buildInlineCard(epSlug) {
  const ep = EPISODES[epSlug];
  if (!ep) return '';
  const title = ep.title.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
  return `
<!-- PODCAST_EMBED_CARD -->
<div class="podcast-embed-card" data-ep-slug="${epSlug}">
  <button class="podcast-embed-play-btn" aria-label="Play">&#9654;</button>
  <div class="podcast-embed-info">
    <div class="podcast-embed-label"
         data-i18n-en="🎧 Listen to this topic"
         data-i18n-es="🎧 Escucha este tema"
         data-i18n-zh="🎧 收听此主题"
         data-i18n-el="🎧 Ακούστε αυτό το θέμα"
         data-i18n-ja="🎧 このトピックを聴く">🎧 Listen to this topic</div>
    <div class="podcast-embed-title">${ep.title}</div>
    <div class="podcast-embed-meta">Clear Passage &middot; Ep. ${ep.num} &middot; ${ep.duration} min</div>
  </div>
  <div class="podcast-embed-progress-wrap">
    <div class="podcast-embed-bar-wrap">
      <div class="podcast-embed-bar-fill"></div>
    </div>
    <div class="podcast-embed-time">0:00</div>
  </div>
  <a href="/podcast/${epSlug}" class="podcast-embed-link"
     data-i18n-en="Full episode →"
     data-i18n-es="Episodio completo →"
     data-i18n-zh="完整集数 →"
     data-i18n-el="Πλήρες επεισόδιο →"
     data-i18n-ja="全エピソード →">Full episode →</a>
  <audio class="podcast-embed-audio" preload="none"></audio>
</div>
<!-- /PODCAST_EMBED_CARD -->`;
}

function buildRelatedEpisodesSection(epSlugs) {
  const cards = epSlugs.map(slug => {
    const ep = EPISODES[slug];
    if (!ep) return '';
    return `    <a href="/podcast/${slug}" class="related-ep-card">
      <div class="related-ep-num">Ep.<br>${ep.num}</div>
      <div class="related-ep-info">
        <div class="related-ep-title">${ep.title}</div>
        <div class="related-ep-meta">Clear Passage &middot; ${ep.duration} min</div>
      </div>
    </a>`;
  }).filter(Boolean).join('\n');

  return `
<!-- RELATED_EPISODES_SECTION -->
<div class="related-episodes-section">
  <div class="related-section-title"
       data-i18n-en="🎙️ Related Podcast Episodes"
       data-i18n-es="🎙️ Episodios de Podcast Relacionados"
       data-i18n-zh="🎙️ 相关播客节目"
       data-i18n-el="🎙️ Σχετικά Επεισόδια Podcast"
       data-i18n-ja="🎙️ 関連ポッドキャストエピソード">🎙️ Related Podcast Episodes</div>
  <div class="related-episodes-list">
${cards}
  </div>
</div>
<!-- /RELATED_EPISODES_SECTION -->`;
}

function buildRelatedBlogSection(blogSlugs) {
  const items = blogSlugs.map(slug => {
    const post = BLOG_POSTS[slug];
    if (!post) return '';
    return `    <a href="/blog/${slug}" class="related-blog-item">
      <span class="related-blog-arrow">→</span>
      <span class="related-blog-item-title">${post.title}</span>
    </a>`;
  }).filter(Boolean).join('\n');

  return `
<!-- RELATED_BLOG_SECTION -->
<div class="related-blog-section">
  <div class="related-blog-title"
       data-i18n-en="📝 Related Blog Posts"
       data-i18n-es="📝 Artículos del Blog Relacionados"
       data-i18n-zh="📝 相关博客文章"
       data-i18n-el="📝 Σχετικές Αναρτήσεις Blog"
       data-i18n-ja="📝 関連ブログ記事">📝 Related Blog Posts</div>
  <div class="related-blog-list">
${items}
  </div>
</div>
<!-- /RELATED_BLOG_SECTION -->`;
}

// ── Insert script tag for podcast-embed.js ────────────────────────────────
function ensureEmbedScript(html) {
  if (html.includes('podcast-embed.js')) return html;
  // Insert just before </body>
  return html.replace('</body>', '<script src="/js/podcast-embed.js"></script>\n</body>');
}

// ── Find Nth occurrence of a string after a start position ───────────────
function findNthOccurrence(str, search, n, fromIndex = 0) {
  let pos = fromIndex;
  for (let i = 0; i < n; i++) {
    pos = str.indexOf(search, pos);
    if (pos === -1) return -1;
    pos += search.length;
  }
  return pos - search.length;
}

// ── Process a blog post ───────────────────────────────────────────────────
function processBlogPost(slug) {
  const filePath = path.join(BLOG_DIR, slug + '.html');
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP: ${slug}.html not found`);
    return;
  }

  const mapping = BLOG_TO_EPISODES[slug];
  if (!mapping) {
    console.warn(`  SKIP: no mapping for ${slug}`);
    return;
  }

  let html = fs.readFileSync(filePath, 'utf8');

  // Idempotency checks
  const hasCard = html.includes('PODCAST_EMBED_CARD');
  const hasRelated = html.includes('RELATED_EPISODES_SECTION');

  if (!hasCard) {
    // Find <article class="article-body"> then insert after 2nd </p>
    const articleStart = html.indexOf('<article class="article-body">');
    if (articleStart === -1) {
      console.warn(`  SKIP: no article body in ${slug}`);
      return;
    }

    // Find the 2nd </p> after article start
    let endP1 = html.indexOf('</p>', articleStart);
    if (endP1 === -1) { console.warn(`  SKIP: no paragraphs in ${slug}`); return; }
    let endP2 = html.indexOf('</p>', endP1 + 4);
    if (endP2 === -1) endP2 = endP1; // fallback to after 1st

    const insertionPoint = endP2 + 4; // after "</p>"
    const card = buildInlineCard(mapping.primary);
    html = html.slice(0, insertionPoint) + '\n' + card + '\n' + html.slice(insertionPoint);
    console.log(`  + inline card (${mapping.primary}) → ${slug}`);
  } else {
    console.log(`  ~ inline card already present → ${slug}`);
  }

  if (!hasRelated) {
    // Insert Related Episodes section before </article>
    const articleEnd = html.lastIndexOf('</article>');
    if (articleEnd === -1) {
      console.warn(`  SKIP: no </article> in ${slug}`);
      return;
    }
    const section = buildRelatedEpisodesSection(mapping.related);
    html = html.slice(0, articleEnd) + section + '\n' + html.slice(articleEnd);
    console.log(`  + related episodes section → ${slug}`);
  } else {
    console.log(`  ~ related episodes already present → ${slug}`);
  }

  // Ensure embed script is included
  html = ensureEmbedScript(html);

  fs.writeFileSync(filePath, html, 'utf8');
}

// ── Process a podcast episode page ───────────────────────────────────────
function processEpisodePage(slug) {
  const filePath = path.join(POD_DIR, slug + '.html');
  if (!fs.existsSync(filePath)) {
    console.warn(`  SKIP: ${slug}.html not found`);
    return;
  }

  const blogSlugs = EPISODE_TO_BLOGS[slug];
  if (!blogSlugs || blogSlugs.length === 0) {
    console.warn(`  SKIP: no blog mapping for ${slug}`);
    return;
  }

  let html = fs.readFileSync(filePath, 'utf8');

  if (html.includes('RELATED_BLOG_SECTION')) {
    console.log(`  ~ related blog section already present → ${slug}`);
  } else {
    // Insert before episode-nav or cta-section or </body>
    let insertionPoint = html.indexOf('class="episode-nav"');
    if (insertionPoint === -1) insertionPoint = html.indexOf('class="cta-section"');
    if (insertionPoint === -1) insertionPoint = html.indexOf('</body>');

    if (insertionPoint === -1) {
      console.warn(`  SKIP: no insertion point in ${slug}`);
      return;
    }

    // Back up to the start of the div/section tag
    const lineStart = html.lastIndexOf('\n', insertionPoint);
    const section = buildRelatedBlogSection(blogSlugs);
    html = html.slice(0, lineStart + 1) + section + '\n' + html.slice(lineStart + 1);
    console.log(`  + related blog section → ${slug}`);
  }

  // Ensure embed script is included
  html = ensureEmbedScript(html);

  fs.writeFileSync(filePath, html, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────
console.log('\n=== Embedding podcast players in blog posts ===\n');
Object.keys(BLOG_TO_EPISODES).forEach(slug => {
  console.log(`Processing blog: ${slug}`);
  processBlogPost(slug);
});

console.log('\n=== Adding related blog posts to episode pages ===\n');
Object.keys(EPISODE_TO_BLOGS).forEach(slug => {
  console.log(`Processing episode: ${slug}`);
  processEpisodePage(slug);
});

console.log('\n✓ Done\n');
