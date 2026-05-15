/**
 * Suez Canal SCA Filing Deadlines Cheat Sheet — PDF Generator
 *
 * Generates a professional A4 cheat sheet: "The 7 SCA Forms You Can't Miss"
 * CanalClear branding (deep navy + burnt orange, 2-column layout).
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function to get
 * the hosted URL (for use in /assets/suez-deadline-cheatsheet.pdf).
 */

'use strict';

const PDFDocument = require('pdfkit');
const { checkAssetExists, ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');

// Palette — deep navy, burnt orange, off-white, muted grey (CanalClear brand)
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

// The 7 SCA forms — deadlines, signatories, and #1 rejection mistake
const SCA_FORMS = [
  {
    n: 1,
    form: 'Transit Application',
    covers: 'Vessel particulars, intended transit date, cargo summary, agent details.',
    deadline: '72 hours before convoy booking',
    signedBy: 'Ship agent (authorized SCA-registered agent)',
    mistake: 'Submitting after the 72-hour cutoff — application auto-rejected, next convoy slot lost.',
  },
  {
    n: 2,
    form: 'Crew Manifest',
    covers: 'Full crew list — name, rank, nationality, passport/seaman book, STCW certificates.',
    deadline: '48 hours before transit date',
    signedBy: 'Master of the vessel',
    mistake: 'Missing STCW certificate numbers or expired seaman book — triggers manual review, delays boarding.',
  },
  {
    n: 3,
    form: 'Dangerous Goods Declaration',
    covers: 'IMDG manifest — UN numbers, hazard class, stow position, EmS sheets, segregation plan.',
    deadline: '72 hours before transit date',
    signedBy: 'Master + shipper (dual signature required)',
    mistake: 'Outdated IMDG edition reference (must cite current amendment 42-24) — entire DG declaration bounced.',
  },
  {
    n: 4,
    form: 'Pilotage Request',
    covers: 'Pilot boarding arrangements, maneuvering data, bridge equipment, tug requirements.',
    deadline: '48 hours before convoy time',
    signedBy: 'Master of the vessel',
    mistake: 'Not declaring LOA >270 m or beam >40 m — requires 2+ pilots; omission delays pilot allocation.',
  },
  {
    n: 5,
    form: 'SCNT Tonnage Certificate',
    covers: 'Suez Canal Net Tonnage calculation, GT/NT figures, rebate eligibility for bulk cargo.',
    deadline: 'Must be valid on transit date (apply 30 days prior if renewing)',
    signedBy: 'Classification society surveyor',
    mistake: 'SCNT/GT ratio outside 40-95% range — flags the certificate for re-measurement, blocking transit.',
  },
  {
    n: 6,
    form: 'Convoy Scheduling Form',
    covers: 'Preferred convoy (northbound/southbound), ETA at waiting area, speed capabilities.',
    deadline: '48 hours before intended convoy slot',
    signedBy: 'Ship agent',
    mistake: 'ETA at waiting area conflicts with requested convoy slot — auto-bumped to next available convoy.',
  },
  {
    n: 7,
    form: 'ISPS Security Declaration',
    covers: 'Ship security level, last 10 port calls, ISSC certificate details, security officer contact.',
    deadline: '96 hours before arrival at Suez Canal waters',
    signedBy: 'Company Security Officer (CSO)',
    mistake: 'Missing last-10-port-calls history — security hold at Port Said/Suez anchorage until verified.',
  },
];

/**
 * Generates the Suez SCA Deadline Cheat Sheet PDF and returns it as a Buffer.
 */
function generateSuezDeadlineCheatsheetPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Suez Canal SCA Filing Deadlines — The 7 Forms You Can\'t Miss',
        Author:   'CanalClear',
        Subject:  'Suez Canal Authority (SCA) Filing Deadlines Cheat Sheet',
        Creator:  'CanalClear (canal-clear.polsia.app)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Suez Canal, SCA, filing deadlines, transit, compliance, convoy, ISPS, SCNT',
      },
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;   // 595.28
    const H = doc.page.height;  // 841.89
    const marginX = 22;

    // ── Full-page navy background ──────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.navy);

    // ── Header band ───────────────────────────────────────────────────────
    const headerH = 98;
    doc.rect(0, 0, W, headerH).fill(C.navyLight);

    // Left orange accent stripe
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    // Logo text
    doc.font('Helvetica-Bold').fontSize(17).fillColor(C.orange);
    doc.text('CanalClear', marginX, 14);

    // Tagline
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Suez Canal Compliance Automation', marginX, 34);

    // Hook line
    doc.font('Helvetica-Bold').fontSize(10).fillColor(C.orangeLight);
    doc.text('Miss one deadline, miss your convoy slot.', marginX, 48);

    // Main headline
    doc.font('Helvetica-Bold').fontSize(15).fillColor(C.white);
    doc.text('SCA FILING DEADLINES \u2014 THE 7 FORMS YOU CAN\u2019T MISS', marginX, 64, { width: W - 200 });

    // Subtitle badge (right-aligned)
    const badgeW = 130, badgeH = 32;
    const badgeX = W - badgeW - 18;
    const badgeY = 20;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white);
    doc.text('2026 EDITION', badgeX, badgeY + 7, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Suez Canal Authority', badgeX, badgeY + 19, { width: badgeW, align: 'center' });

    // ── Column layout ──────────────────────────────────────────────────────
    const COL_COUNT = 2;
    const colGap   = 12;
    const colW     = (W - marginX * 2 - colGap) / COL_COUNT;
    const startY   = headerH + 10;
    // We have 7 items: col 1 gets 4 items, col 2 gets 3 items
    const rowsPerCol = 4;
    const itemH    = 87; // fixed height per card
    const itemGap  = 6;

    SCA_FORMS.forEach((form, idx) => {
      const col = idx < rowsPerCol ? 0 : 1;
      const row = idx < rowsPerCol ? idx : idx - rowsPerCol;
      const x   = marginX + col * (colW + colGap);
      const y   = startY + row * (itemH + itemGap);

      // Card background
      doc.roundedRect(x, y, colW, itemH, 5).fill(C.navyLight);
      // Left number stripe
      doc.roundedRect(x, y, 22, itemH, 5).fill(C.orange);
      doc.rect(x + 14, y, 8, itemH).fill(C.orange);  // square off right side

      // Number
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white);
      doc.text(`${form.n}`, x, y + itemH / 2 - 8, { width: 22, align: 'center' });

      const textX = x + 28;
      const textW = colW - 34;

      // Form name
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange);
      doc.text(form.form, textX, y + 5, { width: textW });

      // What it covers
      doc.font('Helvetica').fontSize(6.5).fillColor(C.greyLight);
      doc.text(form.covers, textX, y + 17, { width: textW, lineGap: 0.5 });

      // Deadline
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orangeLight);
      doc.text('DEADLINE: ', textX, y + 38, { continued: true });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.text);
      doc.text(form.deadline, { width: textW, lineGap: 0 });

      // Signed by
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orangeLight);
      doc.text('SIGNED BY: ', textX, y + 52, { continued: true });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.text);
      doc.text(form.signedBy, { width: textW, lineGap: 0 });

      // #1 Mistake
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#e05555');
      doc.text('#1 MISTAKE: ', textX, y + 66, { continued: true });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.greyLight);
      doc.text(form.mistake, { width: textW, lineGap: 0 });
    });

    // ── CTA band ─────────────────────────────────────────────────────────
    const ctaY = H - 62;
    doc.rect(0, ctaY, W, 62).fill(C.navyLight);
    doc.rect(0, ctaY, W, 2).fill(C.orange);

    // CTA pill
    const pillW = 420, pillH = 28;
    const pillX = (W - pillW) / 2;
    const pillY = ctaY + 10;
    doc.roundedRect(pillX, pillY, pillW, pillH, 14).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.white);
    doc.text(
      'Auto-fill all 7 SCA forms in minutes \u2014 try CanalClear free',
      pillX, pillY + 8,
      { width: pillW, align: 'center' }
    );

    // URL below pill
    doc.font('Helvetica').fontSize(7.5).fillColor(C.grey);
    doc.text(
      'canal-clear.polsia.app/demo/suez',
      0, pillY + pillH + 5,
      { width: W, align: 'center' }
    );

    // Disclaimer
    doc.font('Helvetica').fontSize(6).fillColor(C.grey);
    doc.text(
      'Deadlines per SCA Circular 4/2025. Always verify against the latest SCA Marine Circulars. \u00A9 2026 CanalClear.',
      marginX, ctaY + 48,
      { width: W - marginX * 2, align: 'center' }
    );

    doc.end();
  });
}

/**
 * Ensures the Suez cheat sheet PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 * Returns the hosted URL.
 */
async function ensureSuezDeadlineCheatsheetPDF(pool) {
  const ASSET_KEY = 'suez-deadline-cheatsheet-pdf';

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    const url = existing.data;
    console.log(`[Suez Cheatsheet] Already hosted at: ${url}`);
    return url;
  }

  console.log('[Suez Cheatsheet] Generating PDF\u2026');
  const pdfBuffer = await generateSuezDeadlineCheatsheetPDF();
  console.log(`[Suez Cheatsheet] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData = require('form-data');
      const formData = new FormData();
      formData.append('file', pdfBuffer, {
        filename: 'suez-deadline-cheatsheet.pdf',
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
        console.log(`[Suez Cheatsheet] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Suez Cheatsheet] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Suez Cheatsheet] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    // Fallback: store base64 in site_assets and serve internally
    pdfUrl = '/assets/suez-deadline-cheatsheet.pdf?inline=1';
    console.log('[Suez Cheatsheet] Falling back to internal serve path');
  }

  // Ensure site_assets table exists and store the URL (or base64 if fallback)
  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    // Store the raw PDF as base64 for internal serving
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
    await upsertAsset(pool, 'suez-deadline-cheatsheet-pdf-data', pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensureSuezDeadlineCheatsheetPDF, generateSuezDeadlineCheatsheetPDF };
