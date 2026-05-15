#!/usr/bin/env node
// One-time script: adds physical address to footer of all blog post HTML files
// Safe to re-run — skips files that already have the address.
const fs = require('fs');
const path = require('path');

const dir = 'public/blog';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'index.html');

const ADDRESS_ADDON = '\n        <p style="margin-top:0.4rem;font-size:0.8rem;"><a href="https://www.google.com/maps/search/?api=1&query=2094+NW+87th+Ter+Coral+Springs+FL+33071" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">&#128205; 2094 NW 87th Ter, Coral Springs, FL 33071</a></p>';

let updated = 0;
let skipped = 0;
let noMatch = 0;

files.forEach(file => {
  const fp = path.join(dir, file);
  let content = fs.readFileSync(fp, 'utf8');

  if (content.includes('Coral Springs')) {
    skipped++;
    return;
  }

  const footerIdx = content.indexOf('<footer>');
  if (footerIdx === -1) { noMatch++; console.log('NO FOOTER:', file); return; }

  // Find the closing </p> of the first paragraph in the footer
  const paraEnd = content.indexOf('</p>', footerIdx);
  if (paraEnd === -1) { noMatch++; console.log('NO PARA END:', file); return; }

  // Insert address after </p>
  content = content.substring(0, paraEnd + 4) + ADDRESS_ADDON + content.substring(paraEnd + 4);
  fs.writeFileSync(fp, content);
  updated++;
});

console.log('Updated:', updated, '| Skipped:', skipped, '| No match:', noMatch);
