#!/usr/bin/env node
/**
 * Add /bosporus link to footer link sections across all HTML pages.
 * Handles multiple footer patterns:
 * 1. Blog/compliance: inline footer links (adds · Bosporus after Demo or Pricing)
 * 2. Product pages: footer-links div (adds Bosporus link after existing canal links)
 * 3. About pages: footer link list (adds Bosporus after existing links)
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

  // Skip if already has bosporus link in footer area
  // (We check if there's a /bosporus link near a footer tag)
  const footerIdx = html.lastIndexOf('<footer');
  if (footerIdx === -1) continue;
  const footerSection = html.slice(footerIdx);
  if (footerSection.includes('href="/bosporus"')) continue;

  let changed = false;

  // Pattern 1: "Panama Canal AI Compliance Platform" → add "& Bosporus" or add link
  // Blog footer: ...Platform · <a href="/blog">Blog</a> · <a href="/podcast">Podcast</a> · <a href="/pricing">Pricing</a> · <a href="/demo">Demo</a>
  // Add Bosporus link after Demo
  if (html.includes('Panama Canal AI Compliance Platform')) {
    html = html.replace(
      /Panama Canal AI Compliance Platform/g,
      'Panama, Suez &amp; Bosporus Canal Compliance'
    );
    // Add Bosporus link in the footer link chain
    html = html.replace(
      /(<a href="\/demo">Demo<\/a>)(<\/p>\s*<\/footer>)/,
      '$1 &middot; <a href="/bosporus">Bosporus</a>$2'
    );
    // Alt: Demo link followed by more content
    html = html.replace(
      /(<a href="\/demo">Demo<\/a>)(<\/p>)/,
      '$1 &middot; <a href="/bosporus">Bosporus</a>$2'
    );
    changed = true;
  }

  // Pattern 2: footer-links div — add Bosporus after Home link
  if (!changed && footerSection.includes('class="footer-links"')) {
    html = html.replace(
      /(<a href="\/">Home<\/a>\s*\n)(\s*)(<a href="\/(?:suez|panama))/,
      '$1$2<a href="/bosporus">Bosporus</a>\n$2$3'
    );
    changed = true;
  }

  // Pattern 3: about-style footer — add Bosporus link after Blog
  if (!changed && footerSection.includes('<a href="/blog">Blog</a>') && !footerSection.includes('href="/bosporus"')) {
    html = html.replace(
      /(<a href="\/blog">Blog<\/a>\s*(?:·|&middot;)?\s*\n?)(\s*)(<a href="\/(?:pricing|knowledge-base|podcast))/,
      '$1$2<a href="/bosporus">Bosporus</a> &middot;\n$2$3'
    );
    changed = true;
  }

  // Pattern 4: Generic footer with · separated links — add Bosporus after Pricing
  if (!changed && footerSection.includes('<a href="/pricing">Pricing</a>') && !footerSection.includes('href="/bosporus"')) {
    // Only add in footer section
    const beforeFooter = html.slice(0, footerIdx);
    let footerPart = html.slice(footerIdx);
    footerPart = footerPart.replace(
      /(<a href="\/pricing">Pricing<\/a>)(\s*(?:·|&middot;)\s*)/,
      '$1$2<a href="/bosporus">Bosporus</a> &middot; '
    );
    html = beforeFooter + footerPart;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, html, 'utf8');
    fixed++;
    console.log('FIXED: ' + rel);
  }
}

console.log('\nDone. Fixed ' + fixed + ' files.');
