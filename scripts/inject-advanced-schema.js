#!/usr/bin/env node
/**
 * inject-advanced-schema.js
 * Injects advanced schema markup across canalclear.org:
 *  - BreadcrumbList on all blog posts, podcast episodes, and key pages
 *  - Enhances Organization schema on index.html
 *  - Adds WebSite + SearchAction schema to index.html
 *  - Adds SoftwareApplication schema with pricing tiers to pricing.html
 *  - Adds Podcast series schema to podcast.html
 * Run: node scripts/inject-advanced-schema.js
 */

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

// ─── Helper: inject JSON-LD before </head> ───────────────────────────────────
function injectJsonLd(filePath, schemaObj, comment) {
  let html = fs.readFileSync(filePath, 'utf8');
  const tag = `\n    <!-- ${comment} -->\n    <script type="application/ld+json">\n    ${JSON.stringify(schemaObj, null, 2).replace(/^/gm, '    ').trim()}\n    </script>`;
  if (!html.includes('</head>')) {
    console.warn(`  ⚠ No </head> found in ${path.basename(filePath)}, skipping`);
    return false;
  }
  html = html.replace('</head>', tag + '\n</head>');
  fs.writeFileSync(filePath, html, 'utf8');
  return true;
}

// ─── Helper: replace a JSON-LD block ─────────────────────────────────────────
function replaceJsonLdByType(filePath, typeName, newSchemaObj) {
  let html = fs.readFileSync(filePath, 'utf8');
  // Match the script block containing @type: typeName
  const regex = new RegExp(
    `(<script type="application/ld\\+json">\\s*\\{[^<]*"@type":\\s*"${typeName}"[^<]*</script>)`,
    's'
  );
  if (!regex.test(html)) return false;
  const replacement = `<script type="application/ld+json">\n    ${JSON.stringify(newSchemaObj, null, 2).replace(/^/gm, '    ').trim()}\n    </script>`;
  html = html.replace(regex, replacement);
  fs.writeFileSync(filePath, html, 'utf8');
  return true;
}

// ─── BreadcrumbList: Blog Posts ───────────────────────────────────────────────
function buildBlogBreadcrumb(pageUrl, postTitle) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://canalclear.org/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Blog',
        item: 'https://canalclear.org/blog',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: postTitle,
        item: pageUrl,
      },
    ],
  };
}

// ─── BreadcrumbList: Podcast Episodes ────────────────────────────────────────
function buildPodcastBreadcrumb(pageUrl, episodeTitle) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://canalclear.org/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Podcast',
        item: 'https://canalclear.org/podcast',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: episodeTitle,
        item: pageUrl,
      },
    ],
  };
}

// ─── BreadcrumbList: Simple two-level pages ───────────────────────────────────
function buildSimpleBreadcrumb(pageUrl, pageName) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://canalclear.org/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: pageName,
        item: pageUrl,
      },
    ],
  };
}

// ─── Read headline/title from HTML ───────────────────────────────────────────
function getHeadlineFromFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  // Try "headline" field in JSON-LD
  const m = html.match(/"headline":\s*"([^"]+)"/);
  if (m) return m[1];
  // Fallback to <title> tag
  const t = html.match(/<title>([^<]+)<\/title>/);
  if (t) return t[1].replace(/ — .*$/, '').replace(/ \| .*$/, '').trim();
  return null;
}

function getCanonicalUrl(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const m = html.match(/rel="canonical"\s+href="([^"]+)"/);
  return m ? m[1] : null;
}

function hasBreadcrumb(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  return html.includes('BreadcrumbList');
}

// ─── Process Blog Posts ───────────────────────────────────────────────────────
function processBlogPosts() {
  const blogDir = path.join(PUBLIC, 'blog');
  const files = fs.readdirSync(blogDir).filter(f => f.endsWith('.html') && f !== 'index.html');
  let count = 0;
  for (const file of files) {
    const filePath = path.join(blogDir, file);
    if (hasBreadcrumb(filePath)) {
      console.log(`  ↷ Blog: ${file} — BreadcrumbList already present, skipping`);
      continue;
    }
    const url = getCanonicalUrl(filePath);
    const title = getHeadlineFromFile(filePath);
    if (!url || !title) {
      console.warn(`  ⚠ Blog: ${file} — missing canonical or headline, skipping`);
      continue;
    }
    const schema = buildBlogBreadcrumb(url, title);
    if (injectJsonLd(filePath, schema, 'Schema: BreadcrumbList')) {
      console.log(`  ✓ Blog: ${file}`);
      count++;
    }
  }
  console.log(`Blog posts: ${count} breadcrumbs added`);
}

// ─── Process Podcast Episodes ─────────────────────────────────────────────────
function processPodcastEpisodes() {
  const podcastDir = path.join(PUBLIC, 'podcast');
  const files = fs.readdirSync(podcastDir).filter(f => f.startsWith('episode-') && f.endsWith('.html'));
  let count = 0;
  for (const file of files) {
    const filePath = path.join(podcastDir, file);
    if (hasBreadcrumb(filePath)) {
      console.log(`  ↷ Podcast: ${file} — BreadcrumbList already present, skipping`);
      continue;
    }
    const url = getCanonicalUrl(filePath);
    const title = getHeadlineFromFile(filePath);
    if (!url || !title) {
      console.warn(`  ⚠ Podcast: ${file} — missing canonical or headline, skipping`);
      continue;
    }
    const schema = buildPodcastBreadcrumb(url, title);
    if (injectJsonLd(filePath, schema, 'Schema: BreadcrumbList')) {
      console.log(`  ✓ Podcast: ${file}`);
      count++;
    }
  }
  console.log(`Podcast episodes: ${count} breadcrumbs added`);
}

// ─── Process Key Pages ────────────────────────────────────────────────────────
function processKeyPages() {
  const pages = [
    { file: 'pricing.html', url: 'https://canalclear.org/pricing', name: 'Pricing' },
    { file: 'compliance-guide.html', url: 'https://canalclear.org/compliance-guide', name: 'Compliance Guide' },
    { file: 'about.html', url: 'https://canalclear.org/about', name: 'About' },
    { file: 'knowledge-base.html', url: 'https://canalclear.org/knowledge-base', name: 'Knowledge Base' },
    { file: 'podcast.html', url: 'https://canalclear.org/podcast', name: 'Podcast' },
  ];
  let count = 0;
  for (const { file, url, name } of pages) {
    const filePath = path.join(PUBLIC, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠ ${file} not found, skipping`);
      continue;
    }
    if (hasBreadcrumb(filePath)) {
      console.log(`  ↷ ${file} — BreadcrumbList already present, skipping`);
      continue;
    }
    const schema = buildSimpleBreadcrumb(url, name);
    if (injectJsonLd(filePath, schema, 'Schema: BreadcrumbList')) {
      console.log(`  ✓ ${file}`);
      count++;
    }
  }
  console.log(`Key pages: ${count} breadcrumbs added`);
}

// ─── Enhance index.html ───────────────────────────────────────────────────────
function enhanceIndexHtml() {
  const filePath = path.join(PUBLIC, 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // 1. Update Organization schema — add foundingDate, sameAs, better logo
  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'CanalClear',
    url: 'https://canalclear.org',
    logo: {
      '@type': 'ImageObject',
      url: 'https://canalclear.org/CanalClear_Logo.png',
      width: 400,
      height: 120,
    },
    description:
      'CanalClear is an AI-powered Panama Canal compliance automation platform that handles VUMPA filings, PCSOPEP documentation, and pre-transit validation for fleet operators, ship agents, and charterers.',
    foundingDate: '2025',
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'support@canalclear.org',
      availableLanguage: ['English', 'Spanish', 'Chinese', 'Greek', 'Japanese'],
    },
    sameAs: [
      'https://www.producthunt.com/products/canalclear',
      'https://www.crunchbase.com/organization/canalclear',
      'https://canalclear.org/podcast',
    ],
    knowsAbout: [
      'Panama Canal compliance',
      'VUMPA filing',
      'PCSOPEP documentation',
      'Panama Canal Authority (ACP) requirements',
      'Maritime pre-transit validation',
      'Ship agent services',
      'Crew manifest preparation',
      'Canal transit documentation',
    ],
  };

  // Replace the old Organization block
  const orgRegex = /<script type="application\/ld\+json">\s*\{[\s\S]*?"@type":\s*"Organization"[\s\S]*?<\/script>/;
  if (orgRegex.test(html)) {
    const orgTag = `<script type="application/ld+json">\n    ${JSON.stringify(orgSchema, null, 2)
      .replace(/^/gm, '    ')
      .trim()}\n    </script>`;
    html = html.replace(orgRegex, orgTag);
    console.log('  ✓ index.html — Organization schema enhanced');
    changed = true;
  }

  // 2. Enhance SoftwareApplication schema — add proper Offer array and applicationCategory
  const softwareAppSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'CanalClear',
    url: 'https://canalclear.org',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Maritime Compliance Software',
    operatingSystem: 'Web',
    browserRequirements: 'Requires a modern web browser with JavaScript enabled',
    description:
      'CanalClear is an AI-powered Panama Canal compliance automation platform that handles VUMPA filings, PCSOPEP documentation, and pre-transit validation for fleet operators, ship agents, and charterers.',
    offers: [
      {
        '@type': 'Offer',
        name: 'Starter',
        price: '0',
        priceCurrency: 'USD',
        description: 'Free plan: VUMPA filing validator with basic compliance checks.',
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Professional',
        price: '200',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '200',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        description:
          'Full VUMPA automation, PCSOPEP compliance, crew manifest validation, and direct ACP portal submission.',
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Fleet',
        price: '1000',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '1000',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        description: 'Multi-vessel fleet management with bulk filing, audit trails, and priority support.',
        availability: 'https://schema.org/InStock',
      },
      {
        '@type': 'Offer',
        name: 'Enterprise',
        price: '10000',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '10000',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        description:
          'Unlimited vessels, custom integrations, dedicated compliance manager, and SLA guarantees.',
        availability: 'https://schema.org/InStock',
      },
    ],
    featureList: [
      'Automated VUMPA filing via ACP Maritime Service Portal',
      'PCSOPEP documentation and compliance validation',
      'Pre-transit compliance checklist and validation',
      'Crew manifest preparation and verification',
      'Cargo declaration automation',
      '96-hour deadline alerts and reminders',
      'ACP rejection prevention with pre-submission validation',
      'Multi-vessel fleet management',
      'Panama Canal transit documentation archive',
    ],
    publisher: {
      '@type': 'Organization',
      name: 'CanalClear',
      url: 'https://canalclear.org',
    },
  };

  // Replace the old SoftwareApplication block
  const saRegex = /<script type="application\/ld\+json">\s*\{[\s\S]*?"@type":\s*"SoftwareApplication"[\s\S]*?<\/script>/;
  if (saRegex.test(html)) {
    const saTag = `<script type="application/ld+json">\n    ${JSON.stringify(softwareAppSchema, null, 2)
      .replace(/^/gm, '    ')
      .trim()}\n    </script>`;
    html = html.replace(saRegex, saTag);
    console.log('  ✓ index.html — SoftwareApplication schema enhanced');
    changed = true;
  }

  // 3. Add WebSite schema with SearchAction (only if not present)
  if (!html.includes('"WebSite"')) {
    const websiteSchema = {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'CanalClear',
      url: 'https://canalclear.org',
      description:
        'Panama Canal compliance automation software — VUMPA filings, PCSOPEP documentation, and pre-transit validation.',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://canalclear.org/knowledge-base?q={search_term_string}',
        },
        'query-input': 'required name=search_term_string',
      },
    };
    const websiteTag = `\n    <!-- Schema: WebSite + SearchAction (enables Google Sitelinks Search Box) -->\n    <script type="application/ld+json">\n    ${JSON.stringify(websiteSchema, null, 2)
      .replace(/^/gm, '    ')
      .trim()}\n    </script>`;
    html = html.replace('</head>', websiteTag + '\n</head>');
    console.log('  ✓ index.html — WebSite + SearchAction schema added');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
  }
}

// ─── Enhance pricing.html ─────────────────────────────────────────────────────
function enhancePricingHtml() {
  const filePath = path.join(PUBLIC, 'pricing.html');
  let html = fs.readFileSync(filePath, 'utf8');

  // Add SoftwareApplication schema if not present
  if (!html.includes('"SoftwareApplication"')) {
    const pricingAppSchema = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'CanalClear',
      url: 'https://canalclear.org',
      applicationCategory: 'BusinessApplication',
      applicationSubCategory: 'Maritime Compliance Software',
      operatingSystem: 'Web',
      description:
        'Panama Canal compliance automation software — VUMPA filings, PCSOPEP documentation, and pre-transit validation. Replaces $2,000–$5,000+ per-transit ship agent fees.',
      offers: [
        {
          '@type': 'Offer',
          name: 'Starter',
          price: '0',
          priceCurrency: 'USD',
          description: 'VUMPA filing validator with basic compliance checks. Free forever.',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Professional',
          price: '200',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '200',
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
          description:
            'Full VUMPA automation, PCSOPEP compliance, crew manifest validation, and ACP portal submission.',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Fleet',
          price: '1000',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '1000',
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
          description: 'Multi-vessel fleet management, bulk filing, audit trails, and priority support.',
          availability: 'https://schema.org/InStock',
        },
        {
          '@type': 'Offer',
          name: 'Enterprise',
          price: '10000',
          priceCurrency: 'USD',
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price: '10000',
            priceCurrency: 'USD',
            unitText: 'MONTH',
          },
          description: 'Unlimited vessels, custom integrations, dedicated compliance manager, SLA guarantees.',
          availability: 'https://schema.org/InStock',
        },
      ],
      publisher: {
        '@type': 'Organization',
        name: 'CanalClear',
        url: 'https://canalclear.org',
        logo: {
          '@type': 'ImageObject',
          url: 'https://canalclear.org/CanalClear_Logo.png',
        },
      },
    };

    const tag = `\n    <!-- Schema: SoftwareApplication with pricing tiers -->\n    <script type="application/ld+json">\n    ${JSON.stringify(pricingAppSchema, null, 2)
      .replace(/^/gm, '    ')
      .trim()}\n    </script>`;
    html = html.replace('</head>', tag + '\n</head>');
    fs.writeFileSync(filePath, html, 'utf8');
    console.log('  ✓ pricing.html — SoftwareApplication schema added');
  } else {
    console.log('  ↷ pricing.html — SoftwareApplication schema already present');
  }
}

// ─── Add Podcast series schema ────────────────────────────────────────────────
function enhancePodcastHtml() {
  const filePath = path.join(PUBLIC, 'podcast.html');
  if (!fs.existsSync(filePath)) return;
  let html = fs.readFileSync(filePath, 'utf8');

  if (!html.includes('"PodcastSeries"') && !html.includes('"AudioObject"')) {
    const podcastSchema = {
      '@context': 'https://schema.org',
      '@type': 'PodcastSeries',
      name: 'Clear Passage',
      description:
        'Clear Passage is the podcast about shipping, logistics, and Panama Canal operations — covering compliance, technology, and the business of moving cargo around the world.',
      url: 'https://canalclear.org/podcast',
      image: 'https://canalclear.org/CanalClear_Logo.png',
      author: {
        '@type': 'Organization',
        name: 'CanalClear',
        url: 'https://canalclear.org',
      },
      publisher: {
        '@type': 'Organization',
        name: 'CanalClear',
        url: 'https://canalclear.org',
      },
      genre: ['Maritime', 'Shipping', 'Business', 'Technology'],
      inLanguage: 'en',
    };
    const tag = `\n    <!-- Schema: PodcastSeries -->\n    <script type="application/ld+json">\n    ${JSON.stringify(podcastSchema, null, 2)
      .replace(/^/gm, '    ')
      .trim()}\n    </script>`;
    html = html.replace('</head>', tag + '\n</head>');
    fs.writeFileSync(filePath, html, 'utf8');
    console.log('  ✓ podcast.html — PodcastSeries schema added');
  }
}

// ─── Add Bing & Yandex verification meta tags to index.html ──────────────────
function addVerificationTags() {
  const filePath = path.join(PUBLIC, 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Bing Webmaster Tools verification
  // Placeholder — replace with actual code from https://www.bing.com/webmasters
  if (!html.includes('msvalidate.01')) {
    const bingTag = '\n    <!-- Bing Webmaster Tools — replace PLACEHOLDER with real code from https://www.bing.com/webmasters -->\n    <meta name="msvalidate.01" content="BING_VERIFICATION_CODE_PLACEHOLDER">';
    html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">' + bingTag);
    changed = true;
    console.log('  ✓ index.html — Bing verification meta tag added (placeholder — needs real code)');
  }

  // Yandex Webmaster verification
  if (!html.includes('yandex-verification')) {
    const yandexTag = '\n    <!-- Yandex Webmaster — replace PLACEHOLDER with real code from https://webmaster.yandex.com -->\n    <meta name="yandex-verification" content="YANDEX_VERIFICATION_CODE_PLACEHOLDER">';
    html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">' + yandexTag);
    changed = true;
    console.log('  ✓ index.html — Yandex verification meta tag added (placeholder — needs real code)');
  }

  if (changed) {
    fs.writeFileSync(filePath, html, 'utf8');
  }
}

// ─── Create BingSiteAuth.xml ──────────────────────────────────────────────────
function createBingSiteAuth() {
  const filePath = path.join(PUBLIC, 'BingSiteAuth.xml');
  if (fs.existsSync(filePath)) {
    console.log('  ↷ BingSiteAuth.xml already exists');
    return;
  }
  // Placeholder — replace the GUID with the real one from Bing Webmaster Tools
  const content = `<?xml version="1.0"?>
<users>
  <!-- Replace this GUID with the actual verification code from https://www.bing.com/webmasters -->
  <user>BING_SITE_AUTH_GUID_PLACEHOLDER</user>
</users>`;
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('  ✓ BingSiteAuth.xml created (placeholder — needs real GUID from Bing Webmaster Tools)');
}

// ─── Update IndexNow script with ALL page URLs ────────────────────────────────
function updateIndexNowScript() {
  const scriptPath = path.join(__dirname, 'ping-indexnow.js');
  let script = fs.readFileSync(scriptPath, 'utf8');

  // New URLs to add (podcast episodes + key pages)
  const newUrls = [
    // Core pages
    'https://canalclear.org/',
    'https://canalclear.org/pricing',
    'https://canalclear.org/about',
    'https://canalclear.org/knowledge-base',
    // Podcast series + episodes
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
    'https://canalclear.org/podcast/episode-14',
    'https://canalclear.org/podcast/episode-15',
    // Blog posts (missing from current script)
    'https://canalclear.org/blog/vumpa-digital-submission-guide-2026',
    'https://canalclear.org/blog/vessel-readiness-inspection-panama-canal',
    'https://canalclear.org/blog/pcsopep-requirements-2026',
    'https://canalclear.org/blog/how-to-file-pcsopep-panama-canal',
    'https://canalclear.org/blog/panama-canal-compliance-complete-guide-2026',
    'https://canalclear.org/blog/panama-canal-compliance-checklist-fleet-operators',
    'https://canalclear.org/blog/panama-canal-vumpa-requirements-2026',
    'https://canalclear.org/blog/why-ai-is-the-future-of-panama-canal-compliance',
  ];

  // Build a complete, deduplicated URL list
  const existingUrlsMatch = script.match(/const URLS = \[([\s\S]*?)\];/);
  let existingUrls = [];
  if (existingUrlsMatch) {
    existingUrls = [...existingUrlsMatch[1].matchAll(/'(https:\/\/[^']+)'/g)].map(m => m[1]);
  }
  const allUrls = [...new Set([...existingUrls, ...newUrls])].sort();

  const urlList = allUrls.map(u => `  '${u}',`).join('\n');
  const newUrlsBlock = `const URLS = [\n${urlList}\n];`;

  if (existingUrlsMatch) {
    const updatedScript = script.replace(/const URLS = \[[\s\S]*?\];/, newUrlsBlock);
    fs.writeFileSync(scriptPath, updatedScript, 'utf8');
    console.log(`  ✓ ping-indexnow.js — updated with ${allUrls.length} total URLs`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🚀 Injecting advanced schema markup across canalclear.org\n');

  console.log('📄 Blog posts — BreadcrumbList');
  processBlogPosts();

  console.log('\n🎙️ Podcast episodes — BreadcrumbList');
  processPodcastEpisodes();

  console.log('\n📑 Key pages — BreadcrumbList');
  processKeyPages();

  console.log('\n🏠 index.html — enhanced schemas');
  enhanceIndexHtml();

  console.log('\n💰 pricing.html — SoftwareApplication schema');
  enhancePricingHtml();

  console.log('\n🎙️ podcast.html — PodcastSeries schema');
  enhancePodcastHtml();

  console.log('\n🔍 Verification meta tags');
  addVerificationTags();
  createBingSiteAuth();

  console.log('\n📡 IndexNow — updating URL list');
  updateIndexNowScript();

  console.log('\n✅ Done! Schema injection complete.');
  console.log('\n⚠️  Manual steps needed:');
  console.log('   1. Get real Bing verification code from https://www.bing.com/webmasters');
  console.log('      → Update index.html msvalidate.01 content and BingSiteAuth.xml GUID');
  console.log('   2. Get real Yandex verification code from https://webmaster.yandex.com');
  console.log('      → Update index.html yandex-verification content');
  console.log('   3. Add real Product Hunt & Crunchbase URLs to Organization sameAs once registered');
  console.log('   4. Run: node scripts/ping-indexnow.js — to notify all search engines\n');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
