#!/usr/bin/env node
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
const missing = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const hasNavLinks = html.includes('class="nav-links"');
  const hasSuez = html.includes('href="/suez"');
  const hasBosporus = html.includes('href="/bosporus"');
  if (hasNavLinks && hasSuez && !hasBosporus) {
    missing.push(path.relative('./public', f));
  }
}
console.log('Pages with nav-links and Suez but NO Bosporus:', missing.length);
missing.forEach(m => console.log('  ' + m));
