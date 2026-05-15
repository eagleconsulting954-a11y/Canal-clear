#!/usr/bin/env node

/**
 * Adds article:modified_time meta tag to all blog posts that have
 * article:published_time but are missing article:modified_time.
 *
 * The dateModified value is sourced from the JSON-LD dateModified field.
 * If not found, falls back to the datePublished date.
 */

const fs = require('fs');
const path = require('path');

const blogDir = path.join(__dirname, 'public', 'blog');
const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');

let processed = 0;
let skipped = 0;
let errors = 0;
const results = [];

for (const file of files) {
  const filePath = path.join(blogDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip if already has modified_time
  if (content.includes('article:modified_time')) {
    skipped++;
    results.push({ file, status: 'already_has_modified_time' });
    continue;
  }

  // Check if it has published_time
  if (!content.includes('article:published_time')) {
    skipped++;
    results.push({ file, status: 'no_published_time' });
    continue;
  }

  // Extract dateModified from JSON-LD
  let dateModified = null;
  const dateModifiedMatch = content.match(/"dateModified"\s*:\s*"([^"]+)"/);
  if (dateModifiedMatch) {
    dateModified = dateModifiedMatch[1];
  } else {
    // Fall back to datePublished
    const datePublishedMatch = content.match(/"datePublished"\s*:\s*"([^"]+)"/);
    if (datePublishedMatch) {
      dateModified = datePublishedMatch[1];
    }
  }

  if (!dateModified) {
    errors++;
    results.push({ file, status: 'error_no_date' });
    console.error(`ERROR: Could not find dateModified for ${file}`);
    continue;
  }

  // Normalize to ISO 8601 format (ensure T00:00:00Z suffix)
  let isoDate = dateModified;
  if (!isoDate.includes('T')) {
    isoDate = `${isoDate}T00:00:00Z`;
  }

  // Insert article:modified_time right after article:published_time line
  const newContent = content.replace(
    /(<meta\s+property="article:published_time"[^>]*>)/,
    `$1\n    <meta property="article:modified_time" content="${isoDate}">`
  );

  if (newContent === content) {
    errors++;
    results.push({ file, status: 'error_no_replacement' });
    console.error(`ERROR: Replacement failed for ${file}`);
    continue;
  }

  fs.writeFileSync(filePath, newContent, 'utf8');
  processed++;
  results.push({ file, status: 'updated', dateModified: isoDate });
  console.log(`Updated: ${file} -> ${isoDate}`);
}

console.log('\n=== Summary ===');
console.log(`Updated: ${processed}`);
console.log(`Skipped (already had tag or no published_time): ${skipped}`);
console.log(`Errors: ${errors}`);
console.log('\nResults:');
results.forEach(r => console.log(`  ${r.status}: ${r.file}${r.dateModified ? ' (' + r.dateModified + ')' : ''}`));
