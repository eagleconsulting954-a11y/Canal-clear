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
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const hasSuez = html.includes('href="/suez"');
  const hasBosporus = html.includes('href="/bosporus"');
  const rel = path.relative('./public', f);
  if (hasSuez && !hasBosporus) {
    console.log('HAS_SUEZ_NO_BOSPORUS: ' + rel);
  }
}
