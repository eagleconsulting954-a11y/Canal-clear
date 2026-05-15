/**
 * Test the fixed splitIntoChunks function (improved algorithm).
 * Run: node scripts/test-tts-chunks.js
 *
 * Algorithm:
 *  1. Try to split at ". " (sentence boundary)
 *  2. Fall back to nearest space if no good sentence break within 60% of maxLen
 *  3. Hard cut at maxLen as last resort
 *  4. Force-split any chunk still exceeding maxLen at word boundary
 */
const fs = require('fs');
const path = require('path');

function splitIntoChunks(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cutAt = remaining.lastIndexOf('. ', maxLen);
    // If no good sentence break within 60% of maxLen, use word boundary
    if (cutAt < maxLen * 0.6) {
      cutAt = remaining.lastIndexOf(' ', maxLen);
    }
    // Last resort: hard cut at maxLen
    if (cutAt <= 0) cutAt = maxLen;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  // Safety net: force-split any chunk that still exceeds maxLen
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxLen) return [chunk];
    const sub = [];
    let s = chunk;
    while (s.length > maxLen) {
      const cut = s.lastIndexOf(' ', maxLen);
      sub.push(s.slice(0, cut > 0 ? cut : maxLen));
      s = s.slice(cut > 0 ? cut : maxLen);
    }
    if (s) sub.push(s);
    return sub;
  });
}

function extractBlogText(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = html.match(/<article[^>]*class="article-body"[^>]*>([\s\S]*?)<\/article>/i);
  if (!bodyMatch) return title;
  let body = bodyMatch[1];
  body = body.replace(/<div[^>]*class="cta-section"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<p[^>]*style="font-size:0\.875rem[\s\S]*?<\/p>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();
  return title ? title + '. ' + body : body;
}

function extractPodcastText(html) {
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const bodyMatch = html.match(/class="article-inner"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
  if (!bodyMatch) return title;
  let body = bodyMatch[1];
  body = body.replace(/<div[^>]*class="stats-box"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<div[^>]*class="show-notes"[^>]*>[\s\S]*?<\/div>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.replace(/<[^>]+>/g, ' ');
  body = body.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, ' — ').replace(/&ndash;/g, ' – ').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/g, ' ');
  body = body.replace(/\s+/g, ' ').trim();
  return title ? title + '. ' + body : body;
}

let allPassed = true;

// Test 1: Blog post "how-to-reduce-shipping-delays" — the original failing file
try {
  const blogHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'blog', 'how-to-reduce-shipping-delays.html'), 'utf8');
  const blogText = extractBlogText(blogHtml);
  const blogChunks = splitIntoChunks(blogText, 3800);
  const oversize = blogChunks.filter(c => c.length > 3800);
  console.log('TEST 1 - Blog "how-to-reduce-shipping-delays":');
  console.log('  Text length:', blogText.length);
  console.log('  Chunks:', blogChunks.length);
  console.log('  Chunk sizes:', blogChunks.map(c => c.length));
  console.log('  Oversize chunks (>3800):', oversize.length);
  if (oversize.length > 0) {
    console.log('  FAIL: Found oversized chunks:', oversize.map(c => c.length));
    allPassed = false;
  } else {
    console.log('  PASS');
  }
} catch (err) {
  console.log('  ERROR:', err.message);
  allPassed = false;
}

// Test 2: Podcast "episode-9" — the original failing episode
try {
  const podHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'podcast', 'episode-9.html'), 'utf8');
  const podText = extractPodcastText(podHtml);
  const podChunks = splitIntoChunks(podText, 3800);
  const oversize = podChunks.filter(c => c.length > 3800);
  console.log('\nTEST 2 - Podcast "episode-9":');
  console.log('  Text length:', podText.length);
  console.log('  Chunks:', podChunks.length);
  console.log('  Chunk sizes:', podChunks.map(c => c.length));
  console.log('  Oversize chunks (>3800):', oversize.length);
  if (oversize.length > 0) {
    console.log('  FAIL: Found oversized chunks:', oversize.map(c => c.length));
    allPassed = false;
  } else {
    console.log('  PASS');
  }
} catch (err) {
  console.log('  ERROR:', err.message);
  allPassed = false;
}

// Test 3: Edge case — text with no sentence boundaries (force-split at word boundary)
try {
  const longText = 'wordx '.repeat(1000).trim(); // ~6000 chars, no periods
  const edgeChunks = splitIntoChunks(longText, 3800);
  const oversize = edgeChunks.filter(c => c.length > 3800);
  console.log('\nTEST 3 - Edge case (no sentence boundaries):');
  console.log('  Text length:', longText.length);
  console.log('  Chunks:', edgeChunks.length);
  console.log('  Chunk sizes:', edgeChunks.map(c => c.length));
  console.log('  Oversize (>3800):', oversize.length);
  if (oversize.length > 0) {
    console.log('  FAIL');
    allPassed = false;
  } else {
    console.log('  PASS');
  }
} catch (err) {
  console.log('  ERROR:', err.message);
  allPassed = false;
}

// Test 4: Edge case — single sentence exceeding maxLen (triggers safety net)
try {
  // A sentence with 4500 "wordx " segments — no spaces except between segments
  // This simulates a paragraph with a single run-on sentence > maxLen
  const runOn = 'wordx '.repeat(500) + 'wordx'; // ~4505 chars total
  const edgeChunks = splitIntoChunks(runOn, 3800);
  const oversize = edgeChunks.filter(c => c.length > 3800);
  console.log('\nTEST 4 - Edge case (single run-on sentence > maxLen):');
  console.log('  Text length:', runOn.length);
  console.log('  Chunks:', edgeChunks.length);
  console.log('  Chunk sizes:', edgeChunks.map(c => c.length));
  console.log('  Oversize (>3800):', oversize.length);
  if (oversize.length > 0) {
    console.log('  FAIL');
    allPassed = false;
  } else {
    console.log('  PASS');
  }
} catch (err) {
  console.log('  ERROR:', err.message);
  allPassed = false;
}

// Test 5: All blog posts
try {
  const blogDir = path.join(__dirname, '..', 'public', 'blog');
  const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
  const results = [];
  for (const file of files) {
    const html = fs.readFileSync(path.join(blogDir, file), 'utf8');
    const text = extractBlogText(html);
    const chunks = splitIntoChunks(text, 3800);
    const oversize = chunks.filter(c => c.length > 3800);
    results.push({ file, textLen: text.length, chunks: chunks.length, oversize: oversize.length });
  }
  const allBlogPass = results.every(r => r.oversize === 0);
  console.log('\nTEST 5 - All blog posts (at 3800-char limit):');
  for (const r of results) {
    console.log('  ' + r.file + ': text=' + r.textLen + ', chunks=' + r.chunks + ', oversize=' + r.oversize);
  }
  console.log('  ' + (allBlogPass ? 'PASS' : 'FAIL'));
  if (!allBlogPass) allPassed = false;
} catch (err) {
  console.log('  ERROR:', err.message);
  allPassed = false;
}

console.log('\n' + (allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(allPassed ? 0 : 1);