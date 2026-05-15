/**
 * Injects the blog-audio-player.js script tag into all blog post HTML files.
 * Run once: node scripts/inject-audio-player.js
 */
const fs = require('fs');
const path = require('path');

const blogDir = path.join(__dirname, '..', 'public', 'blog');
const scriptTag = '<script src="/js/blog-audio-player.js"></script>';

const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
let updated = 0;

for (const file of files) {
  const filePath = path.join(blogDir, file);
  let html = fs.readFileSync(filePath, 'utf8');

  if (html.includes('blog-audio-player.js')) {
    console.log('Already patched:', file);
    continue;
  }

  // Insert before </body>
  if (!html.includes('</body>')) {
    console.warn('No </body> found in:', file);
    continue;
  }

  html = html.replace('</body>', `${scriptTag}\n</body>`);
  fs.writeFileSync(filePath, html);
  console.log('Updated:', file);
  updated++;
}

console.log(`\nDone. Updated ${updated} / ${files.length} blog posts.`);
