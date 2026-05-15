#!/usr/bin/env node
/**
 * Fix broken lead magnet links across all HTML pages.
 * /get/suez-deadline-cheatsheet → /get/suez-cheatsheet
 * /get/suez-convoy-calculator → /get/calculator
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
let fixes = { deadline: 0, convoy: 0 };

for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  const rel = path.relative('./public', file);
  let changed = false;

  if (html.includes('/get/suez-deadline-cheatsheet')) {
    html = html.replace(/\/get\/suez-deadline-cheatsheet/g, '/get/suez-cheatsheet');
    fixes.deadline++;
    changed = true;
  }

  if (html.includes('/get/suez-convoy-calculator')) {
    html = html.replace(/\/get\/suez-convoy-calculator/g, '/get/calculator');
    fixes.convoy++;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, html, 'utf8');
    console.log('FIXED: ' + rel);
  }
}

console.log('\nDone. Fixed ' + fixes.deadline + ' deadline cheatsheet links, ' + fixes.convoy + ' convoy calculator links.');
