#!/usr/bin/env node
/**
 * Add service worker registration to all HTML files.
 * Injects <script src="/js/pwa-manager.js"></script> before </body>
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SCRIPT_TAG = '<script src="/js/pwa-manager.js"></script>';
const SKIP_FILES = new Set(['offline.html']); // offline.html doesn't need the SW

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip if already registered
  if (content.includes('pwa-manager.js')) {
    console.log(`  SKIP (already registered): ${path.relative(PUBLIC_DIR, filePath)}`);
    return;
  }

  // Find </body> tag
  const bodyMatch = content.match(/<\/body>/i);
  if (!bodyMatch) {
    console.log(`  SKIP (no </body>): ${path.relative(PUBLIC_DIR, filePath)}`);
    return;
  }

  const newContent = content.replace(/<\/body>/i, SCRIPT_TAG + '\n</body>');
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

console.log('Adding PWA manager script to all HTML files...');
walkDir(PUBLIC_DIR);
console.log('Done.');