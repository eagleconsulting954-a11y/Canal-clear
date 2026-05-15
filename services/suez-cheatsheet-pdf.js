/**
 * Suez SCA Deadline Cheat Sheet PDF Generator
 *
 * Generates a one-page cheat sheet: "Suez Canal SCA Filing Deadline Cheat Sheet"
 * — the 7 forms, their deadlines, and the #1 rejection mistake for each.
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a route-handler
 * helper used by /assets/suez-deadline-cheatsheet.pdf.
 */

'use strict';

const PDFDocument = require('pdfkit');
const { checkAssetExists, ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');

// Palette — matches CanalClear brand
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

// The 7 SCA filing forms with deadline + #1 rejection mistake
const FORMS = [
  {
    n: 1,
    form: 'SCA Transit Application (TA)',
    deadline: '72 hours before entering the Canal',
    reject: 'ETA at Port Said/Suez entered in local time instead of UTC',
    fix: 'Always submit ETA in UTC. SCA auto-rejects entries that don\'t match VTS clock.',
  },
  {
    n: 2,
    form: 'Crew List (FAL 5)',
    deadline: '48 hours before arrival at anchorage',
    reject: 'Missing STCW certificate endorsement numbers for officers',
    fix: 'Include certificate number, issuing flag state, and expiry for every officer on watch.',
  },
  {
    n: 3,
    form: 'Cargo Declaration (FAL 2 / IMDG)',
    deadline: '48 hours before arrival',
    reject: 'DG entries missing UN number, hazard class, or stow location',
    fix: 'Each dangerous good line must include UN no., proper shipping name, class, PG, quantity, and stow.',
  },
  {
    n: 4,
    form: 'ISPS Security Declaration (ISSC)',
    deadline: '24 hours before arrival',
    reject: 'ISSC expired or security level not matching the vessel\'s current level',
    fix: 'Verify ISSC validity date before filing. Declare actual security level — SCA cross-checks with vessel history.',
  },
  {
    n: 5,
    form: 'SOPEP Summary (Oil Pollution Emergency Plan)',
    deadline: '24 hours before arrival',
    reject: 'Plan references superseded IMO MEPC resolution or lacks SCA contact numbers',
    fix: 'Use the latest SCA-approved MEPC.54(32) format and include SCA Port Control phone numbers.',
  },
  {
    n: 6,
    form: 'Ballast Water Management Declaration',
    deadline: '24 hours before arrival',
    reject: 'Ballast water exchange records missing GPS coordinates of exchange location',
    fix: 'Log exact lat/lon for every exchange event. SCA rejects summaries without positional data.',
  },
  {
    n: 7,
    form: 'Tonnage Certificate Summary (SCNT)',
    deadline: 'Submitted with Transit Application (72h)',
    reject: 'SCNT figures don\'t match International Tonnage Certificate (ITC 69)',
    fix: 'Copy figures directly from ITC 69. Discrepancies ≥1% trigger automatic rejection and re-toll calculation.',
  },
];

/**
 * Generates the PDF and returns it as a Buffer.
 */
function generateSuezCheatsheetPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Suez Canal SCA Filing Deadline Cheat Sheet — CanalClear',
        Author:   'CanalClear',
        Subject:  'Suez Canal SCA Filing Deadlines and Top Rejection Mistakes',
        Creator:  'CanalClear (canal-clear.polsia.app)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Suez Canal, SCA, filing deadlines, rejection, compliance, Transit Application',
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
    const headerH = 92;
    doc.rect(0, 0, W, headerH).fill(C.navyLight);

    // Left orange accent stripe
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    // Logo text
    doc.font('Helvetica-Bold').fontSize(17).fillColor(C.orange);
    doc.text('CanalClear', 24, 18);

    // Tagline
    doc.font('Helvetica').fontSize(9).fillColor(C.grey);
    doc.text('Suez Canal Compliance Automation', 24, 40);

    // Main headline
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.white);
    doc.text('SUEZ SCA FILING DEADLINE CHEAT SHEET', 24, 58, { width: W - 200 });

    // Sub-headline
    doc.font('Helvetica').fontSize(8).fillColor(C.greyLight);
    doc.text('7 forms · deadlines · #1 rejection mistake for each', 24, 76, { width: W - 200 });

    // Subtitle badge (right-aligned)
    const badgeW = 130, badgeH = 36;
    const badgeX = W - badgeW - 18;
    const badgeY = 28;
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 6).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white);
    doc.text('2026 EDITION', badgeX, badgeY + 5, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.white);
    doc.text('Suez Canal Authority (SCA)', badgeX, badgeY + 18, { width: badgeW, align: 'center' });
    doc.text('Current as of May 2026', badgeX, badgeY + 27, { width: badgeW, align: 'center' });

    // ── Form rows ──────────────────────────────────────────────────────────
    const marginX = 22;
    const rowGap   = 6;
    const rowCount = FORMS.length;
    const startY   = headerH + 10;
    const rowH     = (H - startY - 52 - (rowGap * (rowCount - 1))) / rowCount;

    FORMS.forEach((f, idx) => {
      const y = startY + idx * (rowH + rowGap);
      const x = marginX;
      const rowW = W - marginX * 2;

      // Row background
      doc.roundedRect(x, y, rowW, rowH, 4).fill(C.navyLight);

      // Number badge (left column)
      const numW = 28;
      doc.roundedRect(x, y, numW, rowH, 4).fill(C.orange);
      doc.rect(x + numW - 6, y, 6, rowH).fill(C.orange); // square off right
      doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white);
      doc.text(`${f.n}`, x, y + rowH / 2 - 8, { width: numW, align: 'center' });

      // Content area
      const contentX = x + numW + 8;
      const contentW = rowW - numW - 10;

      // Deadline pill (top-right)
      const deadlineText = f.deadline;
      const pillW = Math.min(contentW * 0.45, 190);
      const pillH = 14;
      const pillX = x + rowW - pillW - 4;
      const pillY = y + 5;
      doc.roundedRect(pillX, pillY, pillW, pillH, 3).fill(C.navyLight === C.navyLight ? '#1e2d45' : C.navyLight);
      doc.rect(pillX, pillY, pillW, pillH).fill('#0d1a2b');
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orange);
      doc.text('DEADLINE: ', pillX + 4, pillY + 3, { continued: true, lineBreak: false });
      doc.font('Helvetica').fillColor(C.greyLight);
      doc.text(deadlineText, { lineBreak: false, width: pillW - 8 });

      // Form name
      const nameY = y + 5;
      const nameW = rowW - numW - pillW - 14;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
      doc.text(f.form, contentX, nameY, { width: nameW, lineBreak: false });

      // Rejection mistake
      const rejectY = y + 18;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#e05a28');
      doc.text('⚠ MOST REJECTED FOR: ', contentX, rejectY, { continued: true, lineBreak: false });
      doc.font('Helvetica').fillColor(C.greyLight).fontSize(6.5);
      doc.text(f.reject, { width: contentW, lineBreak: false });

      // Fix
      const fixY = rejectY + 11;
      doc.font('Helvetica-Bold').fontSize(6).fillColor(C.orangeLight);
      doc.text('FIX: ', contentX, fixY, { continued: true, lineBreak: false });
      doc.font('Helvetica').fillColor(C.text).fontSize(6);
      doc.text(f.fix, { width: contentW });
    });

    // ── Footer ─────────────────────────────────────────────────────────────
    const footerY = H - 44;
    doc.rect(0, footerY, W, 44).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('Auto-file all 7 forms error-free — try CanalClear Suez Agent Pro', marginX, footerY + 10, { continued: true });
    doc.font('Helvetica').fillColor(C.grey);
    doc.text('  ·  canal-clear.polsia.app', { lineBreak: false });

    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text(
      'Deadlines current as of 2026. Always verify against latest SCA Maritime Services guidelines before filing.',
      marginX, footerY + 26, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the Suez Cheat Sheet PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 * Returns the served URL.
 */
async function ensureSuezCheatsheetPDF(pool) {
  const ASSET_KEY = 'suez-cheatsheet-pdf';

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    console.log(`[Suez Cheatsheet] Already hosted: ${existing.data}`);
    return existing.data;
  }

  console.log('[Suez Cheatsheet] Generating PDF…');
  const pdfBuffer = await generateSuezCheatsheetPDF();
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

  // Ensure site_assets table exists
  await ensureSiteAssetsTable(pool);

  if (pdfUrl) {
    // Store the R2 URL
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  } else {
    // Fallback: store base64 in DB
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
    pdfUrl = '/assets/suez-deadline-cheatsheet.pdf';
    console.log('[Suez Cheatsheet] Stored as base64 fallback');
  }

  return pdfUrl;
}

module.exports = { ensureSuezCheatsheetPDF, generateSuezCheatsheetPDF };
