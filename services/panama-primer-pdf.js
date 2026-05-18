'use strict';

/**
 * Panama Canal VUMPA Filing Primer PDF Generator
 *
 * Generates a professional guide: "Panama Canal VUMPA Filing — What You Need to Know"
 * with CanalClear maritime branding (deep navy + burnt orange).
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function
 * to get the hosted URL (for use in /assets/panama-vumpa-primer.pdf redirect).
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

// Key VUMPA deadlines
const DEADLINES = [
  {
    label: '96 Hours Before Transit',
    detail: 'VUMPA advance notice required by the Panama Canal Authority (ACP). ETA must be filed along with vessel particulars, cargo type, and PC/UMS tonnage. Late filing drops vessel to secondary queue.',
  },
  {
    label: '72 Hours Before Transit',
    detail: 'Full ACP transit application with cargo manifest, DG declaration, and crew list must be confirmed. Dangerous goods Class 1/7 cargo requires separate ACP pre-approval at this stage.',
  },
  {
    label: '24 Hours Before Transit',
    detail: 'Ballast water management plan update required if BWE performed en route. Updated ETA ±1 hour must be confirmed. Pilot assignment is issued at this stage — vessel must acknowledge.',
  },
  {
    label: '4 Hours Before Lock Entry',
    detail: 'Final ACP check-in via VHF Ch 12 (Cristobal) or Ch 16 (Balboa). ISPS declaration update if security level changed. No amendments permitted after this point without ACP waiver.',
  },
];

// Common mistakes
const MISTAKES = [
  {
    n: 1,
    title: 'PC/UMS vs ITC Tonnage Mismatch',
    detail: 'ACP uses Panama Canal / Universal Measurement System (PC/UMS) tonnage, not the ITC GT/NT. A GT mismatch ≥0.5% triggers re-admeasurement and delays of 12–48h.',
    fix: 'Always use your ACP-issued PC/UMS certificate. CanalClear pre-fills from your verified vessel profile.',
  },
  {
    n: 2,
    title: 'Expired ACP Admeasurement Certificate',
    detail: 'ACP certificates expire on structural vessel changes. Post-modification vessels without updated admeasurement are held at anchorage pending ACP surveyor attendance.',
    fix: 'Verify certificate validity date before filing. CanalClear flags expiring certificates 90 days in advance.',
  },
  {
    n: 3,
    title: 'Missing Ballast Water Management Certificate',
    detail: 'ACP requires a valid BWM convention certificate and the last ballast water exchange record. Vessels missing either document are refused slot allocation.',
    fix: 'Attach current BWMC and last BWE log page. CanalClear includes this in the pre-transit checklist.',
  },
  {
    n: 4,
    title: 'Incorrect DG Classification',
    detail: 'Class 1 (explosives) and Class 7 (radioactive) cargo require separate ACP pre-clearance 96h before VUMPA filing. Filing without this clearance in place is rejected outright.',
    fix: 'File DG pre-clearance first. CanalClear routes DG vessels to the correct ACP desk automatically.',
  },
  {
    n: 5,
    title: 'LOA Exceeds Lock Chamber Limits',
    detail: 'Neopanamax locks: 427m LOA × 55m beam × 15.2m fresh-water draft. Overage triggers ICTSI-class exception process — adds 24–72h. Many operators overlook fresh-water draft correction.',
    fix: 'Apply the ACP fresh-water allowance to your salt-water draft before filing. CanalClear calculates this automatically.',
  },
];

// Required documents
const DOCUMENTS = [
  { doc: 'VUMPA Transit Application (ACP Form)', note: 'Signed by master; filed via ACP e-business portal' },
  { doc: 'PC/UMS Admeasurement Certificate', note: 'ACP-issued; must match GT/NT on form exactly' },
  { doc: 'Crew List (ACP Format)', note: 'STCW cert references for officers; nationalities required' },
  { doc: 'Cargo Declaration / Manifest', note: 'Full cargo description; UN class for hazmat' },
  { doc: 'Dangerous Goods Declaration', note: 'Required even if NIL — blank field is rejected' },
  { doc: 'ISPS Security Declaration', note: 'Current security level; port facility statement' },
  { doc: 'Ballast Water Management Certificate', note: 'Current BWMC + last BWE record page' },
  { doc: 'Draft and Stability Certificate', note: 'Current trim/stability report for full/ballast condition' },
];

/**
 * Generates the Panama VUMPA Primer PDF and returns it as a Buffer.
 */
function generatePanamaVumpaPrimerPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Panama Canal VUMPA Filing Primer — CanalClear',
        Author:   'CanalClear',
        Subject:  'Panama Canal VUMPA Transit Filing Requirements',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Panama Canal, VUMPA, ACP, PC/UMS, transit filing, maritime compliance',
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
    doc.text('PANAMA CANAL VUMPA FILING PRIMER', marginX, 56, { width: W - 180 });

    // Subtitle badge (right-aligned)
    const badgeW = 135, badgeH = 34;
    const badgeX = W - badgeW - 18;
    const badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white);
    doc.text('2025 EDITION', badgeX, badgeY + 6, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Panama Canal Authority', badgeX, badgeY + 19, { width: badgeW, align: 'center' });

    // ── Intro line ────────────────────────────────────────────────────────
    const introY = headerH + 10;
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(
      'The Panama Canal connects the Atlantic and Pacific Oceans — 50 miles through Gatun, Pedro Miguel, and Miraflores locks. '
      + 'VUMPA is the ACP\'s advance transit application. Miss the 96-hour window or submit the wrong PC/UMS tonnage and your slot moves to the next available convoy — often 24–48 hours later.',
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
    doc.text('TOP 5 VUMPA REJECTION MISTAKES', marginX, sec2Y);
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
      'Auto-populate VUMPA from your vessel profile · Real-time ACP deadline alerts · PC/UMS tonnage validation · One-click DG manifest generation',
      marginX + 12, calloutY + 16, { width: W - marginX * 2 - 20 }
    );

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = H - 36;
    doc.rect(0, footerY, W, 36).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange);
    doc.text('Eliminate VUMPA rejections automatically — try CanalClear free', marginX, footerY + 8, { continued: true });
    doc.font('Helvetica').fillColor(C.grey);
    doc.text('  ·  canalclear.org', { lineBreak: false });

    doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
    doc.text(
      'Requirements current as of 2025. Always verify against the latest Panama Canal Authority VUMPA guidelines before filing.',
      marginX, footerY + 22, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the Panama VUMPA Primer PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 */
async function ensurePanamaVumpaPrimerPDF(pool) {
  const ASSET_KEY = 'panama-vumpa-primer-pdf';

  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    console.log(`[Panama Primer] Already hosted at: ${existing.data}`);
    return existing.data;
  }

  console.log('[Panama Primer] Generating PDF…');
  const pdfBuffer = await generatePanamaVumpaPrimerPDF();
  console.log(`[Panama Primer] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: 'panama-vumpa-primer.pdf',
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
        console.log(`[Panama Primer] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Panama Primer] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Panama Primer] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    pdfUrl = '/assets/panama-vumpa-primer.pdf?inline=1';
    console.log('[Panama Primer] Falling back to internal serve path');
  }

  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensurePanamaVumpaPrimerPDF, generatePanamaVumpaPrimerPDF };
