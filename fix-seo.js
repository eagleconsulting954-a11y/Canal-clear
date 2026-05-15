#!/usr/bin/env node
/**
 * SEO mega-fix script (v2 - improved deduplication)
 * Handles issues 3, 6, 7, 8 for all blog posts:
 * 3: Fix article:author "Francis" -> "Francis Eagle"
 * 6: Fix &amp; encoding and duplicated text in title/OG tags
 * 7: Assign unique OG images per content cluster
 * 8: Spread publish dates across past 30 days
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, 'public/blog');

const PANAMA_OG = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/7468770b-1ead-4654-b420-c985f9c28bf2.png';
const SUEZ_OG = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/40e0ebc5-1775-4d2e-86b8-61d461556e74.png';
const BLOG_DEFAULT_OG = 'https://pub-629428d185ca4960a0a73c850d32294b.r2.dev/company_47541/images/97466221-62d6-4e09-a312-e56df98072a1.png';

function getOgImageForPost(filename) {
  if (filename.includes('suez')) return SUEZ_OG;
  if (filename.includes('panama') || filename.includes('vumpa') || filename.includes('pcsopep') ||
      filename.includes('acp') || filename.includes('marpol') || filename.includes('port-state') ||
      filename.includes('cargo') || filename.includes('crew') || filename.includes('lng') ||
      filename.includes('container') || filename.includes('cruise') || filename.includes('ro-ro') ||
      filename.includes('vessel') || filename.includes('bulk') || filename.includes('stay-compliant') ||
      filename.includes('how-to-reduce') || filename.includes('true-cost') || filename.includes('best-') ||
      filename.includes('why-ai') || filename.includes('what-is')) return PANAMA_OG;
  return BLOG_DEFAULT_OG;
}

function generatePublishDates(numPosts) {
  const endDate = new Date('2026-04-03');
  const startDate = new Date('2026-03-04');
  const dates = [];
  const totalMs = endDate - startDate;
  for (let i = 0; i < numPosts; i++) {
    const fraction = i / (numPosts - 1);
    const dateMs = startDate.getTime() + Math.round(fraction * totalMs);
    const d = new Date(dateMs);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function fixDuplicatedText(text) {
  if (!text) return text;
  const norm = function(s) { return s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); };

  // Separate brand suffix " | Brand" if present
  var brandMatch = text.match(/^(.*?)(\s*\|\s*[^|]+)$/);
  var brand = brandMatch ? brandMatch[2] : '';
  var titlePart = brandMatch ? brandMatch[1] : text;

  var parts = titlePart.split(': ');

  if (parts.length >= 3) {
    // Check consecutive duplicates
    for (var i = 1; i < parts.length - 1; i++) {
      if (norm(parts[i]) === norm(parts[i + 1])) {
        return parts.slice(0, i + 1).join(': ') + brand;
      }
    }
    // Check if last part matches any earlier part
    var lastNorm = norm(parts[parts.length - 1]);
    for (var j = 0; j < parts.length - 1; j++) {
      if (norm(parts[j]) === lastNorm) {
        return parts.slice(0, parts.length - 1).join(': ') + brand;
      }
    }
  }

  return text;
}

// Tests
var tests = [
  ['MARPOL Compliance Checklist: All 6 Annexes: All 6 Annexes | CanalClear', 'MARPOL Compliance Checklist: All 6 Annexes | CanalClear'],
  ['Container Ship VUMPA Filing Guide: Checklist & Deadlines: Checklist &amp; Deadlines', 'Container Ship VUMPA Filing Guide: Checklist & Deadlines'],
  ['Suez Canal Transit Requirements: Complete SCA Compliance Guide: Complete SCA Compliance Guide | CanalClear', 'Suez Canal Transit Requirements: Complete SCA Compliance Guide | CanalClear'],
  ['Normal Title | Brand', 'Normal Title | Brand'],
  ['Title: Subtitle', 'Title: Subtitle'],
  ['PCSOPEP Updates: New Rules to Avoid $50K Fines: New Rules to Avoid $50K Fines | CanalClear Blog', 'PCSOPEP Updates: New Rules to Avoid $50K Fines | CanalClear Blog'],
];

var testsFailed = false;
tests.forEach(function(t) {
  var input = t[0], expected = t[1];
  var result = fixDuplicatedText(input);
  if (result !== expected) {
    console.error('FAIL: "' + input + '"');
    console.error('  Expected: "' + expected + '"');
    console.error('  Got:      "' + result + '"');
    testsFailed = true;
  }
});

if (testsFailed) {
  console.error('Tests failed! Aborting.');
  process.exit(1);
}
console.log('All dedup tests passed.');

function processBlogPost(filename, publishDate) {
  var filepath = path.join(BLOG_DIR, filename);
  var content = fs.readFileSync(filepath, 'utf8');
  var changed = false;

  // Issue 3: Fix article:author
  var authorFixed = content.replace(/(<meta property="article:author" content=")Francis(")/g, '$1Francis Eagle$2');
  if (authorFixed !== content) { content = authorFixed; changed = true; }

  var authorJsonFixed = content.replace(/"author":\s*\{\s*"@type":\s*"Person",\s*"name":\s*"Francis",/g, '"author": { "@type": "Person", "name": "Francis Eagle",');
  if (authorJsonFixed !== content) { content = authorJsonFixed; changed = true; }

  // Issue 6: Fix <title> dedup
  content = content.replace(/<title>([^<]+)<\/title>/g, function(match, t) {
    var fixed = fixDuplicatedText(t);
    if (fixed !== t) { changed = true; return '<title>' + fixed + '</title>'; }
    return match;
  });

  // Issue 6: Fix og:title dedup
  content = content.replace(/(<meta property="og:title" content=")([^"]+)(")/g, function(match, pre, t, post) {
    var decoded = t.replace(/&amp;/g, '&');
    var fixed = fixDuplicatedText(decoded);
    if (fixed !== decoded) {
      changed = true;
      var reEncoded = fixed.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
      return pre + reEncoded + post;
    }
    return match;
  });

  // Issue 6: Fix twitter:title dedup
  content = content.replace(/(<meta name="twitter:title" content=")([^"]+)(")/g, function(match, pre, t, post) {
    var decoded = t.replace(/&amp;/g, '&');
    var fixed = fixDuplicatedText(decoded);
    if (fixed !== decoded) {
      changed = true;
      var reEncoded = fixed.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
      return pre + reEncoded + post;
    }
    return match;
  });

  // Issue 6: Fix JSON-LD headline dedup
  content = content.replace(/"headline":\s*"([^"]+)"/g, function(match, h) {
    var fixed = fixDuplicatedText(h);
    if (fixed !== h) { changed = true; return '"headline": "' + fixed + '"'; }
    return match;
  });

  // Issue 7: Cluster-specific OG images
  var expectedOg = getOgImageForPost(filename);
  var ogFixed = content.replace(/(<meta property="og:image" content=")[^"]+(")/,  '$1' + expectedOg + '$2');
  if (ogFixed !== content) { content = ogFixed; changed = true; }
  var twFixed = content.replace(/(<meta name="twitter:image" content=")[^"]+(")/,  '$1' + expectedOg + '$2');
  if (twFixed !== content) { content = twFixed; changed = true; }

  // Issue 8: Spread publish dates
  if (publishDate) {
    var dateFixed = content.replace(/(<meta property="article:published_time" content=")[^"]*(")/,  '$1' + publishDate + 'T00:00:00Z$2');
    if (dateFixed !== content) { content = dateFixed; changed = true; }
    var jsonDateFixed = content.replace(/"datePublished":\s*"[^"]*"/g, '"datePublished": "' + publishDate + '"');
    if (jsonDateFixed !== content) { content = jsonDateFixed; changed = true; }
  }

  if (changed) {
    fs.writeFileSync(filepath, content, 'utf8');
    console.log('Updated: ' + filename);
  } else {
    console.log('No changes: ' + filename);
  }
}

var files = fs.readdirSync(BLOG_DIR)
  .filter(function(f) { return f.endsWith('.html') && f !== 'index.html'; })
  .sort();

console.log('Processing ' + files.length + ' blog posts...');
var dates = generatePublishDates(files.length);
files.forEach(function(filename, i) { processBlogPost(filename, dates[i]); });
console.log('\nDone! Date range: ' + dates[0] + ' to ' + dates[dates.length - 1]);
