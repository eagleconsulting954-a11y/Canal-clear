#!/usr/bin/env node
/**
 * fix-index-schema.js
 * Fixes the index.html schema after the injection script's regex matched too broadly.
 * Removes the duplicate old Organization schema and adds the enhanced SoftwareApplication schema.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'public', 'index.html');
let html = fs.readFileSync(filePath, 'utf8');

// ─── 1. Remove duplicate old Organization schema (the one with og-image.png logo) ─
const oldOrgBlock = `    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "CanalClear",
      "url": "https://canalclear.org",
      "logo": "https://canalclear.org/og-image.png",
      "description": "CanalClear is an AI-powered Panama Canal compliance automation platform that handles VUMPA filings, PCSOPEP documentation, and pre-transit validation for fleet operators, ship agents, and charterers.",
      "sameAs": [
        "https://canalclear.org"
      ],
      "contactPoint": {
        "@type": "ContactPoint",
        "contactType": "customer support",
        "email": "support@canalclear.org"
      },
      "knowsAbout": [
        "Panama Canal compliance",
        "VUMPA filing",
        "PCSOPEP documentation",
        "Panama Canal Authority (ACP) requirements",
        "Maritime pre-transit validation",
        "Ship agent services",
        "Crew manifest preparation",
        "Canal transit documentation"
      ]
    }
    </script>`;

if (html.includes(oldOrgBlock)) {
  html = html.replace('\n' + oldOrgBlock, '');
  console.log('✓ Removed duplicate old Organization schema');
} else {
  console.log('⚠ Duplicate old Organization not found (may already be removed)');
}

// ─── 2. Add enhanced SoftwareApplication schema if not present ─────────────────
if (!html.includes('"SoftwareApplication"')) {
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

  const saTag = `    <!-- Schema: SoftwareApplication with pricing offers -->\n    <script type="application/ld+json">\n    ${JSON.stringify(softwareAppSchema, null, 2).replace(/^/gm, '    ').trim()}\n    </script>\n`;

  // Insert after the Organization schema block (after the first </script> following @type Organization)
  // Find the closing tag of the Organization schema
  const insertMarker = '    <!-- Schema.org Structured Data for GEO (AI chatbot visibility) -->';
  if (html.includes(insertMarker)) {
    // Insert after the Organization block (find the script closing tag)
    const orgScriptEnd = '</script>\n    <script type="application/ld+json">\n    {\n      "@context": "https://schema.org",\n      "@type": "WebApplication"';
    if (html.includes(orgScriptEnd)) {
      html = html.replace(orgScriptEnd, `</script>\n    ${saTag}    <script type="application/ld+json">\n    {\n      "@context": "https://schema.org",\n      "@type": "WebApplication"`);
      console.log('✓ SoftwareApplication schema added before WebApplication schema');
    } else {
      // Fallback: inject before </head>
      html = html.replace('</head>', saTag + '</head>');
      console.log('✓ SoftwareApplication schema added (fallback: before </head>)');
    }
  }
} else {
  console.log('↷ SoftwareApplication schema already present');
}

fs.writeFileSync(filePath, html, 'utf8');

// ─── Verify ────────────────────────────────────────────────────────────────────
const finalHtml = fs.readFileSync(filePath, 'utf8');
const schemas = finalHtml.match(/<script type="application\/ld\+json">/g) || [];
console.log(`\n✅ index.html now has ${schemas.length} schema blocks`);

// Count Organization schemas
const orgCount = (finalHtml.match(/"@type":\s*"Organization"/g) || []).length;
console.log(`   Organization schemas: ${orgCount} (should be 1)`);

const saCount = (finalHtml.match(/"@type":\s*"SoftwareApplication"/g) || []).length;
console.log(`   SoftwareApplication schemas: ${saCount} (should be 1)`);

const wsCount = (finalHtml.match(/"@type":\s*"WebSite"/g) || []).length;
console.log(`   WebSite schemas: ${wsCount} (should be 1)`);
