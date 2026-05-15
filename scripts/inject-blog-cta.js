#!/usr/bin/env node
/**
 * inject-blog-cta.js — Task #1266888
 *
 * Adds to every blog post:
 *   1. Sticky dismissable CTA banner at bottom of page
 *   2. Contextual product page link (/panama or /suez) — 1 per post if missing
 *   3. /pricing link near pricing mentions — if missing
 *
 * Suez posts → "Get Transit Readiness Score" → /suez
 * Panama posts → "Get Transit Readiness Score" → /panama
 *
 * Rules:
 *   - Do NOT change blog content substance, layout, or existing headings
 *   - Only ADD links and the CTA banner
 *   - Idempotent — running twice won't add duplicates
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '../public/blog');

// ============================================================
// Which posts are Suez vs Panama
// ============================================================

const SUEZ_POSTS = new Set([
  'suez-canal-compliance-mistakes-delays',
  'suez-canal-convoy-scheduling',
  'suez-canal-dangerous-goods-compliance',
  'suez-canal-isps-compliance-guide',
  'suez-canal-pilotage-requirements',
  'suez-canal-tonnage-certificate',
  'suez-canal-transit-checklist-fleet-operators',
  'suez-canal-transit-cost-2026',
  'suez-canal-transit-requirements-complete-guide-2026',
  'suez-canal-vs-panama-canal-compliance-compared',
]);

// All other posts default to /panama

// ============================================================
// Sticky CTA Banner HTML
// Injected once, before </body>
// Dismissable via localStorage, mobile responsive
// ============================================================

function buildCtaBanner(canal) {
  const href = canal === 'suez' ? '/suez' : '/panama';
  const accentColor = canal === 'suez' ? '#2563eb' : '#00d4aa';
  const accentColorLight = canal === 'suez' ? 'rgba(37,99,235,0.12)' : 'rgba(0,212,170,0.12)';
  const borderColor = canal === 'suez' ? 'rgba(37,99,235,0.25)' : 'rgba(0,212,170,0.25)';
  const btnBg = canal === 'suez' ? '#2563eb' : '#00d4aa';
  const btnText = canal === 'suez' ? '#ffffff' : '#0a0a0a';

  return `<!-- Blog sticky CTA banner — injected by inject-blog-cta.js -->
<div id="blog-cta-banner" style="
  position:fixed;
  bottom:0;
  left:0;
  right:0;
  z-index:9999;
  background:#111827;
  border-top:1px solid ${borderColor};
  padding:12px 20px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  box-shadow:0 -4px 24px rgba(0,0,0,0.4);
">
  <p style="margin:0;color:#e5e7eb;font-size:0.92rem;line-height:1.3;flex:1;min-width:0;">
    Check your vessel's compliance score — <strong style="color:${accentColor};">free in 60 seconds</strong>
  </p>
  <a href="${href}" id="blog-cta-btn" style="
    display:inline-block;
    white-space:nowrap;
    padding:9px 18px;
    background:${btnBg};
    color:${btnText};
    font-weight:700;
    font-size:0.88rem;
    border-radius:8px;
    text-decoration:none;
    flex-shrink:0;
    transition:opacity 0.15s;
  " onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
    Get Transit Readiness Score
  </a>
  <button onclick="
    document.getElementById('blog-cta-banner').style.display='none';
    try{localStorage.setItem('cc_cta_dismissed','1');}catch(e){}
  " aria-label="Dismiss" style="
    background:none;
    border:none;
    color:#9ca3af;
    cursor:pointer;
    font-size:1.25rem;
    padding:4px 6px;
    line-height:1;
    flex-shrink:0;
  ">✕</button>
</div>
<script>
(function(){
  try{
    if(localStorage.getItem('cc_cta_dismissed')==='1'){
      var b=document.getElementById('blog-cta-banner');
      if(b) b.style.display='none';
    }
  }catch(e){}
})();
</script>`;
}

// ============================================================
// Product page contextual link
// One inline CTA per post linking to /panama or /suez
// Injected as a small note after the first CTA section or
// after the first paragraph that mentions the canal name
// ============================================================

function buildProductLink(canal) {
  if (canal === 'suez') {
    return `<!-- blog-product-link-injected -->\n<p style="margin-top:1rem;"><a href="/suez" style="color:#2563eb;font-weight:600;text-decoration:underline;">→ Check your Suez Canal Transit Readiness Score — free at CanalClear</a></p>`;
  }
  return `<!-- blog-product-link-injected -->\n<p style="margin-top:1rem;"><a href="/panama" style="color:#00d4aa;font-weight:600;text-decoration:underline;">→ Check your Panama Canal Transit Readiness Score — free at CanalClear</a></p>`;
}

function buildPricingLink() {
  return `<p style="margin-top:-0.5rem;font-size:0.9rem;"><a href="/pricing" style="color:#00d4aa;text-decoration:underline;">→ See CanalClear pricing — plans starting at $199/vessel/month</a></p>`;
}

// ============================================================
// MAIN
// ============================================================

const blogFiles = fs.readdirSync(BLOG_DIR)
  .filter(f => f.endsWith('.html') && f !== 'index.html');

let bannersAdded = 0;
let productLinksAdded = 0;
let pricingLinksAdded = 0;
let skipped = 0;

for (const file of blogFiles) {
  const slug = file.replace('.html', '');
  const filePath = path.join(BLOG_DIR, file);
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const canal = SUEZ_POSTS.has(slug) ? 'suez' : 'panama';
  const productHref = canal === 'suez' ? '/suez' : '/panama';

  // ---- 2. Product page contextual link (check BEFORE banner injection) ----
  // Use a distinctive comment marker to check idempotency, not the href
  // (the banner also contains the product href, causing false-positive skip)
  const productLinkMarker = `blog-product-link-injected`;
  if (!html.includes(productLinkMarker)) {
    const productLink = buildProductLink(canal);
    // Find a good insertion point:
    // Try: after the first .cta-section div, or before Related Reading,
    // or before the closing </article> tag — whichever comes first.
    if (html.includes('class="cta-section"')) {
      // Insert after the first cta-section closing div
      html = html.replace(
        /(class="cta-section"[\s\S]*?<\/div>)/,
        (match) => `${match}\n${productLink}`
      );
      productLinksAdded++;
      changed = true;
    } else if (html.includes('<h2>Related Reading</h2>')) {
      html = html.replace(
        '<h2>Related Reading</h2>',
        `${productLink}\n  <h2>Related Reading</h2>`
      );
      productLinksAdded++;
      changed = true;
    } else if (html.includes('<!-- Internal cross-links injected')) {
      html = html.replace(
        '<!-- Internal cross-links injected',
        `${productLink}\n    <!-- Internal cross-links injected`
      );
      productLinksAdded++;
      changed = true;
    } else if (html.includes('</article>')) {
      // Fallback: before closing article
      html = html.replace(
        '</article>',
        `${productLink}\n</article>`
      );
      productLinksAdded++;
      changed = true;
    }
  }

  // ---- 3. /pricing link (idempotent check) ----
  // Only for Panama posts (Suez links to /suez which covers the conversion ask)
  if (canal === 'panama' && !html.includes('href="/pricing"')) {
    const pricingKeywords = ['$65K', '$50K', '$15K', '$300,000', 'compliance software', 'automate compliance'];
    const hasPricingMention = pricingKeywords.some(kw => html.includes(kw));
    if (hasPricingMention) {
      const pricingLink = buildPricingLink();
      // Insert after first paragraph containing a pricing mention
      const replaced = html.replace(
        /(<p[^>]*>(?:[^<]|<(?!\/p>))*?(?:\$65K|\$50K|\$15K|\$300,000|compliance software|automate compliance)(?:[^<]|<(?!\/p>))*?<\/p>)/,
        (match) => {
          if (match.length > 30 && !match.includes('href=')) {
            pricingLinksAdded++;
            changed = true;
            return match + '\n' + pricingLink;
          }
          return match;
        }
      );
      if (replaced !== html) {
        html = replaced;
      }
    }
  }

  // ---- 1. Sticky CTA banner (last step, idempotent check) ----
  if (!html.includes('blog-cta-banner')) {
    const banner = buildCtaBanner(canal);
    // Insert just before </body>
    html = html.replace('</body>', `${banner}\n</body>`);
    bannersAdded++;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`✅ ${slug} [canal:${canal}]`);
  } else {
    skipped++;
  }
}

console.log('\n========================================');
console.log(`✅ Sticky CTA banners added:    ${bannersAdded}`);
console.log(`✅ Product page links added:    ${productLinksAdded}`);
console.log(`✅ Pricing links added:         ${pricingLinksAdded}`);
console.log(`ℹ️  Already up-to-date (skipped): ${skipped}`);
console.log('========================================');
