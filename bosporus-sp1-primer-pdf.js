/**
 * Bosporus Strait SP-1 Filing Primer PDF Generator
 *
 * Generates a professional 4-page A4 primer:
 * "Bosporus Strait SP-1 Filing: What You Need to Know"
 *
 * Audience: fleet operators, ship agents, charterers transiting the Bosporus.
 * Design: deep navy background, burnt orange accents — CanalClear maritime aesthetic.
 *
 * Uploads to R2, stores the URL in site_assets, and exposes a function to get
 * the hosted URL (for use in /assets/bosporus-sp1-primer.pdf redirect).
 */

'use strict';

const PDFDocument = require('pdfkit');
const { checkAssetExists, ensureSiteAssetsTable, upsertAsset } = require('../db/site-assets');

// ── Colour palette — matches VUMPA Rejection Checklist ───────────────────────
const C = {
  navy:        '#1a2332',
  navyLight:   '#243450',
  navyMid:     '#1e2d42',
  orange:      '#d4622b',
  orangeLight: '#e8743e',
  white:       '#ffffff',
  offWhite:    '#f4f6f9',
  grey:        '#8fa3b8',
  greyLight:   '#c8d4e0',
  text:        '#e8eef4',
  textDark:    '#1a2332',
  green:       '#2e8b5a',
  greenLight:  '#3aad70',
  red:         '#c0392b',
  amber:       '#d4862b',
};

// ── Geometry ─────────────────────────────────────────────────────────────────
const W = 595.28;  // A4 width
const H = 841.89;  // A4 height
const MARGIN = 36;
const COL_W = W - MARGIN * 2;

// ── Content ──────────────────────────────────────────────────────────────────

const REQUIRED_DOCUMENTS = [
  { name: 'SP-1 Application Form', desc: 'Submitted via Turkish VTMIS or through a licensed ship agent. Includes vessel particulars, voyage plan, ETA/ETD, and cargo declaration.' },
  { name: 'Vessel Particulars Sheet', desc: 'LOA, beam, draft (fwd/aft), GT, NT, DWT, type of vessel, flag, IMO number, and P&I Club certificate.' },
  { name: 'Crew List (TDA format)', desc: 'Full crew manifest with nationalities, ranks, and certificate numbers. Submitted to Turkish Coast Guard simultaneously.' },
  { name: 'Cargo Declaration', desc: 'Description, quantity, UN number (if hazardous), B/L numbers, consignee, and stow plan page for dangerous goods.' },
  { name: 'ISPS / SSP Summary', desc: 'Current Security Level declaration and Ship Security Plan confirmation. Port of last call\u2019s ISPS status may be required.' },
  { name: 'P&I Club Certificate', desc: 'Valid proof of P&I coverage with minimum USD 1 billion liability cover for Bosporus transit.' },
  { name: 'Insurance Certificate', desc: 'Hull & Machinery certificate showing current validity for the transit date.' },
  { name: 'Pilotage Confirmation', desc: 'Turkish Maritime Administration (UDHB) compulsory pilotage for vessels ≥500 GT. Pilot boarding position: Büyükdere (southbound) or Haydarpaşa (northbound).' },
];

const DEADLINES = [
  { time: '24 hours', event: 'Initial SP-1 submission to Turkish VTMIS via accredited ship agent', critical: true },
  { time: '12 hours', event: 'Final confirmation of ETA, cargo details, and crew list submission', critical: true },
  { time: '6 hours',  event: 'Pilot order confirmation to Istanbul VTS (VHF Ch 12/16)', critical: false },
  { time: '4 hours',  event: 'Dangerous goods pre-notification (if applicable) to Istanbul Port Authority', critical: false },
  { time: '2 hours',  event: 'Bunker declaration and waste management plan if bunkering in Istanbul', critical: false },
  { time: '1 hour',   event: 'Final draft and air draft confirmation if near Bosporus Bridge clearance limits', critical: false },
];

const COMMON_MISTAKES = [
  {
    n: 1,
    title: 'Missing or Expired P&I Certificate',
    detail: 'P&I certificates that expired within 30 days of filing are rejected even if technically valid at transit. Turkish authorities check against Lloyd\'s database.',
    fix: 'Verify P&I validity date ≥30 days beyond transit date. Obtain a Letter of Undertaking from your P&I Club if renewing close to transit.',
  },
  {
    n: 2,
    title: 'Draft Exceeds 17.45m (Loaded Condition)',
    detail: 'Maximum permissible draft for southbound (laden) tankers is 17.45m. Northbound limit is 15.00m for certain vessel types. Exceeding either triggers hold order.',
    fix: 'Calculate final loaded draft including freshwater allowance before filing. Request prior permission from UDHB if near limits.',
  },
  {
    n: 3,
    title: 'LOA Over 350m Without Prior Approval',
    detail: 'Vessels exceeding 350m LOA require special permission from Turkish Maritime Administration (typically 5–10 business days). SP-1 alone is insufficient.',
    fix: 'Apply for Oversized Vessel Permission ≥10 days before transit. Attach UDHB approval reference in SP-1 notes field.',
  },
  {
    n: 4,
    title: 'ETA Submitted After 24-Hour Deadline',
    detail: 'Late SP-1 filings do not automatically anchor the vessel\'s queue position. Turkish VTS assigns berth/anchor awaiting correction — costly delays result.',
    fix: 'File at T-24h minimum. For complex cargo or oversized vessels, target T-48h to allow for amendment cycles.',
  },
  {
    n: 5,
    title: 'Cargo Description Mismatch (B/L vs SP-1)',
    detail: 'SP-1 cargo description must exactly match the Bill of Lading. "Crude oil" vs. "petroleum crude" are treated as discrepancies by customs.',
    fix: 'Copy cargo description verbatim from B/L. Do not abbreviate or paraphrase. For bulk liquids, include IMO class if applicable.',
  },
  {
    n: 6,
    title: 'ISPS Security Level Not Declared',
    detail: 'Vessels arriving from ports with ISPS Security Level 2 or 3 must declare this and submit additional security measures documentation.',
    fix: 'Check last port\'s security level before filing. Attach security log pages if arriving from Level 2/3 ports.',
  },
];

const SP1_DATA_FIELDS = [
  ['Vessel Name', 'IMO Number', 'Flag State', 'Call Sign'],
  ['LOA (m)', 'Beam (m)', 'Draft Fwd (m)', 'Draft Aft (m)'],
  ['GT / NT', 'DWT', 'Vessel Type', 'Year Built'],
  ['P&I Club', 'P&I Cert Exp.', 'Hull Insurer', 'H&M Cert Exp.'],
  ['Master Name', 'Master Nationality', 'Crew Count', 'Last Port'],
  ['Next Port', 'ETA Bosporus', 'ETD Bosporus', 'Transit Direction'],
  ['Cargo Type', 'Cargo Quantity', 'UN No. (DG)', 'B/L Number(s)'],
  ['Agent Name', 'Agent Contact', 'Ship Owner', 'Charterer'],
];

// ── Drawing Helpers ───────────────────────────────────────────────────────────

function drawHeader(doc, title, subtitle, page) {
  // Full-page navy background
  doc.rect(0, 0, W, H).fill(C.navy);

  // Header band
  const headerH = 72;
  doc.rect(0, 0, W, headerH).fill(C.navyLight);

  // Left orange stripe
  doc.rect(0, 0, 5, headerH).fill(C.orange);

  // Logo
  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.orange);
  doc.text('CanalClear', 20, 14);
  doc.font('Helvetica').fontSize(8).fillColor(C.grey);
  doc.text('Maritime Compliance Automation', 20, 33);

  // Page indicator (right)
  doc.font('Helvetica').fontSize(8).fillColor(C.grey);
  doc.text(`Page ${page} of 4`, W - MARGIN - 40, 14, { width: 50, align: 'right' });

  // Divider line in header
  doc.rect(20, 48, W - 40, 0.5).fill(C.orange);

  // Page title
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
  doc.text(title, 20, 54, { width: W - 150 });

  if (subtitle) {
    doc.font('Helvetica').fontSize(8).fillColor(C.grey);
    doc.text(subtitle, 20, 68, { width: W - 40 });
  }
}

function drawFooter(doc) {
  const footerY = H - 36;
  doc.rect(0, footerY, W, 36).fill(C.navyLight);
  doc.rect(0, footerY, W, 1).fill(C.orange);

  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
  doc.text('Automate Bosporus SP-1 filings with CanalClear — shipping Q3 2026', MARGIN, footerY + 8, { continued: true });
  doc.font('Helvetica').fillColor(C.grey);
  doc.text('  ·  canalclear.org/bosporus');

  doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
  doc.text(
    'Requirements current as of May 2026. Always verify against Turkish Maritime Administration (UDHB) latest directives.',
    MARGIN, footerY + 22, { width: W - MARGIN * 2 }
  );
}

function sectionTitle(doc, text, y) {
  doc.rect(MARGIN, y, 4, 14).fill(C.orange);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.orange);
  doc.text(text, MARGIN + 10, y + 1);
  return y + 20;
}

// ── Page 1: Cover + What is SP-1 + Timeline ───────────────────────────────────

function drawPage1(doc) {
  drawHeader(doc, 'Bosporus Strait SP-1 Filing: What You Need to Know', 'The essential primer for fleet operators, ship agents & charterers', 1);

  let y = 90;

  // ── Hero banner ────────────────────────────────────────────────────────────
  doc.rect(MARGIN, y, COL_W, 56).fill(C.navyMid);
  doc.rect(MARGIN, y, 4, 56).fill(C.orange);

  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white);
  doc.text('Bosporus Strait SP-1 Filing', MARGIN + 14, y + 8, { width: COL_W - 100 });

  doc.font('Helvetica').fontSize(8.5).fillColor(C.greyLight);
  doc.text(
    'The Turkish Straits Vessel Traffic Service (VTMIS) requires every commercial vessel to file an SP-1 declaration before transiting the Bosporus. Late, incomplete, or incorrect filings trigger queue delays, authority holds, and costly anchorage fees.',
    MARGIN + 14, y + 26, { width: COL_W - 20 }
  );

  y += 66;

  // ── What is SP-1? ──────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'WHAT IS SP-1?', y);

  doc.font('Helvetica').fontSize(8.5).fillColor(C.text);
  doc.text(
    'SP-1 is the mandatory pre-arrival notification form for all commercial vessels entering or transiting the Bosporus Strait. It is submitted electronically through the Turkish VTMIS (Vessel Traffic Management Information System) operated by the Turkish Maritime Administration (UDHB — Ulaştırma ve Altyapı Bakanlığı).',
    MARGIN, y, { width: COL_W }
  );
  y += 40;

  doc.text(
    'The SP-1 form consolidates vessel particulars, cargo declaration, crew list reference, P&I insurance proof, pilotage requirements, and passage intent. Turkish authorities cross-reference SP-1 data against international databases (Lloyd\'s, IMO GISIS) before granting transit clearance.',
    MARGIN, y, { width: COL_W }
  );
  y += 40;

  // ── When is it required? ───────────────────────────────────────────────────
  y = sectionTitle(doc, 'WHEN IS SP-1 REQUIRED?', y + 4);

  const whenItems = [
    ['All vessels ≥300 GT', 'Required for every southbound or northbound Bosporus transit, including vessels in ballast.'],
    ['Hazardous cargo vessels', 'Additional DG pre-notification required ≥4 hours before entry into the TSS (Traffic Separation Scheme).'],
    ['Vessels ≥150m LOA', 'Must request daylight transit — no night passage permitted. File SP-1 accordingly.'],
    ['LNG / Chemical tankers', 'Subject to additional Turkish Coast Guard escort pre-notification. SP-1 filing window is T-48h.'],
  ];

  whenItems.forEach(([label, desc]) => {
    doc.rect(MARGIN, y, COL_W, 22).fill(C.navyMid);
    doc.rect(MARGIN, y, 4, 22).fill(C.orangeLight);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orangeLight);
    doc.text(label, MARGIN + 10, y + 4, { width: 160 });
    doc.font('Helvetica').fontSize(7.5).fillColor(C.greyLight);
    doc.text(desc, MARGIN + 175, y + 4, { width: COL_W - 185 });
    y += 26;
  });

  y += 6;

  // ── Turkish Administration Overview ───────────────────────────────────────
  y = sectionTitle(doc, 'TURKISH MARITIME ADMINISTRATION (UDHB)', y);

  // Two-column info cards
  const halfW = (COL_W - 8) / 2;

  const infoCards = [
    { label: 'Authority', value: 'UDHB (Ministry of Transport & Infrastructure)', sub: 'Responsible body for SP-1 processing' },
    { label: 'VTMIS System', value: 'Turkish Straits VTS — Istanbul VTS', sub: 'VHF Channel 12 (working) / 16 (distress)' },
    { label: 'Filing Method', value: 'Electronic via licensed ship agent', sub: 'Direct submission requires VTMIS portal account' },
    { label: 'Language', value: 'Turkish and/or English accepted', sub: 'All documents must be in one of these languages' },
  ];

  infoCards.forEach((card, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = MARGIN + col * (halfW + 8);
    const cy = y + row * 36;
    doc.rect(x, cy, halfW, 32).fill(C.navyMid);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(C.grey);
    doc.text(card.label.toUpperCase(), x + 8, cy + 5);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.white);
    doc.text(card.value, x + 8, cy + 14, { width: halfW - 16 });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
    doc.text(card.sub, x + 8, cy + 24, { width: halfW - 16 });
  });

  drawFooter(doc);
}

// ── Page 2: Deadlines + Required Documents ────────────────────────────────────

function drawPage2(doc) {
  drawHeader(doc, 'Filing Deadlines & Required Documents', 'Bosporus SP-1 Primer — Part 2', 2);

  let y = 90;

  // ── Filing Timeline ────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'FILING TIMELINE (hours before Bosporus entry)', y);

  DEADLINES.forEach((d) => {
    const cardH = 24;
    doc.rect(MARGIN, y, COL_W, cardH).fill(C.navyMid);

    // Time badge
    const badgeColor = d.critical ? C.orange : C.navyLight;
    const badgeW = 56;
    doc.rect(MARGIN, y, badgeW, cardH).fill(badgeColor);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.white);
    doc.text(`T-${d.time}`, MARGIN + 4, y + 7, { width: badgeW - 8, align: 'center' });

    // Event description
    doc.font('Helvetica').fontSize(8).fillColor(d.critical ? C.text : C.greyLight);
    doc.text(d.event, MARGIN + badgeW + 8, y + 8, { width: COL_W - badgeW - 16 });

    y += cardH + 3;
  });

  // Legend
  y += 4;
  doc.rect(MARGIN, y, 10, 10).fill(C.orange);
  doc.font('Helvetica').fontSize(7).fillColor(C.grey);
  doc.text('Critical (non-negotiable deadline)', MARGIN + 14, y + 1);
  doc.rect(MARGIN + 170, y, 10, 10).fill(C.navyLight);
  doc.text('Recommended (avoid last-minute rushes)', MARGIN + 184, y + 1);
  y += 20;

  // ── Required Documents ─────────────────────────────────────────────────────
  y = sectionTitle(doc, 'REQUIRED DOCUMENTS CHECKLIST', y + 4);

  REQUIRED_DOCUMENTS.forEach((doc_item, i) => {
    const rowH = 30;
    const rowBg = i % 2 === 0 ? C.navyMid : C.navy;
    doc.rect(MARGIN, y, COL_W, rowH).fill(rowBg);

    // Checkbox circle
    doc.circle(MARGIN + 12, y + 15, 7).fill(C.navyLight).stroke(C.orange);
    doc.rect(MARGIN + 8, y + 13, 8, 4).fill(C.navyLight); // clear bottom half for open look

    // Document name
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.orange);
    doc.text(doc_item.name, MARGIN + 26, y + 5, { width: 160 });

    // Description
    doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
    doc.text(doc_item.desc, MARGIN + 26, y + 16, { width: COL_W - 36 });

    y += rowH + 2;
  });

  drawFooter(doc);
}

// ── Page 3: SP-1 Data Fields + Common Mistakes ────────────────────────────────

function drawPage3(doc) {
  drawHeader(doc, 'SP-1 Data Fields & Common Rejection Mistakes', 'Bosporus SP-1 Primer — Part 3', 3);

  let y = 90;

  // ── Data Fields Grid ───────────────────────────────────────────────────────
  y = sectionTitle(doc, 'SP-1 FORM DATA FIELDS (all required unless marked optional)', y);

  const cellW = (COL_W - 3 * 6) / 4;
  const cellH = 20;

  SP1_DATA_FIELDS.forEach((row, rowIdx) => {
    row.forEach((field, colIdx) => {
      const cx = MARGIN + colIdx * (cellW + 6);
      const cy = y + rowIdx * (cellH + 3);
      doc.rect(cx, cy, cellW, cellH).fill(C.navyMid);
      doc.rect(cx, cy, cellW, 3).fill(rowIdx % 2 === 0 ? C.orange : C.orangeLight);
      doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
      doc.text(field, cx + 5, cy + 8, { width: cellW - 10 });
    });
  });

  y += SP1_DATA_FIELDS.length * (cellH + 3) + 10;

  // ── Common Mistakes ────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'TOP 6 SP-1 REJECTION TRIGGERS', y);

  // Two columns
  const colW2 = (COL_W - 8) / 2;
  const rows = Math.ceil(COMMON_MISTAKES.length / 2);

  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    for (let colIdx = 0; colIdx < 2; colIdx++) {
      const itemIdx = rowIdx * 2 + colIdx;
      if (itemIdx >= COMMON_MISTAKES.length) continue;
      const m = COMMON_MISTAKES[itemIdx];
      const cx = MARGIN + colIdx * (colW2 + 8);

      // Measure text heights for dynamic card height
      const titleH = 12;
      const detailH = doc.heightOfString(m.detail, { width: colW2 - 36, fontSize: 7 });
      const fixH = doc.heightOfString(m.fix, { width: colW2 - 50, fontSize: 6.5 });
      const cardH = Math.max(58, titleH + detailH + fixH + 22);

      doc.rect(cx, y, colW2, cardH).fill(C.navyMid);
      doc.rect(cx, y, 20, cardH).fill(C.orange);
      doc.rect(cx + 12, y, 8, cardH).fill(C.orange); // square off

      doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
      doc.text(`${m.n}`, cx, y + cardH / 2 - 8, { width: 20, align: 'center' });

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.orangeLight);
      doc.text(m.title, cx + 24, y + 5, { width: colW2 - 30 });

      doc.font('Helvetica').fontSize(7).fillColor(C.greyLight);
      doc.text(m.detail, cx + 24, y + 18, { width: colW2 - 30 });

      const fixLabelY = y + 18 + doc.heightOfString(m.detail, { width: colW2 - 30 }) + 4;
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.orange);
      doc.text('FIX: ', cx + 24, fixLabelY, { continued: true });
      doc.font('Helvetica').fontSize(6.5).fillColor(C.text);
      doc.text(m.fix, { width: colW2 - 50 });

      // Update y after each row
      if (colIdx === 0) {
        // hold off updating y until after both columns are drawn
      }
      if (colIdx === 1 || itemIdx === COMMON_MISTAKES.length - 1) {
        const leftIdx = rowIdx * 2;
        const rightIdx = rowIdx * 2 + 1;
        const leftM = COMMON_MISTAKES[leftIdx];
        const rightM = rightIdx < COMMON_MISTAKES.length ? COMMON_MISTAKES[rightIdx] : null;

        const leftDetail = doc.heightOfString(leftM.detail, { width: colW2 - 36, fontSize: 7 });
        const leftFix = doc.heightOfString(leftM.fix, { width: colW2 - 50, fontSize: 6.5 });
        const leftH = Math.max(58, titleH + leftDetail + leftFix + 22);

        let rightH = 0;
        if (rightM) {
          const rd = doc.heightOfString(rightM.detail, { width: colW2 - 36, fontSize: 7 });
          const rf = doc.heightOfString(rightM.fix, { width: colW2 - 50, fontSize: 6.5 });
          rightH = Math.max(58, titleH + rd + rf + 22);
        }

        y += Math.max(leftH, rightH) + 6;
      }
    }
  }

  drawFooter(doc);
}

// ── Page 4: CanalClear Automation Preview ────────────────────────────────────

function drawPage4(doc) {
  drawHeader(doc, 'How CanalClear Will Automate Bosporus SP-1 Filing', 'Coming Q3 2026 — Join the Waitlist', 4);

  let y = 90;

  // ── Product overview ───────────────────────────────────────────────────────
  doc.rect(MARGIN, y, COL_W, 52).fill(C.navyMid);
  doc.rect(MARGIN, y, 4, 52).fill(C.orange);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white);
  doc.text('Bosporus SP-1 Automation — Shipping Q3 2026', MARGIN + 14, y + 8, { width: COL_W - 20 });

  doc.font('Helvetica').fontSize(8).fillColor(C.greyLight);
  doc.text(
    'CanalClear already automates Panama Canal VUMPA and Suez Canal SCA filings for 50+ fleet operators. The same engine — vessel intelligence, auto-fill, real-time validation — is being extended to Turkish Straits SP-1. Early access waitlist is open now.',
    MARGIN + 14, y + 26, { width: COL_W - 20 }
  );
  y += 62;

  // ── Feature list ──────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'WHAT THE BOSPORUS MODULE WILL DO', y);

  const features = [
    { icon: '→', title: 'Auto-fill SP-1 from IMO number', desc: 'Enter vessel IMO — CanalClear pre-fills all vessel particulars, P&I data, crew count, and dimension fields from our maritime database.' },
    { icon: '→', title: 'Real-time validation engine', desc: 'Draft limit checks (17.45m laden / 15.00m NB), LOA flag for oversized permission, P&I expiry warning, cargo classification, crew manifest completeness.' },
    { icon: '→', title: 'T-24h filing reminder', desc: 'Automated deadline alerts pushed to your ops team via email and dashboard. Never miss a Bosporus filing window again.' },
    { icon: '→', title: 'Agent submission workflow', desc: 'SP-1 submitted to Turkish VTMIS via CanalClear\'s licensed ship agent network. Your team approves; we file. Confirmation within 2 hours.' },
    { icon: '→', title: 'Multi-canal filing from one dashboard', desc: 'If your fleet transits Panama, Suez, and Bosporus — manage all filings in one place. One vessel record, three canals.' },
    { icon: '→', title: 'Audit-ready filing history', desc: 'Every SP-1 submission timestamped, versioned, and downloadable. Port state control inspection ready in two clicks.' },
  ];

  features.forEach((f, i) => {
    const fH = 38;
    const bg = i % 2 === 0 ? C.navyMid : C.navy;
    doc.rect(MARGIN, y, COL_W, fH).fill(bg);
    doc.rect(MARGIN, y, 3, fH).fill(C.orange);

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.orange);
    doc.text(f.title, MARGIN + 10, y + 6, { width: COL_W - 16 });

    doc.font('Helvetica').fontSize(7.5).fillColor(C.greyLight);
    doc.text(f.desc, MARGIN + 10, y + 19, { width: COL_W - 16 });

    y += fH + 2;
  });

  y += 10;

  // ── CTA ───────────────────────────────────────────────────────────────────
  y = sectionTitle(doc, 'JOIN THE BOSPORUS WAITLIST', y);

  // Big CTA card
  const ctaH = 78;
  doc.rect(MARGIN, y, COL_W, ctaH).fill(C.orange);
  doc.rect(MARGIN, y, COL_W, 4).fill(C.orangeLight);

  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white);
  doc.text('Get early access when Bosporus SP-1 launches', MARGIN + 16, y + 10, { width: COL_W - 32 });

  doc.font('Helvetica').fontSize(9).fillColor(C.white);
  doc.text(
    'Join 300+ maritime professionals already using CanalClear for Panama and Suez filings. Bosporus waitlist members get priority access, onboarding support, and locked-in pre-launch pricing.',
    MARGIN + 16, y + 30, { width: COL_W - 32 }
  );

  doc.font('Helvetica-Bold').fontSize(10).fillColor(C.white);
  doc.text('canalclear.org/bosporus', MARGIN + 16, y + 58, { width: COL_W - 32 });

  // Comparison row
  y += ctaH + 12;
  const statsData = [
    { label: 'Avg SP-1 filing time (manual)', value: '2.5 hrs', highlight: false },
    { label: 'With CanalClear (target)', value: '8 min', highlight: true },
    { label: 'Rejection rate (industry avg)', value: '18%', highlight: false },
    { label: 'CanalClear VUMPA rejection rate', value: '<1%', highlight: true },
  ];

  const statW = (COL_W - 3 * 6) / 4;
  statsData.forEach((s, i) => {
    const sx = MARGIN + i * (statW + 6);
    doc.rect(sx, y, statW, 40).fill(s.highlight ? C.navyLight : C.navyMid);
    if (s.highlight) doc.rect(sx, y, statW, 2).fill(C.orange);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(s.highlight ? C.orange : C.grey);
    doc.text(s.value, sx + 4, y + 8, { width: statW - 8, align: 'center' });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.grey);
    doc.text(s.label, sx + 4, y + 28, { width: statW - 8, align: 'center' });
  });

  drawFooter(doc);
}

// ── Main PDF Generator ────────────────────────────────────────────────────────

function generateBosporusSP1PrimerPDF() {
  return new Promise((resolve, reject) => {
    const buffers = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      info: {
        Title:    'Bosporus Strait SP-1 Filing: What You Need to Know',
        Author:   'CanalClear',
        Subject:  'Turkish Straits Bosporus SP-1 Pre-Arrival Filing Primer',
        Creator:  'CanalClear (canalclear.org)',
        Producer: 'CanalClear PDF Generator',
        Keywords: 'Bosporus, SP-1, Turkish Maritime Administration, UDHB, VTMIS, transit filing, ship agent',
      },
    });

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Page 1
    doc.addPage({ size: 'A4', margin: 0 });
    drawPage1(doc);

    // Page 2
    doc.addPage({ size: 'A4', margin: 0 });
    drawPage2(doc);

    // Page 3
    doc.addPage({ size: 'A4', margin: 0 });
    drawPage3(doc);

    // Page 4
    doc.addPage({ size: 'A4', margin: 0 });
    drawPage4(doc);

    doc.end();
  });
}

// ── Ensure PDF Exists in DB / R2 ─────────────────────────────────────────────

async function ensureBosporusSP1PrimerPDF(pool) {
  const ASSET_KEY = 'bosporus-sp1-primer-pdf';

  // Ensure table exists
  await ensureSiteAssetsTable(pool);

  // Check if already uploaded
  const existing = await checkAssetExists(pool, ASSET_KEY);
  if (existing && existing.data) {
    const url = existing.data;
    console.log(`[Bosporus SP-1 Primer] Already hosted at: ${url}`);
    return url;
  }

  console.log('[Bosporus SP-1 Primer] Generating PDF…');
  const pdfBuffer = await generateBosporusSP1PrimerPDF();
  console.log(`[Bosporus SP-1 Primer] PDF generated (${pdfBuffer.length} bytes)`);

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
        console.log(`[Bosporus SP-1 Primer] R2 upload OK: ${pdfUrl}`);
      } else {
        console.log(`[Bosporus SP-1 Primer] R2 upload failed: ${uploadData.error?.message || JSON.stringify(uploadData)}`);
      }
    } catch (e) {
      console.log(`[Bosporus SP-1 Primer] R2 upload error: ${e.message}`);
    }
  }

  if (!pdfUrl) {
    // Fallback: store base64 in site_assets and serve internally
    pdfUrl = null;
    console.log('[Bosporus SP-1 Primer] R2 unavailable — falling back to DB base64 storage');
    await upsertAsset(pool, ASSET_KEY, pdfBuffer.toString('base64'), 'application/pdf');
    console.log(`[Bosporus SP-1 Primer] Stored in DB (${pdfBuffer.length} bytes) — served at /assets/bosporus-sp1-primer.pdf`);
    return '/assets/bosporus-sp1-primer.pdf';
  }

  // Store R2 URL
  await upsertAsset(pool, ASSET_KEY, pdfUrl, 'text/plain');

  return pdfUrl;
}

module.exports = { ensureBosporusSP1PrimerPDF, generateBosporusSP1PrimerPDF };
