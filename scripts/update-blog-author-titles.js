#!/usr/bin/env node
/**
 * update-blog-author-titles.js
 *
 * Two changes to every blog post:
 * 1. Remove "2026" from title tags, H1s, og:title, twitter:title, schema headline
 * 2. Update author byline from "CanalClear" → "Francis" with link to /about/francis
 * 3. Update article:author meta + schema author to Person
 *
 * Does NOT change URLs/slugs or body content.
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', 'public', 'blog');
const AUTHOR_NAME = 'Francis';
const AUTHOR_URL = '/about/francis';

// Title rewrite map: old title text → new title text
// Only the display/meta title — NOT slug changes
const TITLE_REWRITES = {
  // Format: key = old title pattern to match, value = new title
  'Best Maritime Compliance Podcasts 2026': 'Best Maritime Compliance Podcasts for Ship Operators',
  'Best Panama Canal Compliance Tools 2026': 'Best Panama Canal Compliance Tools: Software Reviewed & Ranked',
  'Cargo Declaration Rules for Panama Canal Transit 2026': 'Cargo Declaration Rules for Panama Canal Transit',
  'Container Ship VUMPA Filing Guide 2026': 'Container Ship VUMPA Filing Guide: Checklist & Deadlines',
  'Cruise Ship Panama Canal: Compliance & Requirements 2026': 'Cruise Ship Panama Canal: Compliance & Requirements Guide',
  'Cruise Ship Panama Canal: Compliance &amp; Requirements 2026': 'Cruise Ship Panama Canal: Compliance &amp; Requirements Guide',
  'Panama Canal Fines 2026: $65K Lost Per Slot': 'Panama Canal Fines: $65K Lost Per Slot',
  'File PCSOPEP 2026: Avoid $50K Rejection': 'File PCSOPEP: Avoid $50K Rejection',
  'VUMPA Filing 2026: Avoid $65K Slot Loss': 'VUMPA Filing Guide: Avoid $65K Slot Loss',
  'LNG Tanker Panama Canal Transit: Documents & Regulations 2026': 'LNG Tanker Panama Canal Transit: Documents & Regulations',
  'LNG Tanker Panama Canal Transit: Documents &amp; 2026 Rules': 'LNG Tanker Panama Canal Transit: Documents &amp; Regulations',
  'MARPOL Compliance Checklist 2026': 'MARPOL Compliance Checklist: All 6 Annexes',
  'Bulk Carrier Panama Canal Compliance: 2026 Requirements': 'Bulk Carrier Panama Canal Compliance Requirements',
  'Panama Canal Compliance Checklist 2026': 'Panama Canal Compliance Checklist',
  'Panama Canal Compliance Checklist 2026 [Free]': 'Panama Canal Compliance Checklist [Free]',
  'Panama Canal Compliance 2026': 'Panama Canal Compliance',
  'Panama Canal Crew Manifest Requirements 2026': 'Panama Canal Crew Manifest Requirements: Filing Guide',
  'Panama Canal Environmental Compliance: 2026 Regulations': 'Panama Canal Environmental Compliance Regulations',
  'Panama Canal Filing: Automation vs Manual Process (2026)': 'Panama Canal Filing: Automation vs Manual Process',
  'Panama Canal Filing Mistakes That Cause Delays — 2026 Guide': 'Panama Canal Filing Mistakes That Cause Delays',
  'Panama Canal Non-Compliance Costs 2026': 'Panama Canal Non-Compliance Costs: The Full Price Tag',
  'Panama Canal Non-Compliance Penalties 2026': 'Panama Canal Non-Compliance Penalties: The Full ACP Fine Schedule',
  'Panama Canal Tolls 2026': 'Panama Canal Tolls: True Cost + $200K Hidden Fees',
  '9 Reasons Panama Canal Transit Is Denied in 2026': '9 Reasons Panama Canal Transit Is Denied (And How to Avoid Them)',
  'Panama Canal Documents 2026': 'Panama Canal Documents: Avoid Costly Rejections',
  'VUMPA Requirements 2026': 'VUMPA Requirements: Mandatory Deadline & Penalty',
  'PCSOPEP Certificate Requirements Panama Canal 2026': 'PCSOPEP Certificate Requirements Panama Canal',
  'PCSOPEP Docs 2026': 'PCSOPEP Docs: Avoid $50K Fines — Full Checklist',
  'PCSOPEP 2026 Updates': 'PCSOPEP Updates: New Rules to Avoid $50K Fines',
  'PCSOPEP 2026: Avoid $50K Fine': 'PCSOPEP Requirements: Avoid $50K Fine',
  'Ro-Ro Vessel Panama Canal: Documentation Checklist 2026': 'Ro-Ro Vessel Panama Canal: Documentation Checklist',
  'Top 5 Suez Canal Compliance Mistakes That Delay Transits 2026': 'Top 5 Suez Canal Compliance Mistakes That Delay Transits',
  'Dangerous Goods Transit Through the Suez Canal: DG Compliance Guide 2026': 'Dangerous Goods Transit Through the Suez Canal: DG Compliance Guide',
  'Suez Canal ISPS Compliance 2026': 'Suez Canal ISPS Compliance Guide for Ship Operators',
  'Suez Canal Transit Checklist for Fleet Operators 2026': 'Suez Canal Transit Checklist for Fleet Operators',
  'How Much Does a Suez Canal Transit Cost in 2026?': 'How Much Does a Suez Canal Transit Cost? Full Fee Breakdown',
  'Suez Canal Transit Requirements 2026': 'Suez Canal Transit Requirements: Complete SCA Compliance Guide',
  'Suez Canal vs Panama Canal Compliance Compared 2026': 'Suez Canal vs Panama Canal Compliance Compared',
  'Canal Vessel Inspection 2026': 'Canal Vessel Inspection: Zero-Delay Checklist',
  'VUMPA Digital Submission 2026': 'VUMPA Digital Submission: Avoid Portal Rejections',
  'VUMPA Pre-Arrival 2026': 'VUMPA Pre-Arrival: ETA Deadlines & Rejection Codes',
  'Port State Control 2026: PSC Inspection Guide | CanalClear': 'Port State Control (PSC) Inspection Guide | CanalClear',
  'Port State Control 2026': 'Port State Control (PSC) Inspection Guide',
  'Port State Control (PSC) Inspection Guide: PSC Inspection Guide | CanalClear': 'Port State Control (PSC) Inspection Guide | CanalClear',
  'Port State Control (PSC) Inspection Guide: PSC Inspection Guide': 'Port State Control (PSC) Inspection Guide',
  'Best Panama Canal Compliance Tools: Software Reviewed & Ranked: Software Reviewed &amp; Ranked | CanalClear': 'Best Panama Canal Compliance Tools: Software Reviewed & Ranked | CanalClear',
  'Best Panama Canal Compliance Tools: Software Reviewed & Ranked: Software Reviewed & Ranked | CanalClear': 'Best Panama Canal Compliance Tools: Software Reviewed & Ranked | CanalClear',
  // H1 patterns (may differ from title)
  'Panama Canal <span>VUMPA Requirements</span> 2026: Complete Guide': 'Panama Canal <span>VUMPA Requirements</span>: Complete Guide',
  'Panama Canal VUMPA Requirements 2026': 'Panama Canal VUMPA Requirements: Complete Guide',
};

// Generic function to strip " 2026" or "(2026)" or ": 2026" from strings
function removeYear(str) {
  if (!str) return str;
  // Remove various 2026 patterns
  return str
    .replace(/\s+2026:\s*/g, ': ')         // "Foo 2026: Bar" → "Foo: Bar"
    .replace(/:\s+2026\s+/g, ': ')         // "Foo: 2026 Bar" → "Foo: Bar"
    .replace(/\s+\(2026\)/g, '')           // "Foo (2026)" → "Foo"
    .replace(/\s+—\s+2026\s+/g, ' — ')    // "Foo — 2026 Bar" → "Foo — Bar"
    .replace(/\s+in\s+2026(\s|$)/g, '$1') // "Foo in 2026" → "Foo"
    .replace(/\s+2026(\s|$)/g, '$1')       // trailing " 2026" → ""
    .replace(/^2026:\s+/g, '')             // leading "2026: Foo" → "Foo"
    .trim();
}

function processFile(filePath) {
  let html = fs.readFileSync(filePath, 'utf8');
  const originalHtml = html;
  const filename = path.basename(filePath);

  let changesMade = [];

  // ── 1. Fix author byline — multiple patterns ──────────────────────────────
  // Pattern A: <span>CanalClear</span> inside article-meta
  const authorBylineOldA = /<div class="article-meta">([\s\S]*?)<span>CanalClear<\/span>/;
  if (authorBylineOldA.test(html)) {
    html = html.replace(
      authorBylineOldA,
      `<div class="article-meta">$1<span><a href="${AUTHOR_URL}" style="color:inherit;text-decoration:none;font-weight:600;">${AUTHOR_NAME}</a></span>`
    );
    changesMade.push('author byline (A)');
  }

  // Pattern B: <span>By CanalClear Editorial Team</span>
  if (html.includes('<span>By CanalClear Editorial Team</span>')) {
    html = html.replace(
      /<span>By CanalClear Editorial Team<\/span>/g,
      `<span>By <a href="${AUTHOR_URL}" style="color:inherit;text-decoration:none;font-weight:600;">${AUTHOR_NAME}</a></span>`
    );
    changesMade.push('author byline (B)');
  }

  // Pattern C: <span>By CanalClear</span>
  if (html.includes('<span>By CanalClear</span>')) {
    html = html.replace(
      /<span>By CanalClear<\/span>/g,
      `<span>By <a href="${AUTHOR_URL}" style="color:inherit;text-decoration:none;font-weight:600;">${AUTHOR_NAME}</a></span>`
    );
    changesMade.push('author byline (C)');
  }

  // Pattern D: <span>CanalClear Editorial</span> or <span>CanalClear Research</span>
  if (html.includes('<span>CanalClear Editorial</span>') || html.includes('<span>CanalClear Research</span>')) {
    html = html.replace(
      /<span>CanalClear (?:Editorial|Research)<\/span>/g,
      `<span><a href="${AUTHOR_URL}" style="color:inherit;text-decoration:none;font-weight:600;">${AUTHOR_NAME}</a></span>`
    );
    changesMade.push('author byline (D)');
  }

  // ── 2. Fix article:author meta tag ────────────────────────────────────────
  html = html.replace(
    /<meta property="article:author" content="CanalClear( Editorial Team)?">/g,
    `<meta property="article:author" content="${AUTHOR_NAME}">`
  );

  // ── 3. Fix schema.org author field ────────────────────────────────────────
  // Change: "author": { "@type": "Organization", "name": "CanalClear..." }
  // To:     "author": { "@type": "Person", "name": "Francis", "url": "..." }
  html = html.replace(
    /"author":\s*\{\s*"@type":\s*"Organization",\s*"name":\s*"CanalClear( Editorial Team)?",?\s*(?:"url":\s*"https:\/\/canalclear\.org")?\s*\}/g,
    `"author": { "@type": "Person", "name": "${AUTHOR_NAME}", "url": "https://canalclear.org${AUTHOR_URL}" }`
  );

  // ── 4. Fix title tag — remove 2026 ────────────────────────────────────────
  html = html.replace(/<title>(.*?)<\/title>/s, (match, titleContent) => {
    // Try specific rewrite first
    let newTitle = titleContent;

    // Apply specific rewrites
    for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
      if (newTitle.includes(oldPart)) {
        newTitle = newTitle.replace(oldPart, newPart);
        break;
      }
    }

    // Fall back to generic removal
    if (newTitle.includes('2026')) {
      newTitle = removeYear(newTitle);
    }

    if (newTitle !== titleContent) {
      changesMade.push('title tag');
      return `<title>${newTitle}</title>`;
    }
    return match;
  });

  // ── 5. Fix og:title — remove 2026 ─────────────────────────────────────────
  html = html.replace(/<meta property="og:title" content="(.*?)">/g, (match, content) => {
    let newContent = content;
    for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
      if (newContent.includes(oldPart)) {
        newContent = newContent.replace(oldPart, newPart);
        break;
      }
    }
    if (newContent.includes('2026')) newContent = removeYear(newContent);
    if (newContent !== content) {
      changesMade.push('og:title');
      return `<meta property="og:title" content="${newContent}">`;
    }
    return match;
  });

  // ── 6. Fix twitter:title — remove 2026 ────────────────────────────────────
  html = html.replace(/<meta name="twitter:title" content="(.*?)">/g, (match, content) => {
    let newContent = content;
    for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
      if (newContent.includes(oldPart)) {
        newContent = newContent.replace(oldPart, newPart);
        break;
      }
    }
    if (newContent.includes('2026')) newContent = removeYear(newContent);
    if (newContent !== content) {
      changesMade.push('twitter:title');
      return `<meta name="twitter:title" content="${newContent}">`;
    }
    return match;
  });

  // ── 7. Fix schema "headline" field ────────────────────────────────────────
  html = html.replace(/"headline":\s*"(.*?)"/g, (match, content) => {
    let newContent = content;
    for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
      if (newContent.includes(oldPart)) {
        newContent = newContent.replace(oldPart, newPart);
        break;
      }
    }
    if (newContent.includes('2026')) newContent = removeYear(newContent);
    if (newContent !== content) {
      changesMade.push('schema headline');
      return `"headline": "${newContent}"`;
    }
    return match;
  });

  // ── 8. Fix H1 — remove 2026 ───────────────────────────────────────────────
  html = html.replace(/<h1>([\s\S]*?)<\/h1>/g, (match, content) => {
    let newContent = content;
    for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
      if (newContent.includes(oldPart)) {
        newContent = newContent.replace(oldPart, newPart);
        break;
      }
    }
    // Generic removal from H1 (but careful not to remove from body text)
    if (newContent.includes('2026')) {
      newContent = removeYear(newContent);
    }
    if (newContent !== content) {
      changesMade.push('H1');
      return `<h1>${newContent}</h1>`;
    }
    return match;
  });

  // ── 9. Fix breadcrumb "name" in schema for post title ─────────────────────
  // This is in the BreadcrumbList schema — the last breadcrumb has the post name
  html = html.replace(/"name":\s*"(.*?2026.*?)"/g, (match, content) => {
    // Only fix breadcrumb-style names (short, likely titles)
    // Avoid fixing FAQ question names
    if (content.length < 150 && content.includes('2026')) {
      let newContent = content;
      for (const [oldPart, newPart] of Object.entries(TITLE_REWRITES)) {
        if (newContent.includes(oldPart)) {
          newContent = newContent.replace(oldPart, newPart);
          break;
        }
      }
      if (newContent.includes('2026')) newContent = removeYear(newContent);
      if (newContent !== content) {
        changesMade.push('breadcrumb name');
        return `"name": "${newContent}"`;
      }
    }
    return match;
  });

  if (html !== originalHtml) {
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`✓ ${filename} [${changesMade.join(', ')}]`);
    return true;
  } else {
    console.log(`- ${filename} (no changes needed)`);
    return false;
  }
}

// Run on all blog posts
const files = fs.readdirSync(BLOG_DIR)
  .filter(f => f.endsWith('.html') && f !== 'index.html')
  .map(f => path.join(BLOG_DIR, f));

console.log(`Processing ${files.length} blog posts...\n`);

let updated = 0;
let unchanged = 0;

for (const file of files) {
  const changed = processFile(file);
  if (changed) updated++;
  else unchanged++;
}

console.log(`\n✅ Done: ${updated} updated, ${unchanged} unchanged`);

// Verify no 2026 in titles
console.log('\n🔍 Verifying title tags...');
let titleWarnings = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const titleMatch = html.match(/<title>(.*?)<\/title>/s);
  if (titleMatch && titleMatch[1].includes('2026')) {
    console.warn(`  ⚠️  Still has 2026 in title: ${path.basename(file)}: "${titleMatch[1]}"`);
    titleWarnings++;
  }
}
if (titleWarnings === 0) {
  console.log('  ✅ No 2026 remaining in title tags');
}

// Verify author bylines
console.log('\n🔍 Verifying author bylines...');
let bylineWarnings = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes('class="article-meta"') && !html.includes(`href="${AUTHOR_URL}"`)) {
    console.warn(`  ⚠️  Missing author link: ${path.basename(file)}`);
    bylineWarnings++;
  }
}
if (bylineWarnings === 0) {
  console.log('  ✅ All blog posts have author link');
}
