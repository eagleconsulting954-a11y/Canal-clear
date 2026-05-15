#!/usr/bin/env node
/**
 * Add PWA meta tags to all HTML files in public/
 * Run once after any new HTML pages are added.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');

// PWA tags to inject
const PWA_META_TAGS = `
    <!-- PWA / Add to Home Screen -->
    <meta name="theme-color" content="#00D4AA">
    <link rel="manifest" href="/manifest.json">
    <!-- iOS PWA -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="CanalClear">
    <link rel="apple-touch-icon" href="/icons/icon-192.svg">
    <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.svg">
    <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.svg">`;

// Files that already have PWA tags (skip them)
const SKIP_FILES = new Set(['offline.html']); // offline.html has its own meta tags

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip if already has PWA tags
  if (content.includes('apple-mobile-web-app-capable')) {
    console.log(`  SKIP (already has PWA meta): ${path.relative(PUBLIC_DIR, filePath)}`);
    return;
  }

  // Find </head> tag
  const headMatch = content.match(/<\/head>/i);
  if (!headMatch) {
    console.log(`  SKIP (no </head>): ${path.relative(PUBLIC_DIR, filePath)}`);
    return;
  }

  const newContent = content.replace(/<\/head>/i, PWA_META_TAGS + '\n  </head>');
  fs.writeFileSync(filePath, newContent);
  console.log(`  OK: ${path.relative(PUBLIC_DIR, filePath)}`);
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.name.endsWith('.html') && !SKIP_FILES.has(entry.name)) {
      processFile(fullPath);
    }
  }
}

console.log('Adding PWA meta tags to all HTML files...');
walkDir(PUBLIC_DIR);
console.log('Done.');