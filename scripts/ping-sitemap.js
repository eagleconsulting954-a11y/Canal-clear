#!/usr/bin/env node
/**
 * ping-sitemap.js
 * Submits sitemap to Google + notifies all search engines via IndexNow.
 * Runs as part of build (non-blocking — build succeeds even if pings fail).
 *
 * IndexNow: notifies Google, Bing, Yandex simultaneously.
 * Google sitemap ping: backup notification via programmatic ping.
 */

const https = require('https');
const http = require('http');

const SITEMAP_URL = 'https://canalclear.org/sitemap.xml';
const INDEXNOW_KEY = '556c6401141c668d8e81d8715dcc3f18';
const HOST = 'canalclear.org';

const BLOG_URLS = [
  // ── Core pages ──────────────────────────────────────────────────────────────
  'https://canalclear.org/',
  'https://canalclear.org/pricing',
  'https://canalclear.org/demo',
  'https://canalclear.org/compliance-score',
  'https://canalclear.org/hazmat',
  'https://canalclear.org/case-study',
  'https://canalclear.org/compliance-guide',
  'https://canalclear.org/guide',
  'https://canalclear.org/compare',
  'https://canalclear.org/knowledge-base',
  'https://canalclear.org/about',
  // ── Blog index ──────────────────────────────────────────────────────────────
  'https://canalclear.org/blog',
  // ── Blog posts — Batch 1 (original) ────────────────────────────────────────
  'https://canalclear.org/blog/why-ai-is-the-future-of-panama-canal-compliance',
  'https://canalclear.org/blog/how-to-avoid-panama-canal-compliance-fines-in-2026',
  'https://canalclear.org/blog/panama-canal-transit-documents-required',
  'https://canalclear.org/blog/how-to-file-vumpa-panama-canal',
  'https://canalclear.org/blog/panama-canal-compliance-checklist-2026',
  'https://canalclear.org/blog/pcsopep-requirements-panama-canal',
  'https://canalclear.org/blog/what-is-port-state-control',
  'https://canalclear.org/blog/marpol-compliance-checklist-ship-operators-2026',
  'https://canalclear.org/blog/how-to-reduce-shipping-delays',
  'https://canalclear.org/blog/true-cost-of-non-compliance-global-shipping',
  'https://canalclear.org/blog/panama-canal-vumpa-requirements-2026',
  'https://canalclear.org/blog/how-to-file-pcsopep-panama-canal',
  'https://canalclear.org/blog/panama-canal-compliance-checklist-fleet-operators',
  'https://canalclear.org/blog/panama-canal-compliance-complete-guide-2026',
  'https://canalclear.org/blog/vumpa-filing-requirements-step-by-step',
  'https://canalclear.org/blog/pcsopep-documentation-complete-guide',
  'https://canalclear.org/blog/pcsopep-requirements-2026',
  'https://canalclear.org/blog/vumpa-digital-submission-guide-2026',
  'https://canalclear.org/blog/vessel-readiness-inspection-panama-canal',
  'https://canalclear.org/blog/best-maritime-compliance-podcasts-2026',
  'https://canalclear.org/blog/stay-compliant-panama-canal-regulations-listen-while-you-work',
  'https://canalclear.org/blog/panama-canal-toll-calculator-2026',
  // ── Blog posts — Batch 2 (2026-04-22) ──────────────────────────────────────
  'https://canalclear.org/blog/panama-canal-compliance-bulk-carriers',
  'https://canalclear.org/blog/panama-canal-transit-documents-lng-tankers',
  'https://canalclear.org/blog/container-ship-vumpa-filing-guide-2026',
  'https://canalclear.org/blog/ro-ro-vessel-panama-canal-documentation',
  'https://canalclear.org/blog/cruise-ship-panama-canal-requirements',
  'https://canalclear.org/blog/pcsopep-certificate-requirements-panama-canal-2026',
  'https://canalclear.org/blog/panama-canal-crew-manifest-requirements',
  'https://canalclear.org/blog/cargo-declaration-rules-panama-canal-transit',
  'https://canalclear.org/blog/panama-canal-environmental-compliance',
  'https://canalclear.org/blog/panama-canal-non-compliance-cost',
  'https://canalclear.org/blog/panama-canal-filing-mistakes-delays',
  'https://canalclear.org/blog/panama-canal-filing-automation-vs-manual',
  // ── Blog posts — Batch 3 (2026-04-23) ──────────────────────────────────────
  'https://canalclear.org/blog/lng-tanker-panama-canal-transit-documents',
  'https://canalclear.org/blog/panama-canal-non-compliance-costs-penalties',
  'https://canalclear.org/blog/panama-canal-transit-denial-reasons',
  'https://canalclear.org/blog/best-panama-canal-compliance-tools-2026',
  // ── Suez Canal posts — NEW (2026-04-23/24) ─────────────────────────────────
  'https://canalclear.org/blog/suez-canal-transit-requirements-complete-guide-2026',
  'https://canalclear.org/blog/suez-canal-vs-panama-canal-compliance-compared',
  'https://canalclear.org/blog/suez-canal-compliance-mistakes-delays',
  'https://canalclear.org/blog/suez-canal-isps-compliance-guide',
  'https://canalclear.org/blog/suez-canal-transit-checklist-fleet-operators',
  // ── Podcast hub + episodes ──────────────────────────────────────────────────
  'https://canalclear.org/podcast',
  'https://canalclear.org/podcast/episode-1',
  'https://canalclear.org/podcast/episode-2',
  'https://canalclear.org/podcast/episode-3',
  'https://canalclear.org/podcast/episode-4',
  'https://canalclear.org/podcast/episode-5',
  'https://canalclear.org/podcast/episode-6',
  'https://canalclear.org/podcast/episode-7',
  'https://canalclear.org/podcast/episode-8',
  'https://canalclear.org/podcast/episode-9',
  'https://canalclear.org/podcast/episode-10',
  'https://canalclear.org/podcast/episode-11',
  'https://canalclear.org/podcast/episode-12',
  'https://canalclear.org/podcast/episode-13',
  'https://canalclear.org/podcast/episode-14',
  'https://canalclear.org/podcast/episode-15',
  // ── Glossary + Compliance programmatic SEO pages ────────────────────────────
  'https://canalclear.org/glossary',
  'https://canalclear.org/compliance',
  'https://canalclear.org/compliance/bulk-carrier-vumpa',
  'https://canalclear.org/compliance/bulk-carrier-pcsopep',
  'https://canalclear.org/compliance/bulk-carrier-crew-manifest',
  'https://canalclear.org/compliance/bulk-carrier-cargo-declaration',
  'https://canalclear.org/compliance/container-ship-vumpa',
  'https://canalclear.org/compliance/container-ship-pcsopep',
  'https://canalclear.org/compliance/container-ship-crew-manifest',
  'https://canalclear.org/compliance/container-ship-cargo-declaration',
  'https://canalclear.org/compliance/tanker-vumpa',
  'https://canalclear.org/compliance/tanker-pcsopep',
  'https://canalclear.org/compliance/tanker-crew-manifest',
  'https://canalclear.org/compliance/tanker-cargo-declaration',
  'https://canalclear.org/compliance/ro-ro-vessel-vumpa',
  'https://canalclear.org/compliance/ro-ro-vessel-pcsopep',
  'https://canalclear.org/compliance/ro-ro-vessel-crew-manifest',
  'https://canalclear.org/compliance/ro-ro-vessel-cargo-declaration',
  'https://canalclear.org/compliance/lng-carrier-vumpa',
  'https://canalclear.org/compliance/lng-carrier-pcsopep',
  'https://canalclear.org/compliance/lng-carrier-crew-manifest',
  'https://canalclear.org/compliance/lng-carrier-cargo-declaration',
];

function httpGet(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith('https');
    const mod = isHttps ? https : http;
    const timeout = setTimeout(() => {
      console.log(`  ⏱ Timed out after ${timeoutMs}ms: ${url}`);
      resolve({ status: -1, body: 'TIMEOUT' });
    }, timeoutMs);

    const req = mod.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        clearTimeout(timeout);
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ status: -1, body: err.message });
    });

    req.setTimeout(timeoutMs);
  });
}

async function pingGoogleSitemap() {
  const url = `https://www.google.com/ping?sitemap=${encodeURIComponent(SITEMAP_URL)}`;
  console.log(`\n📡 Pinging Google sitemap: ${url}`);
  try {
    const result = await httpGet(url);
    if (result.status === 200) {
      console.log(`  ✅ Google sitemap ping — HTTP ${result.status}`);
    } else {
      console.log(`  ⚠ Google responded — HTTP ${result.status}`);
    }
    return result;
  } catch (err) {
    console.log(`  ⚠ Google sitemap ping failed: ${err.message}`);
    return null;
  }
}

async function pingIndexNow(urlList) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
      urlList,
    });

    const options = {
      hostname: 'api.indexnow.org',
      path: '/indexnow',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });

    req.on('error', (err) => resolve({ status: -1, body: err.message }));
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('\n🔔 Canal Clear — Sitemap & IndexNow Pinger');
  console.log('═'.repeat(50));

  // 1. Ping Google sitemap
  await pingGoogleSitemap();

  // 2. Ping IndexNow (Google + Bing + Yandex)
  console.log(`\n📡 Pinging IndexNow for ${BLOG_URLS.length} URLs on ${HOST}...`);
  console.log(`  Key: ${INDEXNOW_KEY}`);
  console.log(`  Key location: https://${HOST}/${INDEXNOW_KEY}.txt`);

  const result = await pingIndexNow(BLOG_URLS);

  if (result.status === 200 || result.status === 202) {
    console.log(`\n  ✅ IndexNow accepted — HTTP ${result.status}`);
    console.log('  URLs submitted:');
    BLOG_URLS.forEach((u) => console.log(`    ${u}`));
  } else if (result.status === 422) {
    console.log(`\n  ⚠ IndexNow rejected (422) — URLs may not match host or key is wrong`);
    console.log('  Response:', result.body);
  } else if (result.status === 403) {
    console.log(`\n  ⚠ IndexNow forbidden (403) — key file not found or key mismatch`);
    console.log('  Check: https://' + HOST + '/' + INDEXNOW_KEY + '.txt');
  } else if (result.status === -1) {
    console.log(`\n  ⚠ IndexNow unreachable (${result.body}) — network may be restricted`);
    console.log('  Note: IndexNow ping will be retried on next deploy.');
  } else {
    console.log(`\n  ⚠ IndexNow responded — HTTP ${result.status}: ${result.body}`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('✅ Sitemap ping complete.\n');

  // Always exit 0 — build should not fail if pings fail
  process.exit(0);
}

main().catch((err) => {
  console.error('Ping script error:', err.message);
  process.exit(0); // non-blocking
});