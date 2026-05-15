#!/usr/bin/env node
// One-time script: adds physical address to footer of public/*.html files
// Safe to re-run — skips files that already have the address.
const fs = require('fs');
const path = require('path');

const ADDRESS_LINE = '\n        <p style="margin-top:0.4rem;font-size:0.8rem;"><a href="https://www.google.com/maps/search/?api=1&query=2094+NW+87th+Ter+Coral+Springs+FL+33071" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">&#128205; 2094 NW 87th Ter, Coral Springs, FL 33071</a></p>';

// Files to update (skip ones already done or that use different footer markup)
const files = [
  'public/about.html',
  'public/compliance-guide.html',
  'public/compliance-score.html',
  'public/knowledge-base.html',
  'public/privacy.html',
  'public/terms.html',
  'public/compare.html',
  'public/glossary.html',
  'public/guide.html',
  'public/podcast.html',
  'public/blog/index.html',
];

let updated = 0;
let skipped = 0;
let noMatch = 0;

files.forEach(fp => {
  if (!fs.existsSync(fp)) { console.log('NOT FOUND:', fp); return; }
  let content = fs.readFileSync(fp, 'utf8');

  if (content.includes('Coral Springs')) {
    skipped++;
    return;
  }

  const footerIdx = content.indexOf('<footer>');
  if (footerIdx === -1) { noMatch++; console.log('NO FOOTER:', fp); return; }

  // Insert address right before </footer>
  const closeFooter = content.indexOf('</footer>', footerIdx);
  if (closeFooter === -1) { noMatch++; console.log('NO CLOSE FOOTER:', fp); return; }

  content = content.substring(0, closeFooter) + ADDRESS_LINE + '\n' + content.substring(closeFooter);
  fs.writeFileSync(fp, content);
  updated++;
  console.log('Updated:', fp);
});

console.log('\nUpdated:', updated, '| Skipped:', skipped, '| No match:', noMatch);
