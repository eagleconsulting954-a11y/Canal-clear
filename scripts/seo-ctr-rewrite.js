#!/usr/bin/env node
/**
 * SEO CTR Rewrite Script — Task #1053442
 *
 * Part 1: Rewrite title tags & meta descriptions for all 22 blog posts
 * Part 2: Add FAQ schema to top 5 posts
 * Part 3: Internal linking pass
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '../public/blog');

// ============================================================
// PART 1: New title tags & meta descriptions
// Titles: under 60 chars, lead with PAIN, power words
// Descriptions: under 155 chars, keyword-rich, action-oriented
// ============================================================

const SEO_DATA = {
  'why-ai-is-the-future-of-panama-canal-compliance': {
    title: '$15K Fines, 72hr Delays: Why AI Compliance Is Mandatory',
    description: 'One equipment error triggers $15K+ ACP fines and 72-hour delays. AI-powered compliance is now the only reliable way to survive 2026 ACP enforcement.',
    ogTitle: '$15K Fines, 72hr Delays: Why AI Compliance Is Mandatory',
  },
  'how-to-avoid-panama-canal-compliance-fines-in-2026': {
    title: 'Panama Canal Fines 2026: $65K Lost Per Slot — 5 Fixes',
    description: 'Miss a Neo-Panamax slot and you lose $65K/day. Equipment violations start at $15K. Five proven strategies to eliminate ACP fines in 2026.',
    ogTitle: 'Panama Canal Fines 2026: $65K Lost Per Slot — 5 Fixes',
  },
  'panama-canal-transit-documents-required': {
    title: 'Panama Canal Documents 2026: Avoid Costly Rejections',
    description: 'Missing one of 12 required ACP document categories delays your transit and risks $65K+ in slot forfeitures. Complete rejection-proof checklist for 2026.',
    ogTitle: 'Panama Canal Documents 2026: Avoid Costly Rejections',
  },
  'how-to-file-vumpa-panama-canal': {
    title: 'VUMPA Filing 2026: Avoid $65K Slot Loss — Step-by-Step',
    description: 'VUMPA rejection forces rescheduling at $65K/day. File correctly via ACP Maritime Service Portal 96 hours before arrival. Exact steps, fields, and common rejections.',
    ogTitle: 'VUMPA Filing 2026: Avoid $65K Slot Loss — Step-by-Step',
  },
  'panama-canal-compliance-checklist-2026': {
    title: 'Panama Canal Compliance Checklist 2026 — 5 Phases',
    description: 'ACP inspectors reject vessels missing any of 5 compliance phases. Complete 2026 checklist: VUMPA filing, equipment, PCSOPEP, crew credentials, and portal submission.',
    ogTitle: 'Panama Canal Compliance Checklist 2026 — 5 Phases',
  },
  'pcsopep-requirements-panama-canal': {
    title: 'PCSOPEP 2026: Avoid $50K Fine — Mandatory Requirements',
    description: 'Missing PCSOPEP triggers ACP fines starting at $50K+. Mandatory for all Canal transits — must be ACP-approved, bilingual, and master-signed. Full 2026 guide.',
    ogTitle: 'PCSOPEP 2026: Avoid $50K Fine — Mandatory Requirements',
  },
  'what-is-port-state-control': {
    title: 'Port State Control 2026: Avoid $65K/Day PSC Detention',
    description: 'PSC detention averages $35K–$65K/day. Understand what triggers inspections, the top deficiency categories, and how to keep your fleet off the detention list.',
    ogTitle: 'Port State Control 2026: Avoid $65K/Day PSC Detention',
  },
  'marpol-compliance-checklist-ship-operators-2026': {
    title: 'MARPOL Compliance Checklist 2026 — Avoid Port Bans',
    description: 'MARPOL violations trigger port bans, $100K+ fines, and PSC detention. Complete 2026 checklist: all 6 Annexes, CII reporting, ECA rules, and Panama Canal requirements.',
    ogTitle: 'MARPOL Compliance Checklist 2026 — Avoid Port Bans',
  },
  'how-to-reduce-shipping-delays': {
    title: 'Cut Shipping Delays 78%: Compliance Automation Data',
    description: 'Documentation errors cause 35% of all shipping delays. Compliance automation cuts that figure by 78%. Data-driven prevention guide for fleet operators.',
    ogTitle: 'Cut Shipping Delays 78%: Compliance Automation Data',
  },
  'true-cost-of-non-compliance-global-shipping': {
    title: 'Non-Compliance Costs $300K+ Per Incident — Real Data',
    description: 'One 72-hour compliance failure costs $300K–$500K. A PSC detention runs $35K–$65K/day. The full financial case for maritime compliance investment.',
    ogTitle: 'Non-Compliance Costs $300K+ Per Incident — Real Data',
  },
  'panama-canal-vumpa-requirements-2026': {
    title: 'VUMPA Requirements 2026: Mandatory Deadline & Penalty',
    description: 'ACP\'s 2026 VUMPA changes are mandatory — miss the 96-hour deadline and you forfeit your slot. Full guide: required documents, common mistakes, and penalties.',
    ogTitle: 'VUMPA Requirements 2026: Mandatory Deadline & Penalty',
  },
  'how-to-file-pcsopep-panama-canal': {
    title: 'File PCSOPEP 2026: Avoid $50K Rejection — Step-by-Step',
    description: 'PCSOPEP rejection delays transit and risks $50K+ fines. Must be ACP-approved, bilingual, master-signed. Step-by-step guide with timeline and cost breakdown.',
    ogTitle: 'File PCSOPEP 2026: Avoid $50K Rejection — Step-by-Step',
  },
  'panama-canal-compliance-checklist-fleet-operators': {
    title: 'Panama Canal Checklist: Pass ACP Inspection First Time',
    description: 'ACP rejects vessels with incomplete document prep. Complete pre-transit checklist, common rejection reasons, and exactly how to pass inspection first time.',
    ogTitle: 'Panama Canal Checklist: Pass ACP Inspection First Time',
  },
  'panama-canal-compliance-complete-guide-2026': {
    title: 'Panama Canal Compliance 2026: Every ACP Requirement',
    description: 'Every 2026 ACP requirement in one guide: VUMPA, PCSOPEP, crew manifests, ballast water, and MARPOL. Zero compliance gaps before transit. Updated April 2026.',
    ogTitle: 'Panama Canal Compliance 2026: Every ACP Requirement',
  },
  'vumpa-filing-requirements-step-by-step': {
    title: 'VUMPA Pre-Arrival 2026: ETA Deadlines & Rejection Codes',
    description: 'VUMPA rejections mean $65K/day slot losses. Full breakdown: ETA deadlines, General Arrangement plan specs, IMDG declarations, and ACP rejection codes.',
    ogTitle: 'VUMPA Pre-Arrival 2026: ETA Deadlines & Rejection Codes',
  },
  'pcsopep-documentation-complete-guide': {
    title: 'PCSOPEP Docs 2026: Avoid $50K Fines — Full Checklist',
    description: 'Vessels over 400 MT without ACP-approved PCSOPEP face $50K+ fines. Full guide: Authorized Person requirements, IOPP certificate matching, and ACP approval process.',
    ogTitle: 'PCSOPEP Docs 2026: Avoid $50K Fines — Full Checklist',
  },
  'pcsopep-requirements-2026': {
    title: 'PCSOPEP 2026 Updates: New Rules to Avoid $50K Fines',
    description: 'ACP Notice to Shipping changed PCSOPEP rules in 2026. New tier classifications and 96-hour VUMPA rules apply. Miss them and fines start at $50,000.',
    ogTitle: 'PCSOPEP 2026 Updates: New Rules to Avoid $50K Fines',
  },
  'vumpa-digital-submission-guide-2026': {
    title: 'VUMPA Digital Submission 2026: Avoid Portal Rejections',
    description: 'ACP\'s Maritime Single Window rejects VUMPA submissions with EDCS discrepancies. Full portal walkthrough, rejection codes, 96-hour rules, and filing checklist.',
    ogTitle: 'VUMPA Digital Submission 2026: Avoid Portal Rejections',
  },
  'vessel-readiness-inspection-panama-canal': {
    title: 'Canal Vessel Inspection 2026: Zero-Delay Checklist',
    description: 'ACP vessel readiness failures forfeit your slot at $65K+/day. Complete 2026 inspection checklist: equipment standards, beam limits, and corrective action process.',
    ogTitle: 'Canal Vessel Inspection 2026: Zero-Delay Checklist',
  },
  'best-maritime-compliance-podcasts-2026': {
    title: 'Best Maritime Compliance Podcasts 2026 — Top Picks',
    description: 'Stay ahead of VUMPA updates, PCSOPEP changes, and ACP enforcement in 2026. Curated maritime compliance podcast list with Spotify and Apple Podcasts links.',
    ogTitle: 'Best Maritime Compliance Podcasts 2026 — Top Picks',
  },
  'stay-compliant-panama-canal-regulations-listen-while-you-work': {
    title: 'Panama Canal Compliance Podcasts: Stay Current On-Watch',
    description: 'VUMPA deadlines, PCSOPEP requirements, and crew manifest rules explained in audio form. Stay compliant with Panama Canal regulations while you work.',
    ogTitle: 'Panama Canal Compliance Podcasts: Stay Current On-Watch',
  },
  'panama-canal-toll-calculator-2026': {
    title: 'Panama Canal Tolls 2026: True Cost + $200K Hidden Fees',
    description: 'ACP tolls hide $200K+ in extra costs: pilotage, tugs, line handlers, and $65K hazmat surcharges. Full 2026 cost breakdown for 9 vessel types.',
    ogTitle: 'Panama Canal Tolls 2026: True Cost + $200K Hidden Fees',
  },
};

// ============================================================
// PART 2: FAQ schema for top 5 posts
// (Selected by estimated search volume / commercial intent)
// ============================================================

const FAQ_DATA = {
  'how-to-avoid-panama-canal-compliance-fines-in-2026': [
    {
      q: 'How much are Panama Canal compliance fines?',
      a: 'ACP compliance fines start at $15,000 for equipment violations. Missing a Neo-Panamax transit slot due to a compliance failure costs $65,000 per day in forfeiture fees. A 72-hour compliance incident typically totals $300,000–$500,000 in combined losses.'
    },
    {
      q: 'What triggers Panama Canal compliance fines?',
      a: 'Common triggers include incomplete or rejected VUMPA filings, missing or expired PCSOPEP documentation, equipment failures during vessel readiness inspection, incomplete crew manifests, and cargo declaration errors or missing IMDG hazmat declarations.'
    },
    {
      q: 'How far in advance must I file VUMPA to avoid fines?',
      a: 'VUMPA must be submitted at least 96 hours (4 days) before your vessel arrives at Panama Canal waters. Late submission or rejection that requires resubmission risks losing your transit slot and incurring $65,000/day rebooking fees.'
    },
    {
      q: 'Can compliance software prevent Panama Canal fines?',
      a: 'Yes. AI-powered compliance platforms like CanalClear automate VUMPA validation, flag PCSOPEP gaps, and run pre-submission checks — catching errors before ACP inspectors do. This reduces rejection risk to near zero compared to manual document review.'
    },
    {
      q: 'What is the $65K fine referenced for Panama Canal delays?',
      a: 'The $65,000 figure refers to the daily cost of forfeiting a Panama Canal transit slot. If your vessel fails inspection or receives a rejected VUMPA filing, you lose your booked slot and must rebook — at up to $65,000 per day of delay.'
    }
  ],
  'panama-canal-vumpa-requirements-2026': [
    {
      q: 'What is VUMPA?',
      a: 'VUMPA (Vessel Unified Measurement and Pre-Arrival) is the mandatory pre-arrival documentation system for Panama Canal transit. It consolidates vessel measurements, cargo information, equipment status, and crew credentials into a single ACP submission required 96 hours before arrival.'
    },
    {
      q: 'What documents are required for VUMPA in 2026?',
      a: 'VUMPA requires: vessel dimensions and current draft, General Arrangement plan, cargo declaration (including IMDG class for all hazmat), crew manifest, PCSOPEP certificate, ballast water records, and all current vessel safety certificates.'
    },
    {
      q: 'What happens if my VUMPA is rejected by ACP?',
      a: 'A rejected VUMPA forces slot rescheduling, costing up to $65,000 per day. Common rejection reasons include mismatched vessel dimensions, expired certificates, missing IMDG declarations, and incomplete crew manifest entries.'
    },
    {
      q: 'What changed in VUMPA requirements for 2026?',
      a: 'ACP\'s 2026 VUMPA updates include stricter EDCS (Electronic Document Control System) discrepancy checks, updated PCSOPEP tier classifications, enhanced hazmat declaration requirements for IMDG cargo, and mandatory digital submission via the Maritime Single Window.'
    },
    {
      q: 'How do I file VUMPA for the Panama Canal?',
      a: 'VUMPA is filed through the ACP Maritime Single Window portal. You must submit at least 96 hours before arrival. CanalClear pre-validates your entire VUMPA package before submission — eliminating rejection risk with automated field checks and document validation.'
    }
  ],
  'how-to-file-vumpa-panama-canal': [
    {
      q: 'How do I file VUMPA for Panama Canal transit?',
      a: 'Log into the ACP Maritime Service Portal, complete the pre-arrival form with vessel dimensions, cargo details, crew manifest, and certificates, attach all required documents, and submit at least 96 hours before your estimated arrival at Panama Canal waters.'
    },
    {
      q: 'What is the VUMPA filing deadline?',
      a: 'VUMPA must be submitted 96 hours (4 days) before your vessel arrives at Panama Canal waters. Filing late — or receiving a rejection that requires resubmission — risks losing your transit slot at a cost of up to $65,000 per day.'
    },
    {
      q: 'What are the most common VUMPA rejection reasons?',
      a: 'The most common VUMPA rejections are: expired or missing certificates, mismatched vessel dimensions, incomplete IMDG cargo declarations for hazmat, PCSOPEP not on file or expired, and crew manifest entries missing required STCW credentials.'
    },
    {
      q: 'Does VUMPA require a General Arrangement plan?',
      a: 'Yes. VUMPA requires your vessel\'s current General Arrangement (GA) plan. The GA must reflect actual vessel configuration — any discrepancy between the GA and vessel measurements triggers an ACP review and potential rejection.'
    },
    {
      q: 'Can I use software to file VUMPA automatically?',
      a: 'Yes. Compliance platforms like CanalClear pre-fill VUMPA fields from your vessel database, validate all attachments against ACP requirements, and flag errors before submission — cutting filing time from hours to minutes with zero rejection risk.'
    }
  ],
  'panama-canal-compliance-checklist-2026': [
    {
      q: 'What are the 5 phases of Panama Canal compliance?',
      a: 'The 5 phases are: (1) VUMPA pre-filing and document validation at least 96 hours before arrival, (2) vessel readiness inspection preparation, (3) PCSOPEP verification — must be ACP-approved and bilingual, (4) crew credential and manifest checks, and (5) ACP portal submission and confirmation.'
    },
    {
      q: 'How early should I start Panama Canal compliance prep?',
      a: 'Begin compliance prep at least 2 weeks before transit. VUMPA requires a 96-hour advance filing, but gathering all certificates, crew credentials, and cargo declarations — and correcting any gaps — takes 5–10 business days minimum.'
    },
    {
      q: 'What documents does ACP check during vessel inspection?',
      a: 'ACP inspectors verify: VUMPA submission status and accuracy, PCSOPEP plan (bilingual, master-signed, ACP-approved), International Oil Pollution Prevention Certificate, Safety Management Certificate, STCW crew credentials, and cargo manifests with complete IMDG declarations.'
    },
    {
      q: 'What happens if I fail the ACP vessel readiness inspection?',
      a: 'Failing vessel readiness inspection means your transit slot is forfeited. You\'ll need to correct all deficiencies, refile where required, and rebook the next available slot — which costs up to $65,000 per day of delay.'
    },
    {
      q: 'Is Panama Canal compliance different from MARPOL compliance?',
      a: 'Yes. Panama Canal compliance includes all MARPOL requirements plus ACP-specific rules: VUMPA filing, PCSOPEP documentation, vessel dimension validation against lock dimensions, and transit-specific safety requirements. Passing a MARPOL inspection does not guarantee Canal compliance.'
    }
  ],
  'panama-canal-toll-calculator-2026': [
    {
      q: 'How much does Panama Canal transit cost in 2026?',
      a: 'Basic ACP tolls for a Panamax container ship range from $450,000–$900,000 per transit depending on TEU capacity. Hidden costs — mandatory pilotage ($8,000–$35,000), line handlers, tugboats, inspection fees, and slot reservation — add $50,000–$200,000 on top.'
    },
    {
      q: 'What are the hidden costs of Panama Canal transit?',
      a: 'Beyond ACP tolls, mandatory costs include: pilotage ($8,000–$35,000 depending on vessel size), tugboat fees, line handler fees ($2,000–$5,000), Panama Canal inspection fees, admeasurement fees, and hazmat surcharges. For Neo-Panamax vessels these regularly exceed $100,000.'
    },
    {
      q: 'What is the hazmat surcharge for Panama Canal transit?',
      a: 'Panama Canal hazmat surcharges apply to vessels carrying IMDG-classified dangerous goods. Surcharges can reach $65,000+ per transit for certain hazmat classes. Incorrect or late IMDG declarations can trigger additional compliance fines on top of the base surcharge.'
    },
    {
      q: 'How are Panama Canal toll rates calculated?',
      a: 'ACP tolls are calculated by vessel type and size: TEU capacity for container ships, PCUMS units for tankers and bulk carriers, and passenger capacity for cruise ships. Rates are published annually and adjusted each fiscal year. Vessels must book slots in advance to lock in current rates.'
    },
    {
      q: 'Did Panama Canal toll rates increase in 2026?',
      a: 'Yes. ACP implemented toll increases across most vessel categories in 2026, with Neo-Panamax container ship rates seeing the largest adjustments. Check current ACP rate schedules at pancanal.com or use CanalClear\'s toll calculator for an instant up-to-date estimate.'
    }
  ],
};

// ============================================================
// PART 3: Internal linking map
// Maps keywords in post body to their target internal URLs
// ============================================================

const INTERNAL_LINKS = [
  // VUMPA mentions → VUMPA & PCSOPEP Filing page
  {
    pattern: /\bVUMPA filing\b(?! tool| platform| software| system| validator| solution| service| page| link|<)/g,
    replacement: '<a href="/filing" style="color:var(--teal);text-decoration:underline;">VUMPA filing</a>',
    maxReplacements: 2,
  },
  // IMDG/hazmat mentions → Hazmat validator
  {
    pattern: /\bIMDG classification\b(?! tool| platform| software| system| validator| solution| service| page| link|<)/g,
    replacement: '<a href="/hazmat" style="color:var(--teal);text-decoration:underline;">IMDG classification</a>',
    maxReplacements: 1,
  },
  {
    pattern: /\bhazmat classification\b(?! tool| platform| software| system| validator| solution| service| page| link|<)/g,
    replacement: '<a href="/hazmat" style="color:var(--teal);text-decoration:underline;">hazmat classification</a>',
    maxReplacements: 1,
  },
];

// Cross-links between related blog posts
const CROSS_LINKS = {
  'panama-canal-compliance-checklist-2026': [
    { slug: 'how-to-avoid-panama-canal-compliance-fines-in-2026', label: 'How to Avoid Panama Canal Compliance Fines in 2026' },
    { slug: 'how-to-file-vumpa-panama-canal', label: 'How to File VUMPA for Panama Canal Transit' },
    { slug: 'pcsopep-requirements-panama-canal', label: 'PCSOPEP Requirements for Panama Canal Transit' },
  ],
  'how-to-avoid-panama-canal-compliance-fines-in-2026': [
    { slug: 'panama-canal-compliance-checklist-2026', label: 'Panama Canal Compliance Checklist 2026' },
    { slug: 'true-cost-of-non-compliance-global-shipping', label: 'The True Cost of Non-Compliance in Global Shipping' },
    { slug: 'how-to-file-vumpa-panama-canal', label: 'How to File VUMPA for Panama Canal Transit' },
  ],
  'how-to-file-vumpa-panama-canal': [
    { slug: 'panama-canal-vumpa-requirements-2026', label: 'VUMPA Requirements 2026: Complete Guide' },
    { slug: 'vumpa-digital-submission-guide-2026', label: 'VUMPA Digital Submission Guide 2026' },
    { slug: 'panama-canal-compliance-checklist-2026', label: 'Panama Canal Compliance Checklist 2026' },
  ],
  'panama-canal-vumpa-requirements-2026': [
    { slug: 'how-to-file-vumpa-panama-canal', label: 'How to File VUMPA: Step-by-Step Guide' },
    { slug: 'vumpa-filing-requirements-step-by-step', label: 'VUMPA Filing Requirements: Complete Checklist' },
    { slug: 'vumpa-digital-submission-guide-2026', label: 'VUMPA Digital Submission Guide 2026' },
  ],
  'pcsopep-requirements-panama-canal': [
    { slug: 'how-to-file-pcsopep-panama-canal', label: 'How to File PCSOPEP: Step-by-Step' },
    { slug: 'pcsopep-documentation-complete-guide', label: 'PCSOPEP Documentation: Complete Guide' },
    { slug: 'pcsopep-requirements-2026', label: 'PCSOPEP Requirements 2026: What Changed' },
  ],
  'true-cost-of-non-compliance-global-shipping': [
    { slug: 'how-to-avoid-panama-canal-compliance-fines-in-2026', label: 'How to Avoid Panama Canal Compliance Fines in 2026' },
    { slug: 'panama-canal-compliance-checklist-2026', label: 'Panama Canal Compliance Checklist 2026' },
  ],
  'vessel-readiness-inspection-panama-canal': [
    { slug: 'panama-canal-compliance-checklist-2026', label: 'Panama Canal Compliance Checklist 2026' },
    { slug: 'how-to-avoid-panama-canal-compliance-fines-in-2026', label: 'How to Avoid Compliance Fines in 2026' },
  ],
  'marpol-compliance-checklist-ship-operators-2026': [
    { slug: 'what-is-port-state-control', label: 'What Is Port State Control?' },
    { slug: 'panama-canal-compliance-complete-guide-2026', label: 'Panama Canal Compliance: Complete 2026 Guide' },
  ],
  'what-is-port-state-control': [
    { slug: 'marpol-compliance-checklist-ship-operators-2026', label: 'MARPOL Compliance Checklist 2026' },
    { slug: 'true-cost-of-non-compliance-global-shipping', label: 'The True Cost of Non-Compliance' },
  ],
  'panama-canal-toll-calculator-2026': [
    { slug: 'how-to-avoid-panama-canal-compliance-fines-in-2026', label: 'How to Avoid Panama Canal Fines in 2026' },
    { slug: 'vessel-readiness-inspection-panama-canal', label: 'Canal Vessel Readiness Inspection Guide' },
  ],
};

// ============================================================
// UTILITIES
// ============================================================

function buildFaqSchema(faqs) {
  return `
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": [
        ${faqs.map(faq => `{
          "@type": "Question",
          "name": ${JSON.stringify(faq.q)},
          "acceptedAnswer": {
            "@type": "Answer",
            "text": ${JSON.stringify(faq.a)}
          }
        }`).join(',\n        ')}
      ]
    }
    </script>`;
}

function buildCrossLinkSection(links) {
  const items = links.map(l =>
    `<li><a href="/blog/${l.slug}" style="color:var(--teal);text-decoration:underline;">${l.label}</a></li>`
  ).join('\n          ');
  return `
    <!-- Internal cross-links injected by seo-ctr-rewrite.js -->
    <div style="margin:3rem 0;padding:1.5rem;background:rgba(0,212,170,0.07);border:1px solid rgba(0,212,170,0.2);border-radius:12px;">
      <p style="font-weight:600;color:var(--teal);margin-bottom:0.75rem;">Related Reading</p>
      <ul style="list-style:none;padding:0;display:flex;flex-direction:column;gap:0.5rem;">
          ${items}
      </ul>
    </div>`;
}

// ============================================================
// MAIN: Process each blog post
// ============================================================

const blogFiles = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');
let updatedCount = 0;
let faqCount = 0;
let linkCount = 0;

for (const file of blogFiles) {
  const slug = file.replace('.html', '');
  const filePath = path.join(BLOG_DIR, file);
  let html = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const seo = SEO_DATA[slug];
  if (!seo) {
    console.log(`⚠️  No SEO data for: ${slug} — skipping`);
    continue;
  }

  // ---- Part 1: Update <title> tag ----
  const newFullTitle = `${seo.title} | CanalClear Blog`;
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${newFullTitle}</title>`
  );

  // ---- Part 1: Update meta description ----
  html = html.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${seo.description}">`
  );

  // ---- Part 1: Update og:title ----
  html = html.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${seo.ogTitle}">`
  );

  // ---- Part 1: Update og:description ----
  html = html.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${seo.description}">`
  );

  // ---- Part 1: Update twitter:title ----
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${seo.ogTitle}">`
  );

  // ---- Part 1: Update twitter:description ----
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${seo.description}">`
  );

  // ---- Part 1: Update Article schema headline & description ----
  // Replace headline in JSON-LD Article schema
  html = html.replace(
    /"headline": "[^"]*"/,
    `"headline": ${JSON.stringify(seo.ogTitle)}`
  );
  html = html.replace(
    /("description": )"[^"]*"(\s*,\s*"url": "https:\/\/canalclear\.org\/blog)/,
    `$1${JSON.stringify(seo.description)}$2`
  );

  changed = true;
  updatedCount++;

  // ---- Part 2: Add FAQ schema ----
  const faqs = FAQ_DATA[slug];
  if (faqs) {
    // Only add if not already present
    if (!html.includes('"@type": "FAQPage"')) {
      const faqBlock = buildFaqSchema(faqs);
      // Insert before </head>
      html = html.replace('</head>', `${faqBlock}\n</head>`);
      faqCount++;
      console.log(`  ✅ FAQ schema added to: ${slug}`);
    } else {
      console.log(`  ℹ️  FAQ schema already exists in: ${slug}`);
    }
  }

  // ---- Part 3: Add cross-links ----
  const crossLinks = CROSS_LINKS[slug];
  if (crossLinks && !html.includes('Internal cross-links injected by seo-ctr-rewrite')) {
    const linkSection = buildCrossLinkSection(crossLinks);
    // Insert before closing </article> or before the footer/CTA section
    // Look for the first </section> that's in the article body or before footer
    if (html.includes('</article>')) {
      html = html.replace('</article>', `${linkSection}\n</article>`);
    } else if (html.includes('<footer')) {
      html = html.replace('<footer', `${linkSection}\n    <footer`);
    }
    linkCount++;
  }

  // ---- Part 3: Add VUMPA tool CTA link (inline, first occurrence of "VUMPA" in body) ----
  // Add a subtle "Validate with CanalClear →" link near VUMPA mentions if not already present
  if (!html.includes('href="/filing"') && html.toLowerCase().includes('vumpa')) {
    // Find first mention of VUMPA in a <p> tag after the hero section and add a link
    html = html.replace(
      /(<p[^>]*>(?:[^<]|<(?!\/p>))*?\bVUMPA\b(?:[^<]|<(?!\/p>))*?<\/p>)/,
      (match) => {
        if (match.length > 50 && !match.includes('href=')) {
          return match + '\n    <p style="margin-top:-0.5rem;font-size:0.9rem;"><a href="/filing" style="color:var(--teal);text-decoration:underline;">→ Validate your VUMPA package with CanalClear</a></p>';
        }
        return match;
      }
    );
  }

  // ---- Part 3: Add /hazmat link near IMDG mentions ----
  if (!html.includes('href="/hazmat"') && (html.includes('IMDG') || html.toLowerCase().includes('hazmat classification'))) {
    html = html.replace(
      /(<p[^>]*>(?:[^<]|<(?!\/p>))*?\bIMDG\b(?:[^<]|<(?!\/p>))*?<\/p>)/,
      (match) => {
        if (match.length > 50 && !match.includes('href=')) {
          return match + '\n    <p style="margin-top:-0.5rem;font-size:0.9rem;"><a href="/hazmat" style="color:var(--teal);text-decoration:underline;">→ Check your cargo with the IMDG Hazmat Validator</a></p>';
        }
        return match;
      }
    );
  }

  // ---- Part 3: Add /pricing CTA link near compliance cost mentions ----
  // (Only for posts that mention prices and don't already link to pricing)
  const pricingKeywords = ['$65K', '$50K', '$15K', '$300,000', 'compliance software', 'automate compliance', 'reduce your risk'];
  const hasPricingMention = pricingKeywords.some(kw => html.includes(kw));
  if (!html.includes('href="/pricing"') && hasPricingMention) {
    html = html.replace(
      /(<p[^>]*>(?:[^<]|<(?!\/p>))*?(?:compliance software|automate compliance|\$65K|\$50K|\$15K|\$300,000)(?:[^<]|<(?!\/p>))*?<\/p>)/,
      (match) => {
        if (match.length > 50 && !match.includes('href=')) {
          return match + '\n    <p style="margin-top:-0.5rem;font-size:0.9rem;"><a href="/pricing" style="color:var(--teal);text-decoration:underline;">→ See CanalClear pricing — starts at $199/vessel/month</a></p>';
        }
        return match;
      }
    );
  }

  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`✅ Updated: ${slug}`);
}

console.log('\n========================================');
console.log(`✅ Title/meta updates: ${updatedCount} posts`);
console.log(`✅ FAQ schema added: ${faqCount} posts`);
console.log(`✅ Cross-link sections: ${linkCount} posts`);
console.log('========================================');
console.log('\nVerify with: grep -l "FAQPage" public/blog/*.html');
