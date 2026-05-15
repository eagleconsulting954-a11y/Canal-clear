#!/usr/bin/env node
// SEO Fix: Update article:author to "Francis" and add <meta property="author">
const fs = require('fs');
const path = require('path');

const blogDir = path.join(__dirname, '..', 'public', 'blog');
const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
let changed = 0;

for (const file of files) {
  const filePath = path.join(blogDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;

  // 1. Change article:author from "Francis Eagle" to "Francis"
  content = content.replace(
    /<meta property="article:author" content="Francis Eagle">/g,
    '<meta property="article:author" content="Francis">'
  );

  // 2. Add <meta property="author" content="Francis"> after article:author line (if not already there)
  if (!content.includes('<meta property="author" content="Francis">')) {
    content = content.replace(
      /(<meta property="article:author" content="Francis">)/g,
      '$1\n    <meta property="author" content="Francis">'
    );
  }

  // 3. Update JSON-LD author name from "Francis Eagle" to "Francis"
  content = content.replace(
    /"name": "Francis Eagle"/g,
    '"name": "Francis"'
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    changed++;
  }
}

console.log(`Updated ${changed} blog files`);
