
const OpenAI = require('openai');
const fetch = require('node-fetch');
const FormData = require('form-data');

const openai = new OpenAI({
  baseURL: process.env.OPENAI_BASE_URL,
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateImage(prompt, label) {
  console.log('[' + label + '] Generating...');
  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    size: '1792x1024',
    quality: 'standard',
    n: 1,
  });
  return response.data[0].url;
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed: ' + res.status);
  return res.buffer();
}

async function uploadToR2(buffer, filename) {
  const formData = new FormData();
  formData.append('file', buffer, { filename, contentType: 'image/png' });
  const res = await fetch('https://polsia.com/api/proxy/r2/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.POLSIA_API_KEY, ...formData.getHeaders() },
    body: formData,
  });
  const result = await res.json();
  if (!result.success) throw new Error('R2 upload failed: ' + JSON.stringify(result));
  return result.file.url;
}

const images = [
  {
    label: 'og-calculator',
    filename: 'og-calculator.png',
    prompt: 'Professional social media card for maritime compliance SaaS. Dark navy background #060d1a. Left: bold white headline What Is Your Fleet Rejection Exposure, subtitle Calculate annual loss from Panama Canal filing errors in gray. Right side: two vertical bars chart, tall dark red bar labeled Manual Filing with dollar amount 2847000 in orange above, short green bar labeled CanalClear with 114000 in green. Orange accent color #E85A00. Bottom right: CanalClear wordmark orange. Top left CC monogram orange. Landscape 16:9. No photos, no people, data viz aesthetic.',
  },
  {
    label: 'og-default',
    filename: 'og-default.png',
    prompt: 'Professional social media card for CanalClear maritime compliance software. Dark navy background. Center: bold white headline AI-Powered Canal Compliance. Below in orange: Panama Suez Bosporus Malacca Cape of Good Hope. Below in gray: Replace ship agent fees with automated pre-submission validation. Bottom: canal-clear.polsia.app in cyan. Top left: CC monogram and CanalClear in orange. Abstract shipping route lines. Landscape 16:9. No photos. Premium dark SaaS aesthetic.',
  }
];

async function main() {
  for (const img of images) {
    try {
      const url = await generateImage(img.prompt, img.label);
      console.log('[' + img.label + '] URL: ' + url.substring(0, 80));
      const buf = await downloadImage(url);
      console.log('[' + img.label + '] Size: ' + (buf.length/1024).toFixed(1) + 'KB');
      const r2url = await uploadToR2(buf, img.filename);
      console.log('[' + img.label + '] R2: ' + r2url);
    } catch(e) {
      console.error('[' + img.label + '] Error: ' + e.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
