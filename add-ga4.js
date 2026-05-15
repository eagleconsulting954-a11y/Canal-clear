#!/usr/bin/env node
/**
 * Injects GA4 tracking snippet into all HTML files in public/
 * Idempotent — skips files that already have the snippet.
 */
const fs = require('fs');
const path = require('path');

const GA4_SNIPPET = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-HYJXEY6H3G"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-HYJXEY6H3G');
  </script>`;

function getAllHtmlFiles(dir) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getAllHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

const publicDir = path.join(__dirname, 'public');
const files = getAllHtmlFiles(publicDir);

let updated = 0;
let skipped = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');

  // Already has GA4 — skip
  if (content.includes('G-HYJXEY6H3G')) {
    skipped++;
    continue;
  }

  // Inject right after <head>
  const headTag = content.indexOf('<head>');
  if (headTag === -1) {
    console.warn(`SKIP (no <head>): ${file}`);
    skipped++;
    continue;
  }

  const insertAt = headTag + '<head>'.length;
  const newContent = content.slice(0, insertAt) + '\n' + GA4_SNIPPET + '\n' + content.slice(insertAt);

  fs.writeFileSync(file, newContent, 'utf8');
  updated++;
  console.log(`UPDATED: ${path.relative(__dirname, file)}`);
}

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
