#!/usr/bin/env node
/**
 * Internal linking pass — injects product page and lead magnet links into all blog posts.
 *
 * Rules:
 * - Panama/VUMPA posts: link to /panama, /demo/panama, /get/vumpa-checklist
 * - Suez/SCA posts: link to /suez, /demo/suez, /get/suez-deadline-cheatsheet, /get/suez-convoy-calculator
 * - Bosporus posts: link to /get/bosporus-primer
 * - General posts: link to /panama and /suez (both canals)
 * - Skip links that already exist in the file
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', 'public', 'blog');

// Categorize each blog post by topic
const SUEZ_POSTS = [
  'suez-canal-compliance-mistakes-delays.html',
  'suez-canal-convoy-delays-paperwork-problem.html',
  'suez-canal-convoy-scheduling.html',
  'suez-canal-dangerous-goods-compliance.html',
  'suez-canal-isps-compliance-guide.html',
  'suez-canal-pilotage-requirements.html',
  'suez-canal-tonnage-certificate.html',
  'suez-canal-transit-checklist-fleet-operators.html',
  'suez-canal-transit-cost-2026.html',
  'suez-canal-transit-requirements-complete-guide-2026.html',
  'suez-canal-vs-panama-canal-compliance-compared.html',
];

const BOSPORUS_POSTS = [
  // none currently except maybe embedded references
];

// All other blog posts are Panama/VUMPA/general
// detect by filename
function categorize(filename) {
  if (SUEZ_POSTS.includes(filename)) return 'suez';
  if (BOSPORUS_POSTS.includes(filename)) return 'bosporus';
  if (filename.includes('suez') || filename.includes('sca') || filename.includes('scnt')) return 'suez';
  if (filename.includes('bosporus')) return 'bosporus';
  // Mixed/general get both
  if (filename.includes('true-cost') || filename.includes('best-maritime') ||
      filename.includes('marpol') || filename.includes('port-state') ||
      filename.includes('how-to-reduce') || filename.includes('non-compliance')) {
    return 'both';
  }
  return 'panama';
}

// Lead magnet block HTML templates
function panamaLeadMagnetBlock(hasVumpaChecklist, hasDemoLink, hasProductLink) {
  const items = [];

  if (!hasProductLink) {
    items.push(`<li>📋 <a href="/panama" style="color:#E85A00;font-weight:600;text-decoration:underline;">Panama Canal Compliance Platform</a> — automated pre-submission validation for VUMPA and PCSOPEP</li>`);
  }
  if (!hasDemoLink) {
    items.push(`<li>🎯 <a href="/demo/panama" style="color:#E85A00;font-weight:600;text-decoration:underline;">Try the Live Panama Demo</a> — validate a real filing in 90 seconds, no account required</li>`);
  }
  if (!hasVumpaChecklist) {
    items.push(`<li>📥 <a href="/get/vumpa-checklist" style="color:#E85A00;font-weight:600;text-decoration:underline;">Download the VUMPA Rejection Checklist</a> — free PDF covering the 23 most common rejection triggers</li>`);
  }

  if (items.length === 0) return null;

  return `\n<!-- Internal links: Panama product + lead magnets -->
<div style="margin:2.5rem 0;padding:1.5rem 1.75rem;background:rgba(232,90,0,0.06);border:1px solid rgba(232,90,0,0.25);border-radius:12px;">
  <p style="font-weight:700;color:#E85A00;margin:0 0 0.75rem;font-size:0.95rem;letter-spacing:0.02em;">RELATED RESOURCES</p>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.6rem;font-size:0.95rem;line-height:1.5;">
    ${items.join('\n    ')}
  </ul>
</div>`;
}

function suezLeadMagnetBlock(hasProductLink, hasDemoLink, hasCheatsheet, hasConvoyCalc) {
  const items = [];

  if (!hasProductLink) {
    items.push(`<li>📋 <a href="/suez" style="color:#2563eb;font-weight:600;text-decoration:underline;">Suez Canal Compliance Platform</a> — automated SCA/SCNT/ISPS filing validation</li>`);
  }
  if (!hasDemoLink) {
    items.push(`<li>🎯 <a href="/demo/suez" style="color:#2563eb;font-weight:600;text-decoration:underline;">Try the Live Suez Demo</a> — validate a real filing in 90 seconds, no account required</li>`);
  }
  if (!hasCheatsheet) {
    items.push(`<li>📥 <a href="/get/suez-deadline-cheatsheet" style="color:#2563eb;font-weight:600;text-decoration:underline;">Download the Suez Deadline Cheatsheet</a> — free PDF with every SCA submission window and cutoff</li>`);
  }
  if (!hasConvoyCalc) {
    items.push(`<li>🧮 <a href="/get/suez-convoy-calculator" style="color:#2563eb;font-weight:600;text-decoration:underline;">Suez Convoy Calculator</a> — estimate your slot, transit time, and filing window</li>`);
  }

  if (items.length === 0) return null;

  return `\n<!-- Internal links: Suez product + lead magnets -->
<div style="margin:2.5rem 0;padding:1.5rem 1.75rem;background:rgba(37,99,235,0.05);border:1px solid rgba(37,99,235,0.2);border-radius:12px;">
  <p style="font-weight:700;color:#2563eb;margin:0 0 0.75rem;font-size:0.95rem;letter-spacing:0.02em;">RELATED RESOURCES</p>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.6rem;font-size:0.95rem;line-height:1.5;">
    ${items.join('\n    ')}
  </ul>
</div>`;
}

function bosphorusLeadMagnetBlock(hasPrimer) {
  if (hasPrimer) return null;
  return `\n<!-- Internal links: Bosporus lead magnet -->
<div style="margin:2.5rem 0;padding:1.5rem 1.75rem;background:rgba(107,114,128,0.07);border:1px solid rgba(107,114,128,0.2);border-radius:12px;">
  <p style="font-weight:700;color:#374151;margin:0 0 0.75rem;font-size:0.95rem;letter-spacing:0.02em;">RELATED RESOURCES</p>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.6rem;font-size:0.95rem;line-height:1.5;">
    <li>📥 <a href="/get/bosporus-primer" style="color:#374151;font-weight:600;text-decoration:underline;">Download the Bosporus Strait Compliance Primer</a> — COLREG, TSS, and Turkish Strait rules explained</li>
    <li>📋 <a href="/bosporus" style="color:#374151;font-weight:600;text-decoration:underline;">Bosporus Strait Compliance Platform</a> — automated COLREG and TSS filing validation</li>
  </ul>
</div>`;
}

function bothLeadMagnetBlock(html) {
  const items = [];

  const hasPanama = html.includes('href="/panama"') && !html.includes('href="/panama">\uD83C\uDDF5\uD83C\uDDE6');
  const hasSuez = html.includes('href="/suez"') && !html.includes('href="/suez">\uD83C\uDDEA\uD83C\uDDEC');
  const hasVumpaChecklist = html.includes('href="/get/vumpa-checklist"');
  const hasCheatsheet = html.includes('href="/get/suez-deadline-cheatsheet"');

  // For general/mixed posts add both canal lead magnets
  if (!hasVumpaChecklist) {
    items.push(`<li>📥 <a href="/get/vumpa-checklist" style="color:#E85A00;font-weight:600;text-decoration:underline;">VUMPA Rejection Checklist</a> — the 23 most common Panama Canal rejection triggers (free PDF)</li>`);
  }
  if (!hasCheatsheet) {
    items.push(`<li>📥 <a href="/get/suez-deadline-cheatsheet" style="color:#2563eb;font-weight:600;text-decoration:underline;">Suez Deadline Cheatsheet</a> — every SCA submission window and cutoff (free PDF)</li>`);
  }
  if (!hasPanama) {
    items.push(`<li>📋 <a href="/panama" style="color:#E85A00;font-weight:600;text-decoration:underline;">Panama Canal Compliance Platform</a> — automated VUMPA and PCSOPEP validation</li>`);
  }
  if (!hasSuez) {
    items.push(`<li>📋 <a href="/suez" style="color:#2563eb;font-weight:600;text-decoration:underline;">Suez Canal Compliance Platform</a> — automated SCA/SCNT/ISPS validation</li>`);
  }

  if (items.length === 0) return null;

  return `\n<!-- Internal links: multi-canal lead magnets -->
<div style="margin:2.5rem 0;padding:1.5rem 1.75rem;background:rgba(232,90,0,0.05);border:1px solid rgba(232,90,0,0.2);border-radius:12px;">
  <p style="font-weight:700;color:#E85A00;margin:0 0 0.75rem;font-size:0.95rem;letter-spacing:0.02em;">FREE COMPLIANCE RESOURCES</p>
  <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.6rem;font-size:0.95rem;line-height:1.5;">
    ${items.join('\n    ')}
  </ul>
</div>`;
}

const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.html') && f !== 'index.html').sort();
console.log(`Processing ${files.length} blog posts...`);

let modified = 0;
let skipped = 0;

for (const filename of files) {
  const filepath = path.join(BLOG_DIR, filename);
  let html = fs.readFileSync(filepath, 'utf8');

  const category = categorize(filename);
  let block = null;

  if (category === 'panama') {
    const hasVumpaChecklist = html.includes('href="/get/vumpa-checklist"');
    const hasDemoLink = html.includes('href="/demo/panama"');
    // Check for product page link (not nav link)
    const hasProductLink = html.includes('href="/panama"') && (
      html.includes('/panama" style') || html.includes('/panama">\n') ||
      html.includes('/panama" id=') || html.includes('Panama Canal Compliance Platform')
    );
    block = panamaLeadMagnetBlock(hasVumpaChecklist, hasDemoLink, hasProductLink);
  } else if (category === 'suez') {
    const hasProductLink = html.includes('href="/suez" style') || html.includes('href="/suez" id=') || html.includes('Suez Canal Compliance Platform');
    const hasDemoLink = html.includes('href="/demo/suez"');
    const hasCheatsheet = html.includes('href="/get/suez-deadline-cheatsheet"');
    const hasConvoyCalc = html.includes('href="/get/suez-convoy-calculator"');
    block = suezLeadMagnetBlock(hasProductLink, hasDemoLink, hasCheatsheet, hasConvoyCalc);
  } else if (category === 'bosporus') {
    const hasPrimer = html.includes('href="/get/bosporus-primer"');
    block = bosphorusLeadMagnetBlock(hasPrimer);
  } else if (category === 'both') {
    block = bothLeadMagnetBlock(html);
  }

  if (!block) {
    console.log(`  SKIP ${filename} (links already present)`);
    skipped++;
    continue;
  }

  // Insert just before </article>
  if (html.includes('</article>')) {
    html = html.replace('</article>', block + '\n</article>');
    fs.writeFileSync(filepath, html, 'utf8');
    console.log(`  OK   ${filename} [${category}]`);
    modified++;
  } else {
    console.log(`  WARN ${filename} — no </article> tag found, skipping`);
    skipped++;
  }
}

console.log(`\nDone. Modified: ${modified}, Skipped: ${skipped}`);
