#!/usr/bin/env node
/**
 * Check which pages have a footer section but no /bosporus link in it.
 * We only care about pages that have footer links — not all pages.
 */
const fs = require('fs');
const path = require('path');

function getAllHtmlFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results = results.concat(getAllHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

const files = getAllHtmlFiles('./public');

for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const rel = path.relative('./public', f);

  // Check for footer sections with links
  const footerMatch = html.match(/<footer[\s\S]*?<\/footer>/i) || html.match(/class="page-footer"[\s\S]*?(?=<\/div>)/i);
  if (!footerMatch) continue;

  const footerText = footerMatch[0];
  const hasLinks = footerText.includes('href="/');
  const hasBosporusLink = footerText.includes('href="/bosporus"');

  if (hasLinks && !hasBosporusLink) {
    console.log('FOOTER_MISSING_BOSPORUS: ' + rel);
  }
}
