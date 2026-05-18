/**
 * Suez Canal Convoy Booking Timeline Calculator PDF Generator
 *
 * Generates a professional A4 PDF lead magnet showing when each of the
 * 7 SCA forms is due relative to a vessel's transit / convoy booking date.
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function to
 * get the hosted URL (for use in /assets/suez-convoy-timeline-calculator.pdf redirect).
 */

'use strict';

const PDFDocument = require('pdfkit');
const { checkAssetExists, ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');

// Palette — CanalClear brand (matches VUMPA checklist)
const C = {
  navy:        '#1a2332',
  navyLight:   '#243450',
  navyMid:     '#1e2d44',
  orange:      '#d4622b',
  orangeLight: '#e8743e',
  white:       '#ffffff',
  offWhite:    '#f4f6f9',
  grey:        '#8fa3b8',
  greyLight:   '#c8d4e0',
  text:        '#e8eef4',
  textDark:    '#1a2332',
  green:       '#2a9d5c',
  yellow:      '#e9c46a',
  red:         '#e63946',
};

// ── 7 SCA Form Timeline Data ──────────────────────────────────────────────────
// Deadlines expressed relative to convoy booking date (T) or transit date
const SCA_FORMS = [
  {
    n: 1,
    name: 'Transit Application',
    arabicRef: 'Form 1 — طلب العبور',
    deadline: 'T − 14 days',
    deadlineDays: -14,
    responsible: 'Ship Agent (on behalf of Owner/Operator)',
    purpose: 'Master request for canal transit slot; triggers SCA booking system entry.',
    missConsequence: 'No convoy slot allocated. Vessel may wait 24–48h for next available southbound or northbound schedule.',
    tip: 'File 14+ days early to guarantee preferred convoy window. SCA slots fill fast during peak container season (Oct–Mar).',
    urgency: 'early',
  },
  {
    n: 2,
    name: 'Crew Manifest',
    arabicRef: 'Form 2 — بيان الطاقم',
    deadline: 'T − 7 days',
    deadlineDays: -7,
    responsible: 'Master / Ship Agent',
    purpose: 'Full crew list with nationalities, ranks, passport/seabook numbers, and STCW certificate details.',
    missConsequence: 'Boarding inspection delayed; vessel held at anchorage until manifest accepted. Missed convoy slot likely.',
    tip: 'Include STCW expiry dates. Officers from non-SOLAS-flag states need SCA-approved endorsements — verify ahead of transit.',
    urgency: 'normal',
  },
  {
    n: 3,
    name: 'Dangerous Goods Declaration',
    arabicRef: 'Form 3 — بيان البضائع الخطرة',
    deadline: 'T − 7 days',
    deadlineDays: -7,
    responsible: 'Master / Cargo Superintendent',
    purpose: 'IMDG Class 1–9 cargo declaration with UN numbers, stow positions, and packing groups.',
    missConsequence: 'SCA may refuse convoy entry or require re-inspection. Class 1 (explosives) and Class 7 (radioactive) carry mandatory 72h pre-clearance.',
    tip: 'Lithium batteries (UN3090/3091/3480/3481) require explicit declaration. "No DG on board" must also be filed explicitly if in ballast.',
    urgency: 'normal',
  },
  {
    n: 4,
    name: 'Pilotage Request',
    arabicRef: 'Form 4 — طلب الربان الملاحي',
    deadline: 'T − 48 hours',
    deadlineDays: -2,
    responsible: 'Ship Agent',
    purpose: 'Assigns SCA pilot for transit. Vessels LOA >270m or beam >40m require 2 pilots (submit as dual request).',
    missConsequence: 'Pilot may not be available for scheduled convoy. Vessel delays to next convoy window (typically 24h).',
    tip: 'Dual-pilot vessels must flag LOA and beam in request. Confirm pilot boarding point (Port Said for NB, Suez anchorage for SB) when filing.',
    urgency: 'normal',
  },
  {
    n: 5,
    name: 'SCNT Tonnage Certificate',
    arabicRef: 'Form 5 — شهادة الحمولة',
    deadline: 'T − 48 hours',
    deadlineDays: -2,
    responsible: 'Owner / Classification Society',
    purpose: 'Suez Canal Net Tonnage (SCNT) basis for transit toll calculation. Bulk carriers may qualify for SCNT rebate ≤75% GT.',
    missConsequence: 'SCA calculates tolls at full GT (no rebate). Contested tonnage extends clearance by 4–8h. Transit may roll to next convoy.',
    tip: 'SCNT/GT ratio must be 40–95%. If certificate is >5 years old, SCA may require fresh measurement survey — plan ahead.',
    urgency: 'normal',
  },
  {
    n: 6,
    name: 'Convoy Scheduling Form',
    arabicRef: 'Form 6 — جدول القافلة',
    deadline: 'T − 24 hours',
    deadlineDays: -1,
    responsible: 'Ship Agent',
    purpose: 'Confirms vessel position in convoy (northbound: Port Said 05:00 UTC, southbound: Great Bitter Lake holding). Locks in ETA.',
    missConsequence: 'SCA drops vessel from convoy list. Next available slot is 24h later minimum.',
    tip: 'Convoy speed minimum is 8 knots. Vessels unable to maintain speed must notify SCA at this stage — slow-speed permits can be arranged but add 6–12h.',
    urgency: 'late',
  },
  {
    n: 7,
    name: 'ISPS Security Declaration',
    arabicRef: 'Form 7 — إعلان ISPS',
    deadline: 'T − 24 hours',
    deadlineDays: -1,
    responsible: 'Master / Ship Security Officer (SSO)',
    purpose: 'ISPS Code compliance declaration. Confirms vessel holds current ISSC, security level, and SSO contact details.',
    missConsequence: 'SCA Port Control denies boarding to SCA pilot. Vessel held at anchorage; convoy proceeds without it.',
    tip: 'ISSC must be valid for the full transit date. If expiry is within 30 days, notify flag state for renewal NOW — replacement during transit area is not possible.',
    urgency: 'late',
  },
];

// Convoy windows info
const CONVOY_WINDOWS = [
  { dir: 'Northbound (NB)', time: '05:00 UTC', from: 'Port Said', color: C.orange },
  { dir: 'Southbound (SB)', time: '04:00 UTC', from: 'Great Bitter Lake', color: C.green },
];

// Common timing mistakes
const COMMON_MISTAKES = [
  'Counting calendar days from ETA, not from convoy booking confirmation — use booking date (T) as your anchor.',
  'Skipping the Dangerous Goods form for "small amounts" of lithium batteries — any quantity requires Form 3.',
  'Confusing transit date with arrival at anchorage — SCA clocks start when the Transit Application is confirmed, not when you arrive.',
  'Filing SCNT tonnage without checking rebate eligibility first — bulk carriers often leave money on the table.',
];

/**
 * Generates the PDF and returns it as a Buffer.
 */
function generateSuezConvoyTimelinePDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title:    'Suez Canal Convoy Booking Timeline Calculator — CanalClear',
        Author:   'CanalClear',
        Subject:  'Suez Canal SCA Form Submission Deadlines',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Suez Canal, SCA, convoy booking, timeline, maritime compliance, transit',
      },
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end',  () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = doc.page.width;    // 595.28
    const H = doc.page.height;   // 841.89
    const marginX = 24;

    // ── Full-page navy background ────────────────────────────────────────────
    doc.rect(0, 0, W, H).fill(C.navy);

    // ── Header band ──────────────────────────────────────────────────────────
    const headerH = 92;
    doc.rect(0, 0, W, headerH).fill(C.navyLight);
    // Left orange accent stripe
    doc.rect(0, 0, 5, headerH).fill(C.orange);

    // Logo
    doc.font('Helvetica-Bold').fontSize(16).fillColor(C.orange);
    doc.text('CanalClear', marginX + 4, 16);
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Suez Canal Compliance Automation', marginX + 4, 36);

    // Badge (top-right)
    const badgeW = 128, badgeH = 30;
    const badgeX = W - badgeW - 18;
    doc.roundedRect(badgeX, 22, badgeW, badgeH, 5).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);
    doc.text('2026 EDITION', badgeX, 28, { width: badgeW, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(C.white);
    doc.text('Suez Canal Authority', badgeX, 40, { width: badgeW, align: 'center' });

    // Main headline (two lines)
    doc.font('Helvetica-Bold').fontSize(14).fillColor(C.white);
    doc.text('SUEZ CANAL CONVOY BOOKING TIMELINE CALCULATOR', marginX + 4, 54, { width: W - badgeW - marginX - 30 });
    doc.font('Helvetica').fontSize(8.5).fillColor(C.grey);
    doc.text('Know Every Deadline Before You File', marginX + 4, 72, { width: W - badgeW - marginX - 30 });

    // ── Visual Timeline Bar ──────────────────────────────────────────────────
    const tlY = headerH + 10;
    const tlH = 30;
    doc.rect(0, tlY, W, tlH).fill(C.navyMid);

    // Timeline axis label
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.grey);
    doc.text('FILING WINDOW ──────────────────────────────────────────────────────────────────────────', marginX, tlY + 4, { width: W - marginX * 2 });

    // Days markers: T-14, T-7, T-48h, T-24h, TRANSIT
    const markers = [
      { label: 'T−14d',   x: marginX + 10,        color: C.orange },
      { label: 'T−7d',    x: marginX + 130,        color: C.orangeLight },
      { label: 'T−48h',   x: marginX + 265,        color: C.yellow },
      { label: 'T−24h',   x: marginX + 380,        color: C.red },
      { label: 'TRANSIT', x: W - marginX - 52,     color: C.green },
    ];
    markers.forEach(m => {
      doc.roundedRect(m.x, tlY + 14, 46, 13, 3).fill(m.color);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.white);
      doc.text(m.label, m.x, tlY + 18, { width: 46, align: 'center' });
    });

    // ── 7 SCA Form Cards ────────────────────────────────────────────────────
    const startY  = tlY + tlH + 8;
    const colW    = (W - marginX * 2 - 10) / 2;
    const colGap  = 10;
    const cardH   = 95;
    const cardGap = 6;

    // Left col: forms 1,2,3,4  Right col: forms 5,6,7 + convoy box
    const LEFT_FORMS  = [0, 1, 2, 3]; // indices into SCA_FORMS
    const RIGHT_FORMS = [4, 5, 6];

    function urgencyColor(urgency) {
      if (urgency === 'early') return C.orange;
      if (urgency === 'late')  return C.red;
      return C.yellow;
    }

    function drawFormCard(form, x, y, w) {
      // Card bg
      doc.roundedRect(x, y, w, cardH, 5).fill(C.navyLight);

      // Number stripe (left)
      doc.roundedRect(x, y, 20, cardH, 5).fill(urgencyColor(form.urgency));
      doc.rect(x + 12, y, 8, cardH).fill(urgencyColor(form.urgency));

      // Number
      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
      doc.text(`${form.n}`, x, y + cardH / 2 - 8, { width: 20, align: 'center' });

      const cx = x + 24;
      const cw = w - 28;

      // Deadline badge (right-aligned inside card)
      const dlBadgeW = 56;
      doc.roundedRect(cx + cw - dlBadgeW, y + 5, dlBadgeW, 14, 3).fill(urgencyColor(form.urgency));
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.white);
      doc.text(form.deadline, cx + cw - dlBadgeW, y + 9, { width: dlBadgeW, align: 'center' });

      // Form name
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
      doc.text(form.name, cx, y + 6, { width: cw - dlBadgeW - 4, lineGap: 0 });

      // Arabic ref
      doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
      doc.text(form.arabicRef, cx, y + 18, { width: cw, lineGap: 0 });

      // Purpose
      doc.font('Helvetica').fontSize(6.8).fillColor(C.greyLight);
      doc.text(form.purpose, cx, y + 29, { width: cw, lineGap: 0 });

      // Responsible
      const respY = y + 29 + doc.heightOfString(form.purpose, { width: cw }) + 3;
      doc.font('Helvetica-Bold').fontSize(6.2).fillColor(C.orangeLight);
      doc.text('WHO FILES: ', cx, respY, { continued: true, lineGap: 0 });
      doc.font('Helvetica').fontSize(6.2).fillColor(C.text);
      doc.text(form.responsible, { width: cw, lineGap: 0 });

      // Tip
      const tipY = respY + doc.heightOfString(`WHO FILES: ${form.responsible}`, { width: cw }) + 3;
      if (tipY + 10 < y + cardH - 4) {
        doc.font('Helvetica-Bold').fontSize(6).fillColor(C.green);
        doc.text('TIP: ', cx, tipY, { continued: true, lineGap: 0 });
        doc.font('Helvetica').fontSize(6).fillColor(C.text);
        doc.text(form.tip, { width: cw, lineGap: 0 });
      }
    }

    // Draw left column
    LEFT_FORMS.forEach((fi, row) => {
      const x = marginX;
      const y = startY + row * (cardH + cardGap);
      drawFormCard(SCA_FORMS[fi], x, y, colW);
    });

    // Draw right column (3 form cards)
    RIGHT_FORMS.forEach((fi, row) => {
      const x = marginX + colW + colGap;
      const y = startY + row * (cardH + cardGap);
      drawFormCard(SCA_FORMS[fi], x, y, colW);
    });

    // ── Convoy Booking Windows Box ────────────────────────────────────────────
    const convoyY = startY + RIGHT_FORMS.length * (cardH + cardGap);
    const convoyH = 50;
    const convoyX = marginX + colW + colGap;

    doc.roundedRect(convoyX, convoyY, colW, convoyH, 5).fill(C.navyMid);
    doc.rect(convoyX, convoyY, colW, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.orange);
    doc.text('CONVOY DEPARTURE WINDOWS', convoyX + 8, convoyY + 6, { width: colW - 16 });

    CONVOY_WINDOWS.forEach((cw, i) => {
      const rowY = convoyY + 20 + i * 14;
      doc.roundedRect(convoyX + 8, rowY, 8, 8, 2).fill(cw.color);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.white);
      doc.text(cw.dir, convoyX + 22, rowY + 1, { continued: true });
      doc.font('Helvetica').fillColor(C.grey);
      doc.text(`  ·  ${cw.time} from ${cw.from}`, { lineBreak: false });
    });

    // ── Common Mistakes Box ────────────────────────────────────────────────────
    const mistakeBoxY = startY + LEFT_FORMS.length * (cardH + cardGap);
    const mistakesAvailH = convoyY + convoyH - mistakeBoxY; // align bottom with convoy box bottom
    const mistakeX = marginX;

    doc.roundedRect(mistakeX, mistakeBoxY, colW, mistakesAvailH, 5).fill(C.navyMid);
    doc.rect(mistakeX, mistakeBoxY, colW, 1).fill(C.red);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.red);
    doc.text('COMMON TIMING MISTAKES', mistakeX + 8, mistakeBoxY + 6, { width: colW - 16 });

    let mTextY = mistakeBoxY + 19;
    COMMON_MISTAKES.forEach((m, i) => {
      if (mTextY + 8 < mistakeBoxY + mistakesAvailH - 4) {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orangeLight);
        doc.text(`${i + 1}. `, mistakeX + 8, mTextY, { continued: true, lineGap: 0 });
        doc.font('Helvetica').fontSize(6.5).fillColor(C.text);
        doc.text(m, { width: colW - 24, lineGap: 0 });
        mTextY += doc.heightOfString(m, { width: colW - 24 }) + 5;
      }
    });

    // ── Footer ────────────────────────────────────────────────────────────────
    const footerY = H - 44;
    doc.rect(0, footerY, W, 44).fill(C.navyLight);
    doc.rect(0, footerY, W, 1).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.orange);
    doc.text('Auto-fill all 7 SCA forms in minutes — try CanalClear free at', marginX, footerY + 10, { continued: true });
    doc.font('Helvetica-Bold').fillColor(C.orangeLight);
    doc.text('  canalclear.org/demo/suez', { lineBreak: false });

    doc.font('Helvetica').fontSize(7).fillColor(C.grey);
    doc.text(
      'SCA requirements current as of 2026. Always verify against the latest Suez Canal Authority maritime circulars.',
      marginX, footerY + 27, { width: W - marginX * 2 }
    );

    doc.end();
  });
}

/**
 * Ensures the Suez Convoy Timeline PDF exists in site_assets.
 * Generates + uploads to R2 if not already stored.
 * Returns the hosted URL.
 */
async function ensureSuezConvoyTimelinePDF(pool) {
  const ASSET_KEY = 'suez-convoy-timeline-pdf';

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    const url = existing.data;
    console.log(`[Suez Timeline PDF] Already hosted at: ${url}`);
    return url;
  }

  console.log('[Suez Timeline PDF] Generating PDF…');
  const pdfBuffer = await generateSuezConvoyTimelinePDF();
  console.log(`[Suez Timeline PDF] PDF generated (${pdfBuffer.length} bytes)`);

  const apiToken = process.env.POLSIA_API_KEY;
  let pdfUrl = null;

  if (apiToken) {
    try {
      const nodeFetch = require('node-fetch');
      const FormData  = require('form-data');
      const formData  = new FormData();
      formData.append('file', pdfBuffer, {
        filename:    'suez-convoy-timeline-calculator.pdf',
        contentType: 'application/pdf',
      });
      const uploadRes = await nodeFetch('https://polsia.com/api/proxy/r2/upload', {
        method:  'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...formData.getHeaders(),
        },
        body: formData,
      });
      const uploadData = await uploadRes.json();
      if (uploadData.success) {
        pdfUrl = uploadData.file.url;
        console.log(`[Suez Timeline PDF] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Suez Timeline PDF] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Suez Timeline PDF] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    // Fallback: serve internally from DB
    pdfUrl = '/assets/suez-convoy-timeline-calculator.pdf?inline=1';
    console.log('[Suez Timeline PDF] Falling back to internal serve path');
  }

  // Ensure site_assets table exists
  await ensureSiteAssetsTable(pool);

  if (pdfUrl.startsWith('/assets/')) {
    // Store raw PDF as base64 for internal serving
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
    await upsertAsset(pool, 'suez-convoy-timeline-pdf-data', pdfBuffer.toString('base64'), 'application/pdf');
  } else {
    await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');
  }

  return pdfUrl;
}

module.exports = { ensureSuezConvoyTimelinePDF, generateSuezConvoyTimelinePDF };
