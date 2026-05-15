#!/usr/bin/env node
/**
 * Second pass: add /bosporus link to remaining footer sections.
 * Targets pages where the footer has links but no /bosporus.
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

  const footerIdx = html.lastIndexOf('<footer');
  if (footerIdx === -1) continue;
  const footerSection = html.slice(footerIdx);
  if (footerSection.includes('href="/bosporus"')) continue;
  if (!footerSection.includes('href="/')) continue;

  let changed = false;

  // Pattern A: footer-links div with <a href="/pricing">Pricing</a>
  // Add Bosporus before Pricing
  if (footerSection.includes('class="footer-links"') && footerSection.includes('href="/pricing"')) {
    const before = html.slice(0, footerIdx);
    let footer = html.slice(footerIdx);
    footer = footer.replace(
      /(<div class="footer-links">\s*\n?\s*<a href="\/">Home<\/a>\s*\n?)(\s*)(<a href="\/pricing")/,
      '$1$2<a href="/bosporus">Bosporus</a>\n$2$3'
    );
    if (footer !== html.slice(footerIdx)) {
      html = before + footer;
      changed = true;
    }
  }

  // Pattern B: about-style footer with <p> containing · separated links, no footer-links div
  if (!changed && footerSection.includes('<a href="/blog">Blog</a>')) {
    const before = html.slice(0, footerIdx);
    let footer = html.slice(footerIdx);
    // about.html pattern: links separated by · in a <p>
    // Try to add after Blog link
    footer = footer.replace(
      /(<a href="\/blog">Blog<\/a>)(\s*·)/,
      '$1 ·\n        <a href="/bosporus">Bosporus</a>$2'
    );
    if (footer !== html.slice(footerIdx)) {
      html = before + footer;
      changed = true;
    }
  }

  // Pattern C: Just add after any Pricing link in footer
  if (!changed && footerSection.includes('href="/pricing"')) {
    const before = html.slice(0, footerIdx);
    let footer = html.slice(footerIdx);
    footer = footer.replace(
      /(<a href="\/pricing">Pricing<\/a>)(\s*\n?\s*)(<a href)/,
      '$1$2<a href="/bosporus">Bosporus</a>$2$3'
    );
    if (footer !== html.slice(footerIdx)) {
      html = before + footer;
      changed = true;
    }
  }

  // Pattern D: Footer links with Demo link — add Bosporus after Demo
  if (!changed && footerSection.includes('href="/demo"')) {
    const before = html.slice(0, footerIdx);
    let footer = html.slice(footerIdx);
    footer = footer.replace(
      /(<a href="\/demo">Demo<\/a>)(\s*\n?\s*)(<a href)/,
      '$1$2<a href="/bosporus">Bosporus</a>$2$3'
    );
    if (footer !== html.slice(footerIdx)) {
      html = before + footer;
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, html, 'utf8');
    fixed++;
    console.log('FIXED: ' + rel);
  } else {
    console.log('STILL_MISSING: ' + rel);
  }
}

console.log('\nDone. Fixed ' + fixed + ' files.');
