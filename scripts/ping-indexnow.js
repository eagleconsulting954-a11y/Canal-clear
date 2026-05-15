#!/usr/bin/env node
/**
 * ping-indexnow.js
 * Submits URLs to IndexNow (Google, Bing, Yandex via api.indexnow.org).
 * Run: node scripts/ping-indexnow.js
 *
 * IndexNow replaces the deprecated Google/Bing sitemap ping endpoints.
 * Key file must be live at: https://canalclear.org/{key}.txt
 */

const https = require('https');

const INDEXNOW_KEY = '556c6401141c668d8e81d8715dcc3f18';
const HOST = 'canalclear.org';

// All blog URLs to notify — add new slugs here when publishing
const URLS = [
  'https://canalclear.org/',
  'https://canalclear.org/about',
  'https://canalclear.org/blog/how-to-avoid-panama-canal-compliance-fines-in-2026',
  'https://canalclear.org/blog/how-to-file-pcsopep-panama-canal',
  'https://canalclear.org/blog/how-to-file-vumpa-panama-canal',
  'https://canalclear.org/blog/how-to-reduce-shipping-delays',
  'https://canalclear.org/blog/marpol-compliance-checklist-ship-operators-2026',
  'https://canalclear.org/blog/panama-canal-compliance-checklist-2026',
  'https://canalclear.org/blog/panama-canal-compliance-checklist-fleet-operators',
  'https://canalclear.org/blog/panama-canal-compliance-complete-guide-2026',
  'https://canalclear.org/blog/panama-canal-transit-documents-required',
  'https://canalclear.org/blog/panama-canal-vumpa-requirements-2026',
  'https://canalclear.org/blog/pcsopep-documentation-complete-guide',
  'https://canalclear.org/blog/pcsopep-requirements-2026',
  'https://canalclear.org/blog/pcsopep-requirements-panama-canal',
  'https://canalclear.org/blog/true-cost-of-non-compliance-global-shipping',
  'https://canalclear.org/blog/vessel-readiness-inspection-panama-canal',
  'https://canalclear.org/blog/vumpa-digital-submission-guide-2026',
  'https://canalclear.org/blog/vumpa-filing-requirements-step-by-step',
  'https://canalclear.org/blog/what-is-port-state-control',
  'https://canalclear.org/blog/why-ai-is-the-future-of-panama-canal-compliance',
  'https://canalclear.org/compliance-guide',
  'https://canalclear.org/knowledge-base',
  'https://canalclear.org/podcast',
  'https://canalclear.org/podcast/episode-1',
  'https://canalclear.org/podcast/episode-10',
  'https://canalclear.org/podcast/episode-14',
  'https://canalclear.org/podcast/episode-15',
  'https://canalclear.org/podcast/episode-2',
  'https://canalclear.org/podcast/episode-3',
  'https://canalclear.org/podcast/episode-4',
  'https://canalclear.org/podcast/episode-5',
  'https://canalclear.org/podcast/episode-6',
  'https://canalclear.org/podcast/episode-7',
  'https://canalclear.org/podcast/episode-8',
  'https://canalclear.org/podcast/episode-9',
  'https://canalclear.org/pricing',
];

function pingIndexNow(urlList) {
  return new Promise((resolve, reject) => {
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
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: body || '(empty — expected for 200/202)' });
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log(`Pinging IndexNow for ${URLS.length} URLs on ${HOST}...`);
  console.log('Key location:', `https://${HOST}/${INDEXNOW_KEY}.txt\n`);

  try {
    const result = await pingIndexNow(URLS);
    if (result.status === 200 || result.status === 202) {
      console.log(`✅ IndexNow accepted — HTTP ${result.status}`);
      console.log('URLs submitted:');
      URLS.forEach((u) => console.log(' ', u));
    } else if (result.status === 422) {
      console.error('❌ IndexNow rejected (422) — URLs may not match host or key is wrong');
      console.log('Response:', result.body);
    } else if (result.status === 403) {
      console.error('❌ IndexNow forbidden (403) — key file not found or key mismatch');
      console.log('Check that https://${HOST}/${INDEXNOW_KEY}.txt returns the key value');
    } else {
      console.log(`Response HTTP ${result.status}:`, result.body);
    }
  } catch (err) {
    console.error('IndexNow ping failed:', err.message);
    process.exit(1);
  }
}

main();
