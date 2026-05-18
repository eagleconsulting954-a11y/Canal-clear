'use strict';

/**
 * Suez Canal SCA Filing Primer PDF Generator
 *
 * Generates a professional guide: "Suez Canal SCA Filing — What You Need to Know"
 * with CanalClear maritime branding (deep navy + burnt orange).
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function
 * to get the hosted URL (for use in /assets/suez-sca-primer.pdf redirect).
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

// Key SCA deadlines
const DEADLINES = [
  {
    label: '24 Hours Before Entry',
    detail: 'Full SCA advance notification required: vessel particulars, cargo manifest, SCNT tonnage, pilot request, and ISPS security declaration. Convoy slot assignment is made at this stage.',
  },
  {
    label: '12 Hours Before Entry',
    detail: 'Updated ETA (±1 hour tolerance) must be confirmed via SCA Operations Center. Changes outside the tolerance window require re-scheduling and may result in convoy deferral.',
  },
  {
    label: '6 Hours Before Entry',
    detail: 'Pilot boarding confirmation required. ISPS declaration update if security level changed since initial filing. DG cargo vessels must confirm stow position and UN class documentation.',
  },
  {
    label: '1 Hour Before Lock Entry',
    detail: 'VHF contact with Port Said Radio (Ch 14 northbound) or Suez Roads (Ch 16 southbound). SCNT tonnage certificate physical copy ready for SCA inspector if requested.',
  },
];

// Common mistakes
const MISTAKES = [
  {
    n: 1,
    title: 'SCNT vs ITC GT/NT Mismatch',
    detail: 'Suez Canal Net Tonnage (SCNT) is calculated under SCA rules, not ITC. An ITC NT submitted in place of SCNT causes toll recalculation and holds the vessel pending SCA re-admeasurement.',
    fix: 'Use your SCA-issued SCNT certificate. CanalClear pre-fills from your verified vessel tonnage profile.',
  },
  {
    n: 2,
    title: 'Expired Vessel Certificates',
    detail: 'SCA inspectors check ISM, SOLAS, MARPOL, and Load Line certificates on arrival. A certificate expired >7 days triggers Port State Control referral — not an SCA delay, worse: a detention.',
    fix: 'Run CanalClear\'s certificate validity check pre-departure. Flags expirations 60 days before arrival.',
  },
  {
    n: 3,
    title: 'Convoy Slot Missed — ETA Drift',
    detail: 'The Suez Canal runs 2 northbound and 1 southbound convoy per day. Miss your slot window by >1 hour and you wait for the next day\'s convoy — an 18–24h delay minimum at Port Said or Suez Roads.',
    fix: 'File ETA updates in real time. CanalClear pushes AIS-derived ETA corrections to the SCA portal automatically.',
  },
  {
    n: 4,
    title: 'DG Cargo Not Pre-Declared',
    detail: 'Class 1 (explosives) and Class 7 (radioactive) cargo require SCA pre-clearance before the 24-hour filing window opens. Standard DG (Classes 2–6, 8–9) must have UN class declared at filing.',
    fix: 'Start DG pre-clearance 96+ hours before Suez entry. CanalClear flags DG routes and routes to correct SCA desk.',
  },
  {
    n: 5,
    title: 'ISPS Level Mismatch',
    detail: 'If the vessel\'s ISPS security level differs from the last 10 port calls declared, SCA can trigger a Port Facility Security Officer interview — adding 4–8h to the clearance process.',
    fix: 'Verify ISPS level consistency across last-10-port declarations. CanalClear pre-populates from your ISPS records.',
  },
];

// Required documents
const DOCUMENTS = [
  { doc: 'SCA Transit Application (Form 1)', note: 'Filed via SCA online portal; signed by master' },
  { doc: 'SCNT Admeasurement Certificate', note: 'SCA-issued; must match SCNT on form exactly' },
  { doc: 'Crew List (SCA Format)', note: 'Full names, nationalities, STCW refs for officers' },
  { doc: 'Cargo Declaration / Manifest', note: 'Full description; UN class/stow positions for DG' },
  { doc: 'ISPS Security Declaration', note: 'Current security level + last-10-ports record' },
  { doc: 'Dangerous Goods Declaration', note: 'Required even if NIL — blank field is rejected' },
  { doc: 'Pilot Request Confirmation', note: 'SCA pilots compulsory for all commercial vessels' },
  { doc: 'Ballast Water Management Record', note: 'Current BWMC + last BWE record page' },
];

/**
 * Generates the Suez SCA Primer PDF and returns it as a Buffer.
 */
function generateSuezScaPrimerPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Suez Canal SCA Filing Primer — CanalClear',
        Author:   'CanalClear',
        Subject:  'Suez Canal Authority Transit Filing Requirements',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Suez Canal, SCA, SCNT, UMS, transit filing, maritime compliance',
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
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.orange);
    doc.text('CanalClear', marginX, 16);

    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Maritime Compliance Automation', marginX, 38);

    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.white);
    doc.text('SUEZ CANAL SCA FILING PRIMER', marginX, 56, { width: W - 180 });

    const badgeW = 135, badgeH = 34;
    const badgeX = W - badgeW - 18;
    const badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white);
    doc.text('2025 EDITION', badgeX, badgeY + 6, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Suez Canal Authority', badgeX, badgeY + 19, { width: badgeW, align: 'center' });

    // ── Intro line ────────────────────────────────────────────────────────
    const introY = headerH + 10;
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(
      'The Suez Canal carries 12–15% of global trade — 120 miles from Port Said to Suez. '
      + 'The SCA runs two northbound convoys and one southbound convoy daily. Miss your slot or submit the wrong SCNT tonnage and you\'re at anchor in Port Said or Suez Roads for up to 24 hours.',
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
      doc.rect(marginX, dy, 4, deadlineItemH).fill(C.orange);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.orangeLight);
      doc.text(d.label + ' — ', marginX + 10, dy + 4, { continued: true });
      doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
      doc.text(d.detail, { width: W - marginX * 2 - 14 });
    });

    // ── Section: Common Mistakes ──────────────────────────────────────────
    const sec2Y = sec1Y + 18 + DEADLINES.length * (deadlineItemH + 3) + 10;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('TOP 5 SCA REJECTION MISTAKES', marginX, sec2Y);
    doc.rect(marginX, sec2Y + 12, W - marginX * 2, 1).fill(C.orange);

    const COL = 2;
    const colW = (W - marginX * 2 - 10) / COL;
    const mistakeItemH = 52;

    MISTAKES.forEach((m, idx) => {
      const col = idx % COL;
      const row = Math.floor(idx / COL);
      const mx = marginX + col * (colW + 10);
      const my = sec2Y + 18 + row * (mistakeItemH + 4);

      doc.roundedRect(mx, my, colW, mistakeItemH, 4).fill(C.navyLight);
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

    const docCols = 2;
    const docColW = (W - marginX * 2 - 10) / docCols;
    const docItemH = 18;

    DOCUMENTS.forEach((d, i) => {
      const col = i % docCols;
      const row = Math.floor(i / docCols);
      const dx = marginX + col * (docColW + 10);
      const dy = sec3Y + 18 + row * (docItemH + 2);

      doc.roundedRect(dx, dy, docColW, docItemH, 3).fill(C.navyLight);
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
      'Auto-populate SCA form from your vessel profile · Real-time convoy deadline alerts · SCNT tonnage validation · One-click DG manifest generation',
      marginX + 12, calloutY + 16, { width: W - marginX * 2 - 20 }
    );

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = H - 36;
    doc.rect(0, footerY, W, 36).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange);
    doc.text('Eliminate SCA rejections automatically — try CanalClear free', marginX, footerY + 8, { continued: true });
    doc.font('Helvetica').fillColor(C.grey);
    doc.text('  ·  canalclear.org', { lineBreak: false });

    doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
    doc.text(
      'Requirements current as of 2025. Always verify against the latest Suez Canal Authority guidelines before filing.',
      marginX, footerY + 22, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the Suez SCA Primer PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 */
async function ensureSuezScaPrimerPDF(pool) {
  const ASSET_KEY = 'suez-sca-primer-pdf';

  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    console.log(`[Suez Primer] Already hosted at: ${existing.data}`);
    return existing.data;
  }

  console.log('[Suez Primer] Generating PDF…');
  const pdfBuffer = await generateSuezScaPrimerPDF();
  console.log(`[Suez Primer] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: 'suez-sca-primer.pdf',
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
        console.log(`[Suez Primer] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Suez Primer] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Suez Primer] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    pdfUrl = '/assets/suez-sca-primer.pdf?inline=1';
    console.log('[Suez Primer] Falling back to internal serve path');
  }

  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensureSuezScaPrimerPDF, generateSuezScaPrimerPDF };
