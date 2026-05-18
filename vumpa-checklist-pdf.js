/**
 * VUMPA Rejection Checklist PDF Generator
 *
 * Generates a professional one-page checklist: "Top 10 Reasons Panama VUMPA Filings
 * Get Rejected (And How to Fix Them)" with CanalClear branding.
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function to get
 * the hosted URL (for use in /assets/vumpa-rejection-checklist.pdf redirect).
 */

'use strict';

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

// The 10 rejection reasons — research-backed from VUMPA/ACP requirements
const REJECTIONS = [
  {
    n: 1,
    reason: 'Invalid or Mis-formatted IMO Number',
    detail: 'IMO number fails checksum (7-digit format, check digit = weighted sum mod 10).',
    fix: 'Verify IMO with the checksum formula before submitting. CanalClear validates keystroke-by-keystroke.',
  },
  {
    n: 2,
    reason: 'Missing or Outdated PCSOPEP Attachment',
    detail: 'ACP requires a current, ACP-approved bilingual (Spanish/English) PCSOPEP signed by the serving master.',
    fix: 'Attach the PCSOPEP PDF in the VUMPA upload. Ensure it reflects the current master\u2019s signature and ACP approval stamp.',
  },
  {
    n: 3,
    reason: 'ETA Submitted Inside the 96-Hour Window',
    detail: 'VUMPA must be received at least 96 hours before arrival at Balboa or Cristóbal anchorage.',
    fix: 'File before the 96-hour mark. Any ETA revision after filing may require a VUMPA amendment.',
  },
  {
    n: 4,
    reason: 'PC/UMS Tonnage Mismatch',
    detail: 'Tonnage entered in VUMPA does not match the International Tonnage Certificate or GA plan calculations.',
    fix: 'Cross-check PC/UMS figures against the current ITC. Discrepancies ≥1% trigger automatic rejection.',
  },
  {
    n: 5,
    reason: 'Incorrect or Missing Transit Date / Direction',
    detail: 'Transit date conflicts with ETA, or direction (Northbound/Southbound) is blank or reversed.',
    fix: 'Confirm ETA at anchorage matches expected canal entry direction and use UTC throughout.',
  },
  {
    n: 6,
    reason: 'Incomplete or Incorrect Crew Manifest',
    detail: 'Missing STCW certificate details, flag-state endorsements, or officer watch-keeping certifications.',
    fix: 'Include full name, rank, nationality, certificate number, and STCW expiry for every officer. Ratings need seabook details.',
  },
  {
    n: 7,
    reason: 'General Arrangement Plan Not Current',
    detail: 'GA plan does not reflect post-modification vessel configuration, or is unscaled / illegible.',
    fix: 'Use the latest approved GA showing all decks, holds, tanks, and mooring gear. Verify it matches structural modifications.',
  },
  {
    n: 8,
    reason: 'Dangerous Goods (IMDG) Declaration Errors',
    detail: 'Outdated UN numbers, wrong hazard class, missing stow location, or incomplete DG manifest.',
    fix: 'Cross-validate every DG entry against current IMDG code. Include UN number, proper shipping name, class, packing group, quantity, and stow.',
  },
  {
    n: 9,
    reason: 'Vessel Dimensions Outside Accepted Parameters',
    detail: 'LOA, beam, or maximum draft entries do not match Loadline Certificate or conflict with Neopanamax lock limits.',
    fix: 'Enter exact dimensions from the Loadline Certificate. Flag vessels over 366m LOA or 51.25m beam — they need prior ACP clearance.',
  },
  {
    n: 10,
    reason: 'Cargo Declaration / B/L Number Missing or Mismatched',
    detail: 'Bill of lading number absent, cargo type field blank, or quantity conflicts with the cargo manifest.',
    fix: 'List all B/L numbers with matching cargo description and quantity. "In ballast" must be declared explicitly if carrying no cargo.',
  },
];

/**
 * Generates the PDF and returns it as a Buffer.
 */
function generateVumpaChecklistPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Top 10 VUMPA Rejection Reasons — CanalClear',
        Author:   'CanalClear',
        Subject:  'Panama Canal VUMPA Filing Rejection Checklist',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'VUMPA, Panama Canal, ACP, filing, rejection, compliance',
      },
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89

    // ── Full-page navy background ──────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.navy);

    // ── Header band ───────────────────────────────────────────────────────
    const headerH = 88;
    doc.rect(0, 0, W, headerH).fill(C.navyLight);

    // Left orange accent stripe
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    // Logo text
    doc.font('Helvetica-Bold').fontSize(17).fillColor(C.orange);
    doc.text('CanalClear', 24, 18);

    // Tagline
    doc.font('Helvetica').fontSize(9).fillColor(C.grey);
    doc.text('Panama Canal Compliance Automation', 24, 40);

    // Main headline
    doc.font('Helvetica-Bold').fontSize(15).fillColor(C.white);
    doc.text('TOP 10 REASONS VUMPA FILINGS GET REJECTED', 24, 58, { width: W - 200 });

    // Subtitle badge (right-aligned)
    const badgeW = 130, badgeH = 32;
    const badgeX = W - badgeW - 18;
    const badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white);
    doc.text('2026 EDITION', badgeX, badgeY + 7, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Panama Canal Authority', badgeX, badgeY + 19, { width: badgeW, align: 'center' });

    // ── Column layout ──────────────────────────────────────────────────────
    const COL_COUNT = 2;
    const marginX = 22;
    const colGap   = 12;
    const colW     = (W - marginX * 2 - colGap) / COL_COUNT;
    const startY   = headerH + 12;
    const itemH    = (H - startY - 52) / Math.ceil(REJECTIONS.length / COL_COUNT) - 5;

    REJECTIONS.forEach((r, idx) => {
      const col = idx % COL_COUNT;
      const row = Math.floor(idx / COL_COUNT);
      const x   = marginX + col * (colW + colGap);
      const y   = startY + row * (itemH + 6);

      // Card background
      doc.roundedRect(x, y, colW, itemH, 5).fill(C.navyLight);
      // Left number stripe
      doc.roundedRect(x, y, 22, itemH, 5).fill(C.orange);
      doc.rect(x + 14, y, 8, itemH).fill(C.orange);  // square off right side

      // Number
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
      doc.text(`${r.n}`, x, y + itemH / 2 - 7, { width: 22, align: 'center' });

      // Reason heading
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
      doc.text(r.reason, x + 26, y + 6, { width: colW - 30, lineGap: 0 });

      // Detail
      doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
      const detailY = y + 19;
      doc.text(r.detail, x + 26, detailY, { width: colW - 30, lineGap: 0 });

      // Fix label + text
      const fixLabelY = detailY + doc.heightOfString(r.detail, { width: colW - 30 }) + 4;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orangeLight);
      doc.text('FIX: ', x + 26, fixLabelY, { continued: true, lineGap: 0 });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.text);
      doc.text(r.fix, { width: colW - 30, lineGap: 0 });
    });

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = H - 44;
    doc.rect(0, footerY, W, 44).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('Eliminate rejections automatically — try CanalClear free', marginX, footerY + 10, { continued: true });
    doc.font('Helvetica').fillColor(C.grey);
    doc.text('  ·  canalclear.org', { lineBreak: false });

    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text(
      'Requirements current as of 2026. Always verify against the latest ACP Maritime Service Portal guidelines.',
      marginX, footerY + 26, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the VUMPA checklist PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 * Returns the hosted URL.
 */
async function ensureVumpaChecklistPDF(pool) {
  const ASSET_KEY = 'vumpa-checklist-pdf';

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    const url = existing.data;
    console.log(`[VUMPA Checklist] Already hosted at: ${url}`);
    return url;
  }

  console.log('[VUMPA Checklist] Generating PDF…');
  const pdfBuffer = await generateVumpaChecklistPDF();
  console.log(`[VUMPA Checklist] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: 'vumpa-rejection-checklist.pdf',
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
        console.log(`[VUMPA Checklist] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[VUMPA Checklist] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[VUMPA Checklist] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    // Fallback: store base64 in site_assets and serve internally
    pdfUrl = '/assets/vumpa-rejection-checklist.pdf?inline=1';
    console.log('[VUMPA Checklist] Falling back to internal serve path');
  }

  // Ensure site_assets table exists and store the URL (or base64 if fallback)
  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    // Store the raw PDF as base64 for internal serving
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
    await upsertAsset(pool, 'vumpa-checklist-pdf-data', pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensureVumpaChecklistPDF, generateVumpaChecklistPDF };
