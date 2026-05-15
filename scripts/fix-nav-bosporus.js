#!/usr/bin/env node
/**
 * Fix missing Bosporus navigation link across all HTML pages.
 * Adds <a href="/bosporus">🇹🇷 Bosporus</a> after the Suez nav link
 * on pages that are missing it.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function getAllHtmlFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllHtmlFiles(full));
    } else if (entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

const files = getAllHtmlFiles(PUBLIC_DIR);
let fixed = 0;
let skipped = 0;
let alreadyHas = 0;

for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(PUBLIC_DIR, file);

  // Skip if already has bosporus nav link
  if (html.includes('href="/bosporus"')) {
    alreadyHas++;
    continue;
  }

  // Pattern 1: nav-links div with Suez followed by Pricing (no Bosporus between)
  // Match: <a href="/suez">🇪🇬 Suez</a>\n            <a href="/pricing">
  const navPattern = /(<a href="\/suez"[^>]*>.*?<\/a>\s*\n)(\s*)(<a href="\/pricing")/g;
  if (navPattern.test(html)) {
    html = html.replace(
      /(<a href="\/suez"[^>]*>.*?<\/a>\s*\n)(\s*)(<a href="\/pricing")/g,
      '$1$2<a href="/bosporus">🇹🇷 Bosporus</a>\n$2$3'
    );
    fs.writeFileSync(file, html, 'utf8');
    fixed++;
    console.log(`FIXED: ${rel}`);
    continue;
  }

  // Pattern 2: Same line — Suez link then Pricing on same or next line
  const navPattern2 = /(<a href="\/suez"[^>]*>[^<]*<\/a>)(\s+)(<a href="\/pricing")/g;
  if (navPattern2.test(html)) {
    html = html.replace(
      /(<a href="\/suez"[^>]*>[^<]*<\/a>)(\s+)(<a href="\/pricing")/g,
      '$1$2<a href="/bosporus">🇹🇷 Bosporus</a>$2$3'
    );
    fs.writeFileSync(file, html, 'utf8');
    fixed++;
    console.log(`FIXED (p2): ${rel}`);
    continue;
  }

  skipped++;
  // Check if it even has a nav with Suez link
  if (html.includes('href="/suez"')) {
    console.log(`SKIPPED (has suez but pattern didn't match): ${rel}`);
  }
}

console.log(`\nDone. Fixed: ${fixed}, Already had Bosporus: ${alreadyHas}, Skipped: ${skipped}`);
