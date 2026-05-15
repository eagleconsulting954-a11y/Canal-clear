#!/usr/bin/env node
/**
 * Fix footers across all HTML pages to include Bosporus.
 * Updates "Panama Canal & Suez Canal" → "Panama, Suez & Bosporus Canal"
 * in footer copyright lines.
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
let fixed = 0;

for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  const rel = path.relative('./public', file);
  let changed = false;

  // Footer copyright line: "Panama Canal & Suez Canal Compliance Automation"
  // → "Panama, Suez & Bosporus Canal Compliance Automation"
  if (html.includes('Panama Canal &amp; Suez Canal Compliance Automation')) {
    html = html.replace(
      /Panama Canal &amp; Suez Canal Compliance Automation/g,
      'Panama, Suez &amp; Bosporus Canal Compliance Automation'
    );
    changed = true;
  }

  // "Panama Canal & Suez Canal Compliance" (without "Automation")
  if (html.includes('Panama Canal &amp; Suez Canal Compliance Intelligence')) {
    html = html.replace(
      /Panama Canal &amp; Suez Canal Compliance Intelligence/g,
      'Panama, Suez &amp; Bosporus Canal Compliance Intelligence'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, html, 'utf8');
    fixed++;
    console.log('FIXED: ' + rel);
  }
}

console.log('\nDone. Fixed ' + fixed + ' files.');
