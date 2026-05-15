'use strict';

/**
 * Bosporus Strait SP-1 Filing Primer PDF Generator
 *
 * Generates a professional guide: "Bosporus Strait SP-1 Filing — What You Need to Know"
 * with CanalClear maritime branding (deep navy + burnt orange).
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function
 * to get the hosted URL (for use in /assets/bosporus-sp1-primer.pdf redirect).
 */

const PDFDocument = require('pdfkit');
const { checkAssetExists, ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');

// Palette — deep navy, burnt orange, off-white, muted grey
const C = {
  navy:        '#1a2332',
  navyLight:   '#243450',
  orange:      '#d4622b',
  orangeLight: '#e8743e',
  white:       '#ffffff',
  offWhite:    '#f4f6f9',
  grey:        '#8fa3b8',
  greyLight:   '#c8d4e0',
  text:        '#e8eef4',
  textDark:    '#1a2332',
};

// Key deadlines for SP-1 filing
const DEADLINES = [
  {
    label: '96 Hours Before Arrival',
    detail: 'Initial SP-1 form must be received by Turkish Maritime Authority (TMA) at minimum 96 hours before reaching the Bosporus entry point (Rumeli Kavagi for northbound, Kadikoy for southbound).',
  },
  {
    label: '48 Hours Before Arrival',
    detail: 'Confirmed cargo manifest with UN/IMDG classification must be submitted. Any changes to vessel draft or dangerous goods after this point require an SP-1 amendment and fresh TMA review.',
  },
  {
    label: '24 Hours Before Entry',
    detail: 'Pilot booking confirmation must be attached to the SP-1 dossier. Turkish Pilotage compulsory for vessels >500 GT. Non-compliance triggers mandatory anchorage at Buyukdere Roads.',
  },
  {
    label: '6 Hours Before Entry',
    detail: 'Final ISPS security declaration and crew list update required if any crew changes occurred since initial filing. VHF contact with Istanbul Traffic (Ch 12) must be confirmed.',
  },
];

// Common mistakes
const MISTAKES = [
  {
    n: 1,
    title: 'Incorrect Vessel Tonnage',
    detail: 'SP-1 tonnage must match the International Tonnage Certificate exactly. PC/UMS or GT/NT discrepancy ≥1% triggers automatic rejection.',
    fix: 'Cross-check your ITC before entering any tonnage figure. CanalClear pre-fills from your vessel profile.',
  },
  {
    n: 2,
    title: 'Missing IMDG 42-24 Dangerous Goods Declaration',
    detail: 'Any vessel carrying Class 1–9 hazardous cargo must attach a separate DG manifest compliant with IMDG 42-24. A blank DG section when cargo is present causes immediate hold.',
    fix: 'Declare "no DG" explicitly if in ballast or clean cargo. Otherwise attach the full DG manifest with UN numbers, class, and stow positions.',
  },
  {
    n: 3,
    title: 'ETA Submitted After Deadline Window',
    detail: 'Filing after the 96-hour mark pushes vessels to the end of the convoy queue — adding 12–36 hours of anchorage time at Buyukdere or Ambarli Roads.',
    fix: 'File as early as possible. CanalClear alerts you 120 hours before your scheduled Bosporus entry.',
  },
  {
    n: 4,
    title: 'Pilot Booking Not Confirmed',
    detail: 'TMA cross-references SP-1 against Turkish Pilotage (KBŞ) booking records. An SP-1 without a confirmed pilot slot is returned as incomplete.',
    fix: 'Complete pilot booking before final submission. CanalClear integrates with KBŞ pilot scheduling.',
  },
  {
    n: 5,
    title: 'Crew Manifest Format Errors',
    detail: 'Turkish format requires full legal names (no abbreviations), Turkish ID number for any Turkish crew, and STCW certificate references for officers.',
    fix: 'Use the TMA-approved crew list template. CanalClear exports compliant crew lists in one click.',
  },
];

// Required documents
const DOCUMENTS = [
  { doc: 'SP-1 Transit Application Form', note: 'Must be signed by master and owner/operator representative' },
  { doc: 'International Tonnage Certificate', note: 'Current, original or certified copy' },
  { doc: 'Crew List (TMA Format)', note: 'Full legal names, nationalities, STCW certs for officers' },
  { doc: 'Cargo Declaration / Manifest', note: 'Including DG manifest if applicable (IMDG 42-24)' },
  { doc: 'Dangerous Goods Declaration', note: 'Required even if "NIL" — blanks are rejected' },
  { doc: 'ISPS Security Declaration', note: 'ISSP Level 1 or 2 as appropriate; 24h update required' },
  { doc: 'Pilotage Booking Confirmation', note: 'From Turkish Pilotage (KBŞ) — compulsory >500 GT' },
  { doc: 'Ballast Water Management Log', note: 'Current BWM plan and exchange record (D-1 or D-2 compliant)' },
];

/**
 * Generates the Bosporus SP-1 Primer PDF and returns it as a Buffer.
 */
function generateBosporusPrimerPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Bosporus Strait SP-1 Filing Primer — CanalClear',
        Author:   'CanalClear',
        Subject:  'Bosporus Strait SP-1 Transit Filing Requirements',
        Creator:  'CanalClear (canal-clear.polsia.app)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Bosporus, SP-1, Turkish Maritime Authority, transit filing, maritime compliance',
      },
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89
    const marginX = 24;

    // ── Full-page navy background ──────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.navy);

    // ── Header band ───────────────────────────────────────────────────────
    const headerH = 95;
    doc.rect(0, 0, W, headerH).fill(C.navyLight);

    // Left orange accent stripe
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    // Logo text
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.orange);
    doc.text('CanalClear', marginX, 16);

    // Tagline
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Maritime Compliance Automation', marginX, 38);

    // Main headline
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.white);
    doc.text('BOSPORUS STRAIT SP-1 FILING PRIMER', marginX, 56, { width: W - 180 });

    // Subtitle badge (right-aligned)
    const badgeW = 135, badgeH = 34;
    const badgeX = W - badgeW - 18;
    const badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white);
    doc.text('2026 EDITION', badgeX, badgeY + 6, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Turkish Maritime Authority', badgeX, badgeY + 19, { width: badgeW, align: 'center' });

    // ── Intro line ────────────────────────────────────────────────────────
    const introY = headerH + 10;
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(
      'The Bosporus Strait is the world\'s narrowest international strait used for commercial shipping — 17 miles, one-lane in places. '
      + 'The SP-1 transit application is Turkey\'s gateway control. Miss the deadline or misfill a field and you\'re anchored for 24–48 hours.',
      marginX, introY, { width: W - marginX * 2 }
    );

    // ── Section: Key Deadlines ────────────────────────────────────────────
    const sec1Y = introY + 28;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('KEY DEADLINES', marginX, sec1Y);
    doc.rect(marginX, sec1Y + 12, W - marginX * 2, 1).fill(C.orange);

    const deadlineItemH = 22;
    DEADLINES.forEach((d, i) => {
      const dy = sec1Y + 18 + i * (deadlineItemH + 3);
      doc.roundedRect(marginX, dy, W - marginX * 2, deadlineItemH, 4).fill(C.navyLight);
      doc.roundedRect(marginX, dy, 4, deadlineItemH, 4).fill(C.orange);
      doc.rect(marginX, dy, 4, deadlineItemH).fill(C.orange);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.orangeLight);
      doc.text(d.label + ' — ', marginX + 10, dy + 4, { continued: true });
      doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
      doc.text(d.detail, { width: W - marginX * 2 - 14 });
    });

    // ── Section: Common Mistakes ──────────────────────────────────────────
    const sec2Y = sec1Y + 18 + DEADLINES.length * (deadlineItemH + 3) + 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('TOP 5 SP-1 REJECTION MISTAKES', marginX, sec2Y);
    doc.rect(marginX, sec2Y + 12, W - marginX * 2, 1).fill(C.orange);

    // Two-column mistake cards
    const COL = 2;
    const colW = (W - marginX * 2 - 10) / COL;
    const mistakeItemH = 52;

    MISTAKES.forEach((m, idx) => {
      const col = idx % COL;
      const row = Math.floor(idx / COL);
      const mx = marginX + col * (colW + 10);
      const my = sec2Y + 18 + row * (mistakeItemH + 4);

      doc.roundedRect(mx, my, colW, mistakeItemH, 4).fill(C.navyLight);
      // Number badge
      doc.roundedRect(mx, my, 18, mistakeItemH, 4).fill(C.orange);
      doc.rect(mx + 10, my, 8, mistakeItemH).fill(C.orange);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white);
      doc.text(`${m.n}`, mx, my + mistakeItemH / 2 - 7, { width: 18, align: 'center' });

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.orange);
      doc.text(m.title, mx + 22, my + 5, { width: colW - 26 });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.greyLight);
      doc.text(m.detail, mx + 22, my + 17, { width: colW - 26 });
      doc.font('Helvetica-Bold').fontSize(6).fillColor(C.orangeLight);
      doc.text('FIX: ', mx + 22, my + 37, { continued: true });
      doc.font('Helvetica').fontSize(6).fillColor(C.text);
      doc.text(m.fix, { width: colW - 26 });
    });

    // ── Section: Required Documents ───────────────────────────────────────
    const docRows = Math.ceil(MISTAKES.length / COL);
    const sec3Y = sec2Y + 18 + docRows * (mistakeItemH + 4) + 10;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('REQUIRED DOCUMENTS CHECKLIST', marginX, sec3Y);
    doc.rect(marginX, sec3Y + 12, W - marginX * 2, 1).fill(C.orange);

    // Two-column doc list
    const docCols = 2;
    const docColW = (W - marginX * 2 - 10) / docCols;
    const docItemH = 18;

    DOCUMENTS.forEach((d, i) => {
      const col = i % docCols;
      const row = Math.floor(i / docCols);
      const dx = marginX + col * (docColW + 10);
      const dy = sec3Y + 18 + row * (docItemH + 2);

      doc.roundedRect(dx, dy, docColW, docItemH, 3).fill(C.navyLight);
      // Checkbox square
      doc.rect(dx + 6, dy + 5, 8, 8).stroke(C.orange);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.text);
      doc.text(d.doc, dx + 20, dy + 4, { width: docColW - 24 });
      doc.font('Helvetica').fontSize(6).fillColor(C.grey);
      doc.text(d.note, dx + 20, dy + 12, { width: docColW - 24 });
    });

    // ── Automation preview callout ────────────────────────────────────────
    const docRows2 = Math.ceil(DOCUMENTS.length / docCols);
    const calloutY = sec3Y + 18 + docRows2 * (docItemH + 2) + 8;
    const calloutH = 28;

    doc.roundedRect(marginX, calloutY, W - marginX * 2, calloutH, 6).fill('#1e3a5f');
    doc.rect(marginX, calloutY, 4, calloutH).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text('CanalClear Automates All of This', marginX + 12, calloutY + 5);
    doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
    doc.text(
      'Auto-populate SP-1 from your vessel profile · Real-time TMA deadline alerts · One-click IMDG/DG manifest generation · KBŞ pilot booking integration',
      marginX + 12, calloutY + 16, { width: W - marginX * 2 - 20 }
    );

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = H - 36;
    doc.rect(0, footerY, W, 36).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange);
    doc.text('Eliminate SP-1 rejections automatically — try CanalClear free', marginX, footerY + 8, { continued: true });
    doc.font('Helvetica').fillColor(C.grey);
    doc.text('  ·  canal-clear.polsia.app', { lineBreak: false });

    doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
    doc.text(
      'Requirements current as of 2026. Always verify against the latest Turkish Maritime Authority SP-1 guidelines before filing.',
      marginX, footerY + 22, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the Bosporus SP-1 Primer PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 * Returns the hosted URL.
 */
async function ensureBosporusPrimerPDF(pool) {
  const ASSET_KEY = 'bosporus-sp1-primer-pdf';

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    const url = existing.data;
    console.log(`[Bosporus Primer] Already hosted at: ${url}`);
    return url;
  }

  console.log('[Bosporus Primer] Generating PDF…');
  const pdfBuffer = await generateBosporusPrimerPDF();
  console.log(`[Bosporus Primer] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: 'bosporus-sp1-primer.pdf',
        contentType: 'application/pdf',
      });
      const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (uploadData.success) {
        pdfUrl = uploadData.file.url;
        console.log(`[Bosporus Primer] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Bosporus Primer] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Bosporus Primer] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    // Fallback: serve internally via base64
    pdfUrl = '/assets/bosporus-sp1-primer.pdf?inline=1';
    console.log('[Bosporus Primer] Falling back to internal serve path');
  }

  // Ensure site_assets table exists and store
  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    // Store base64 for internal serving
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensureBosporusPrimerPDF, generateBosporusPrimerPDF };
