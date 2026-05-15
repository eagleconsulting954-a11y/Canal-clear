const https = require('https');
const fs = require('fs');
const path = require('path');

// Config
const OPENAI_API_KEY = 'company_47541_70e1c33f6dacab23f194828649a999ed';
const OPENAI_BASE_URL = 'https://polsia.com/ai/openai/v1';

const prompt = `A professional maritime product demo video for CanalClear, a Panama Canal customs compliance automation platform.

Opening shot: A massive container ship navigating the Panama Canal at golden hour, aerial view showing the locks. Text overlay: "CanalClear"

Scene 2: Close-up of a ship bridge with a captain reviewing documents on a tablet showing a clean dashboard interface with compliance indicators glowing teal/green.

Scene 3: Split screen - left shows chaotic paperwork with red error marks labeled "Before: Manual Filing Errors"; right shows clean CanalClear interface with green checkmarks labeled "After: Zero Surprises"

Scene 4: Dashboard walkthrough - VUMPA filing status, PCSOPEP documentation, ACP regulation checker - glowing teal on dark navy background

Scene 5: ROI statistics: "$65K+ risk eliminated", "fraction of ship agent costs", fast filing automation

Closing: Container ship passing through Canal locks. Text: "One Platform, Zero Surprises"

Style: Cinematic, professional maritime. Dark navy and teal color palette. Trustworthy, authoritative.`;

async function callAPI(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(OPENAI_BASE_URL + endpoint);
    const postData = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('Attempting Sora video generation via Polsia AI proxy...');

  // Try sora-2
  const result = await callAPI('/video/generations', {
    model: 'sora-2',
    prompt: prompt,
    size: '1280x720',
    n: 1,
    duration: 10
  });

  console.log('Status:', result.status);
  console.log('Response:', JSON.stringify(result.body, null, 2));
}

main().catch(console.error);
