/**
 * Suez Canal PDF Generator
 *
 * Generates SCA-compliant filing documents for all seven Suez Canal document types.
 * Uses PDFKit for PDF generation. Called by GET /api/filings/:id/pdf?type=[type]
 *
 * Supported document types:
 *   sca_transit_application  — SCA pre-arrival transit application
 *   suez_crew_manifest       — Crew manifest (SCA format)
 *   suez_cargo_declaration   — Cargo declaration (IMDG 42-24)
 *   suez_isps_declaration    — ISPS security declaration
 *   suez_sopep               — SOPEP summary
 *   suez_ballast_water       — Ballast Water Management declaration
 *   suez_tonnage_certificate — Tonnage Certificate summary (SCNT)
 *   all                      — Combined package (all docs in one PDF)
 */

'use strict';

const PDFDocument = require('pdfkit');

// ── Brand constants ──────────────────────────────────────────────────────────

const BRAND = {
  name:    'CanalClear',
  tagline: 'Canal Compliance Automation',
  url:     'canalclear.org',
  email:   'compliance@canalclear.org',
};

// ── Color palette ────────────────────────────────────────────────────────────
// hex → PDFKit rgb helper
function hex(h) {
  const r = parseInt(h.slice(1,3),16)/255;
  const g = parseInt(h.slice(3,5),16)/255;
  const b = parseInt(h.slice(5,7),16)/255;
  return [r, g, b];
}

const C = {
  navy:    '#0A1628',
  teal:    '#00C49A',
  slate:   '#2D3748',
  muted:   '#718096',
  border:  '#CBD5E0',
  light:   '#F7FAFC',
  white:   '#FFFFFF',
  pass:    '#276749',
  fail:    '#9B2C2C',
  warn:    '#744210',
  passBg:  '#C6F6D5',
  failBg:  '#FED7D7',
  warnBg:  '#FEFCBF',
};

// ── Document metadata ────────────────────────────────────────────────────────

const DOC_META = {
  sca_transit_application:  { title: 'SCA TRANSIT APPLICATION',             subtitle: 'Suez Canal Pre-Arrival Notification Form',            form: 'SCA/TA-01/2024' },
  suez_crew_manifest:       { title: 'CREW MANIFEST',                        subtitle: 'Suez Canal Authority — Crew List',                    form: 'SCA/CM-02/2024' },
  suez_cargo_declaration:   { title: 'CARGO DECLARATION',                    subtitle: 'IMDG Amendment 42-24 Compliant Declaration',           form: 'SCA/CD-03/2024' },
  suez_dangerous_goods:     { title: 'DANGEROUS GOODS DECLARATION',          subtitle: 'IMDG Amendment 42-24 — Class/UN/Stowage Declaration',  form: 'SCA/DG-08/2024' },
  suez_isps_declaration:    { title: 'ISPS SECURITY DECLARATION',            subtitle: 'International Ship & Port Facility Security Code',     form: 'SCA/SD-04/2024' },
  suez_sopep:               { title: 'SOPEP SUMMARY',                        subtitle: 'Suez Oil Pollution Emergency Plan Declaration',        form: 'SCA/SP-05/2024' },
  suez_ballast_water:       { title: 'BALLAST WATER MANAGEMENT DECLARATION', subtitle: 'BWM Convention D-1 / D-2 Compliance Statement',       form: 'SCA/BW-06/2024' },
  suez_tonnage_certificate: { title: 'TONNAGE CERTIFICATE SUMMARY',          subtitle: 'Suez Canal Net Tonnage (SCNT) Declaration',            form: 'SCA/TC-07/2024' },
  suez_scnt_tonnage:        { title: 'SCNT TONNAGE CALCULATION',             subtitle: 'Suez Canal Net Tonnage — Toll Estimation & Certificate', form: 'SCA/TC-09/2024' },
  suez_pilotage:            { title: 'PILOTAGE ARRANGEMENTS',                subtitle: 'SCA Compulsory Pilotage — Boarding & Maneuverability',  form: 'SCA/PA-10/2024' },
};

// ALL_DOC_TYPES: all valid single-document types (used for validation + 'all' combined package)
// The canonical 7 SCA documents plus the 3 dedicated form types added in batch 2.
const ALL_DOC_TYPES = Object.keys(DOC_META);

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer for a filing.
 *
 * @param {object} filing       Row from filings table (with Suez columns)
 * @param {string} docType      Document type key, or 'all' for combined package
 * @param {object} [extras]     Additional data: { ispsNotifications, submission }
 * @returns {Promise<Buffer>}
 */
async function generateSuezPDF(filing, docType, extras = {}) {
  const doc = new PDFDocument({
    size:    'A4',
    margin:  0,
    info: {
      Title:    `${BRAND.name} — ${docType === 'all' ? 'Complete SCA Filing Package' : (DOC_META[docType]?.title || docType)}`,
      Author:   BRAND.name,
      Subject:  `Suez Canal Filing — ${filing.vessel_name || 'Unknown Vessel'} — ${filing.reference_number || filing.id}`,
      Creator:  `${BRAND.name} Compliance Platform`,
      Producer: `${BRAND.name} (${BRAND.url})`,
    },
  });

  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  const docData = typeof filing.document_data === 'string'
    ? JSON.parse(filing.document_data || '{}')
    : (filing.document_data || {});

  if (docType === 'all') {
    // Combined filing package — one PDF with all documents
    for (let i = 0; i < ALL_DOC_TYPES.length; i++) {
      const dt = ALL_DOC_TYPES[i];
      if (i > 0) doc.addPage();
      renderDocument(doc, dt, filing, docData, extras);
    }
  } else {
    renderDocument(doc, docType, filing, docData, extras);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ── Document renderer dispatcher ─────────────────────────────────────────────

function renderDocument(doc, docType, filing, docData, extras) {
  const meta = DOC_META[docType] || { title: docType.toUpperCase(), subtitle: '', form: '' };
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 40;

  // Header band
  renderPageHeader(doc, meta, filing, pageW, margin);

  // Content area
  const contentY = 160;
  doc.y = contentY;

  switch (docType) {
    case 'sca_transit_application':
      renderTransitApplication(doc, filing, docData, extras, margin, pageW);
      break;
    case 'suez_crew_manifest':
      renderCrewManifest(doc, filing, docData, margin, pageW);
      break;
    case 'suez_cargo_declaration':
      renderCargoDeclaration(doc, filing, docData, margin, pageW);
      break;
    case 'suez_isps_declaration':
      renderIspsDeclaration(doc, filing, docData, extras, margin, pageW);
      break;
    case 'suez_sopep':
      renderSopep(doc, filing, docData, margin, pageW);
      break;
    case 'suez_ballast_water':
      renderBallastWater(doc, filing, docData, margin, pageW);
      break;
    case 'suez_tonnage_certificate':
      renderTonnageCertificate(doc, filing, docData, margin, pageW);
      break;
    case 'suez_dangerous_goods':
      renderDangerousGoodsDeclaration(doc, filing, docData, margin, pageW);
      break;
    case 'suez_scnt_tonnage':
      renderScntTonnageCalculation(doc, filing, docData, margin, pageW);
      break;
    case 'suez_pilotage':
      renderPilotageArrangements(doc, filing, docData, margin, pageW);
      break;
    default:
      doc.fontSize(12).fillColor(...hex(C.muted))
        .text(`Document type "${docType}" not recognised.`, margin, doc.y);
  }

  // Footer
  renderPageFooter(doc, filing, pageW, pageH, margin);
}

// ── Page header ──────────────────────────────────────────────────────────────

function renderPageHeader(doc, meta, filing, pageW, margin) {
  // Navy header band
  doc.rect(0, 0, pageW, 130).fill(...hex(C.navy));

  // CanalClear brand strip (left)
  doc.fontSize(18).font('Helvetica-Bold')
    .fillColor(...hex(C.teal))
    .text(BRAND.name, margin, 18, { lineBreak: false });

  doc.fontSize(8).font('Helvetica')
    .fillColor(...hex(C.muted))
    .text(BRAND.tagline.toUpperCase(), margin, 38, { lineBreak: false });

  // Teal divider line between brand and doc title
  doc.moveTo(margin, 52).lineTo(pageW - margin, 52)
    .strokeColor(...hex(C.teal)).lineWidth(0.5).stroke();

  // Document title (centered)
  doc.fontSize(14).font('Helvetica-Bold')
    .fillColor(...hex(C.white))
    .text(meta.title, margin, 60, { width: pageW - margin*2, align: 'center', lineBreak: false });

  doc.fontSize(8).font('Helvetica')
    .fillColor(...hex(C.border))
    .text(meta.subtitle, margin, 78, { width: pageW - margin*2, align: 'center', lineBreak: false });

  // Reference pill (right-aligned, two lines)
  const refX = pageW - margin - 200;
  doc.fontSize(7).font('Helvetica')
    .fillColor(...hex(C.muted))
    .text('FORM', refX, 18, { width: 200, align: 'right', lineBreak: false });
  doc.fontSize(7).font('Helvetica-Bold')
    .fillColor(...hex(C.border))
    .text(meta.form, refX, 26, { width: 200, align: 'right', lineBreak: false });

  // Filing info bar (below navy band)
  doc.rect(0, 130, pageW, 30).fill(...hex(C.light));
  doc.moveTo(0, 130).lineTo(pageW, 130).strokeColor(...hex(C.teal)).lineWidth(2).stroke();

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const refNum = filing.reference_number || `CC-SCA-${String(filing.id).padStart(6,'0')}`;

  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate));
  const bY = 139;
  doc.text(`FILING REF: ${refNum}`, margin, bY, { lineBreak: false });
  doc.text(`VESSEL: ${(filing.vessel_name || '—').toUpperCase()}`, margin + 170, bY, { lineBreak: false });
  doc.text(`IMO: ${filing.imo_number || '—'}`, margin + 380, bY, { lineBreak: false });
  doc.text(`GENERATED: ${ts}`, margin + 470, bY, { lineBreak: false });
}

// ── Page footer ──────────────────────────────────────────────────────────────

function renderPageFooter(doc, filing, pageW, pageH, margin) {
  const footerY = pageH - 40;
  doc.moveTo(margin, footerY).lineTo(pageW - margin, footerY)
    .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();

  doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
  doc.text(`Generated by ${BRAND.name} · ${BRAND.url}`, margin, footerY + 8, { lineBreak: false });
  doc.text('CONFIDENTIAL — FOR REGULATORY SUBMISSION ONLY', margin + 180, footerY + 8, { lineBreak: false, align: 'center', width: pageW - margin*2 - 180 });
  doc.text(`Page 1`, pageW - margin - 40, footerY + 8, { lineBreak: false });
}

// ── Shared rendering helpers ──────────────────────────────────────────────────

/**
 * Draw a section header bar.
 */
function sectionHeader(doc, title, y, pageW, margin) {
  doc.rect(margin, y, pageW - margin*2, 18).fill(...hex(C.navy));
  doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.teal))
    .text(title, margin + 6, y + 5, { lineBreak: false });
  return y + 22;
}

/**
 * Draw a field row: label | value, alternating background.
 */
function fieldRow(doc, label, value, x, y, w, rowHeight, isEven) {
  const bgColor = isEven ? C.light : C.white;
  doc.rect(x, y, w, rowHeight).fill(...hex(bgColor));
  doc.moveTo(x, y).lineTo(x+w, y).strokeColor(...hex(C.border)).lineWidth(0.3).stroke();

  const labelW = 180;
  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(...hex(C.slate))
    .text(label, x + 6, y + 4, { width: labelW - 10, lineBreak: false });

  const displayVal = (value === null || value === undefined || value === '') ? '—' : String(value);
  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.navy))
    .text(displayVal, x + labelW + 4, y + 4, { width: w - labelW - 10, lineBreak: false });

  return y + rowHeight;
}

/**
 * Draw a two-column field grid (label left, value right) for a field list.
 * Returns the Y position after the last row.
 */
function fieldGrid(doc, fields, startY, margin, pageW) {
  const rowH = 18;
  const colW = (pageW - margin*2) / 2;
  let y = startY;
  let col = 0;

  for (let i = 0; i < fields.length; i++) {
    const [label, value] = fields[i];
    const x = margin + col * colW;
    fieldRow(doc, label, value, x, y, colW, rowH, i % 2 === 0);
    col++;
    if (col >= 2) {
      col = 0;
      y += rowH;
    }
  }
  if (col > 0) y += rowH; // complete last row
  return y + 2;
}

/**
 * Draw validation status badge.
 */
function validationBadge(doc, status, x, y) {
  const isPass = status === 'pass' || status === 'passed' || status === true;
  const isWarn = status === 'warning' || status === 'warn';
  const bg  = isPass ? C.passBg  : isWarn ? C.warnBg  : C.failBg;
  const fg  = isPass ? C.pass    : isWarn ? C.warn     : C.fail;
  const txt = isPass ? '✓ PASS'  : isWarn ? '⚠ WARN'   : '✗ FAIL';

  doc.roundedRect(x, y, 48, 12, 3).fill(...hex(bg));
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(...hex(fg))
    .text(txt, x + 4, y + 3, { lineBreak: false });
}

/**
 * Draw a full-width "note" box.
 */
function noteBox(doc, text, y, margin, pageW, color = C.warnBg) {
  const w = pageW - margin*2;
  doc.rect(margin, y, w, 20).fill(...hex(color));
  doc.moveTo(margin, y).lineTo(margin, y+20).strokeColor(...hex(C.warn)).lineWidth(2).stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
    .text(text, margin + 8, y + 6, { width: w - 12, lineBreak: false });
  return y + 24;
}

/**
 * Vessel details section — common to all documents.
 */
function renderVesselSection(doc, filing, startY, margin, pageW) {
  let y = sectionHeader(doc, 'VESSEL PARTICULARS', startY, pageW, margin);

  const vesselFields = [
    ['Vessel Name',             filing.vessel_name || '—'],
    ['IMO Number',              filing.imo_number  || '—'],
    ['Flag State',              filing.flag_state  || '—'],
    ['Vessel Type',             (filing.vessel_type || '—').replace(/_/g,' ').toUpperCase()],
    ['Classification Society',  filing.classification_society || '—'],
    ['Length Overall (m)',      filing.loa     ?? '—'],
    ['Beam (m)',                filing.beam    ?? '—'],
    ['Gross Tonnage (GT)',      filing.gross_tonnage ?? '—'],
    ['SCNT',                    filing.scnt    ?? '—'],
    ['Draft (m)',               filing.draft   ?? '—'],
    ['Draft Forward (m)',       filing.draft_forward ?? '—'],
    ['Draft Aft (m)',           filing.draft_aft ?? '—'],
    ['Air Draft (m)',           filing.air_draft ?? '—'],
    ['Canal',                   (filing.canal || 'suez').toUpperCase()],
  ];

  return fieldGrid(doc, vesselFields, y, margin, pageW);
}

// ── Document type renderers ───────────────────────────────────────────────────

/**
 * SCA TRANSIT APPLICATION
 */
function renderTransitApplication(doc, filing, docData, extras, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  // Transit details
  y = sectionHeader(doc, 'TRANSIT DETAILS', y, pageW, margin);
  const sub = extras.submission || {};
  const transitFields = [
    ['Transit Direction',         sub.transit_direction || docData.transit_direction || '—'],
    ['Convoy Preference',         docData.convoy_preference || '—'],
    ['Convoy Number (SCA)',       sub.convoy_number || '—'],
    ['ETA Port Said / Suez',      docData.eta || '—'],
    ['Agent at Port Said',        docData.agent_port_said || '—'],
    ['Agent at Suez',             docData.agent_suez || '—'],
    ['Last Port of Call',         docData.last_port || '—'],
    ['Next Port of Call',         docData.next_port || '—'],
    ['Voyage Number',             docData.voyage_number || '—'],
    ['SCA Reference No.',         sub.sca_reference || '—'],
  ];
  y = fieldGrid(doc, transitFields, y, margin, pageW);
  y += 6;

  // SCNT fee estimate
  y = sectionHeader(doc, 'SCNT FEE ESTIMATE (PLACEHOLDER)', y, pageW, margin);
  const scnt = parseFloat(filing.scnt) || 0;
  const vesselType = (filing.vessel_type || 'other').toLowerCase();
  const feeEstimate = estimateScntFee(scnt, vesselType);

  const feeFields = [
    ['SCNT (Suez Canal Net Tonnage)', scnt > 0 ? scnt.toLocaleString() : 'Not provided'],
    ['Vessel Category',               vesselType.replace(/_/g,' ')],
    ['Base Rate (SDR/SCNT)',          feeEstimate.baseRate.toFixed(4)],
    ['Estimated Fee (SDR)',           scnt > 0 ? feeEstimate.feeSdr.toLocaleString(undefined,{minimumFractionDigits:2}) : 'N/A'],
    ['Estimated Fee (USD approx.)',   scnt > 0 ? feeEstimate.feeUsd : 'N/A'],
    ['Rebate Program',                feeEstimate.rebateProgram],
    ['Tariff Version',                '2024 SCA Tariff Schedule'],
  ];
  y = fieldGrid(doc, feeFields, y, margin, pageW);
  y = noteBox(doc, 'Fee estimate is indicative only. Actual SCA toll calculated by SCA on day of transit based on published tariff schedule.', y, margin, pageW);
  y += 6;

  // Validation status
  const validationStatus = docData.validation_status || docData.status;
  if (validationStatus) {
    y = sectionHeader(doc, 'COMPLIANCE VALIDATION', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 30).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text('Document Validation Status:', margin + 8, y + 10, { lineBreak: false });
    validationBadge(doc, validationStatus, margin + 200, y + 9);
    y += 34;
  }

  // Signature block
  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * CREW MANIFEST
 */
function renderCrewManifest(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'CREW MANIFEST DETAILS', y, pageW, margin);
  const crewFields = [
    ['Total Crew',              docData.total_crew || docData.crew_count || '—'],
    ['Master Name',             docData.master_name || '—'],
    ['Master Nationality',      docData.master_nationality || '—'],
    ['Master Certificate No.',  docData.master_certificate || '—'],
    ['Chief Officer',           docData.chief_officer || '—'],
    ['Chief Engineer',          docData.chief_engineer || '—'],
    ['Date of Departure',       docData.departure_date || '—'],
    ['Port of Departure',       docData.port_departure || '—'],
  ];
  y = fieldGrid(doc, crewFields, y, margin, pageW);
  y += 6;

  // Crew table
  const crew = Array.isArray(docData.crew_members) ? docData.crew_members : [];
  if (crew.length > 0) {
    y = sectionHeader(doc, `CREW MEMBERS (${crew.length})`, y, pageW, margin);
    y = renderCrewTable(doc, crew, y, margin, pageW);
    y += 6;
  } else {
    y = noteBox(doc, 'Crew member details not yet entered. Add crew via the Suez filing form.', y, margin, pageW, C.light);
    y += 4;
  }

  // Yellow fever note
  y = noteBox(doc, 'SCA REQUIREMENT: Crew from yellow fever endemic countries must hold valid yellow fever vaccination certificates. Verify before submission.', y, margin, pageW, C.warnBg);

  const valStatus = docData.validation_status || docData.status;
  if (valStatus) {
    y = sectionHeader(doc, 'COMPLIANCE VALIDATION', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 30).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text('Document Validation Status:', margin + 8, y + 10, { lineBreak: false });
    validationBadge(doc, valStatus, margin + 200, y + 9);
    y += 34;
  }

  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * Simple crew table
 */
function renderCrewTable(doc, crew, startY, margin, pageW) {
  const cols = ['#', 'Name', 'Nationality', 'Rank/Position', 'Passport No.', 'STCW Cert', 'DOB'];
  const colWidths = [20, 120, 80, 90, 80, 60, 55];
  const rowH = 14;
  const w = pageW - margin*2;
  let y = startY;

  // Header row
  doc.rect(margin, y, w, rowH).fill(...hex(C.navy));
  let cx = margin;
  cols.forEach((col, i) => {
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(...hex(C.teal))
      .text(col, cx + 3, y + 4, { width: colWidths[i] - 4, lineBreak: false });
    cx += colWidths[i];
  });
  y += rowH;

  // Data rows (cap at 30 to avoid overflow)
  crew.slice(0, 30).forEach((member, idx) => {
    const bg = idx % 2 === 0 ? C.white : C.light;
    doc.rect(margin, y, w, rowH).fill(...hex(bg));
    doc.moveTo(margin, y).lineTo(margin+w, y).strokeColor(...hex(C.border)).lineWidth(0.2).stroke();

    const cells = [
      String(idx + 1),
      member.name || member.full_name || '—',
      member.nationality || '—',
      member.rank || member.position || '—',
      member.passport_number || member.passport || '—',
      member.stcw_cert || member.stcw || '—',
      member.dob || member.date_of_birth || '—',
    ];
    cx = margin;
    cells.forEach((cell, ci) => {
      doc.fontSize(6.5).font('Helvetica').fillColor(...hex(C.navy))
        .text(String(cell).slice(0, 20), cx + 3, y + 4, { width: colWidths[ci] - 4, lineBreak: false });
      cx += colWidths[ci];
    });
    y += rowH;
  });

  if (crew.length > 30) {
    y = noteBox(doc, `Note: ${crew.length - 30} additional crew members not shown. Full crew list available in the digital filing record.`, y, margin, pageW, C.light);
  }

  return y;
}

/**
 * CARGO DECLARATION
 */
function renderCargoDeclaration(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'CARGO SUMMARY', y, pageW, margin);
  const cargoFields = [
    ['Cargo Type',              docData.cargo_type || (filing.document_data && filing.document_data.cargo_type) || '—'],
    ['Total Cargo (MT)',        docData.total_cargo_mt || '—'],
    ['Bill of Lading Nos.',     docData.bill_of_lading || '—'],
    ['Shipper',                 docData.shipper || '—'],
    ['Consignee',               docData.consignee || '—'],
    ['Port of Loading',         docData.port_of_loading || '—'],
    ['Port of Discharge',       docData.port_of_discharge || '—'],
    ['Stowage Plan Attached',   docData.stowage_plan ? 'YES' : 'NO'],
  ];
  y = fieldGrid(doc, cargoFields, y, margin, pageW);
  y += 6;

  // Dangerous goods
  const dg = Array.isArray(docData.dangerous_goods) ? docData.dangerous_goods : [];
  if (dg.length > 0) {
    y = sectionHeader(doc, `DANGEROUS GOODS DECLARATION — IMDG AMENDMENT 42-24 (${dg.length} item${dg.length===1?'':'s'})`, y, pageW, margin);
    y = renderDGTable(doc, dg, y, margin, pageW);
    y += 4;
    y = noteBox(doc, 'IMDG Amendment 42-24: Lithium batteries (UN3480/3481/3090/3091) require Class 9 declaration. SCA Class 1 & 7 cargo requires prior approval 72h before transit.', y, margin, pageW, C.warnBg);
  } else {
    y = sectionHeader(doc, 'DANGEROUS GOODS', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 20).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica').fillColor(...hex(C.muted))
      .text('No dangerous goods declared.', margin + 8, y + 6, { lineBreak: false });
    y += 24;
  }

  y += 4;
  const valStatus = docData.validation_status || docData.status;
  if (valStatus) {
    y = sectionHeader(doc, 'COMPLIANCE VALIDATION', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 30).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text('IMDG Validation Status:', margin + 8, y + 10, { lineBreak: false });
    validationBadge(doc, valStatus, margin + 180, y + 9);
    y += 34;
  }

  y = renderSignatureBlock(doc, y, margin, pageW);
}

function renderDGTable(doc, dg, startY, margin, pageW) {
  const cols = ['UN No.', 'Class', 'Description', 'Pkg Group', 'Qty (kg)', 'IMO Cert', 'ENRRA Req.'];
  const colWidths = [55, 40, 155, 55, 55, 55, 55];
  const rowH = 14;
  const w = pageW - margin*2;
  let y = startY;

  doc.rect(margin, y, w, rowH).fill(...hex(C.navy));
  let cx = margin;
  cols.forEach((col, i) => {
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(...hex(C.teal))
      .text(col, cx + 3, y + 4, { width: colWidths[i] - 4, lineBreak: false });
    cx += colWidths[i];
  });
  y += rowH;

  dg.slice(0, 25).forEach((item, idx) => {
    const bg = idx % 2 === 0 ? C.white : C.light;
    doc.rect(margin, y, w, rowH).fill(...hex(bg));
    doc.moveTo(margin, y).lineTo(margin+w, y).strokeColor(...hex(C.border)).lineWidth(0.2).stroke();

    const isClass7 = (item.imdg_class || item.class || '') === '7';
    const isClass1 = String(item.imdg_class || item.class || '').startsWith('1');
    const cells = [
      item.un_number || '—',
      item.imdg_class || item.class || '—',
      (item.description || item.cargo_description || '—').slice(0, 30),
      item.packing_group || '—',
      item.quantity_kg || item.quantity || '—',
      item.imo_cert || (item.imo_certificate ? 'YES' : 'NO'),
      isClass7 ? 'REQUIRED' : isClass1 ? 'CHECK' : 'N/A',
    ];
    cx = margin;
    cells.forEach((cell, ci) => {
      const isAlert = (ci === 6 && String(cell) === 'REQUIRED');
      doc.fontSize(6.5).font(isAlert ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(...hex(isAlert ? C.fail : C.navy))
        .text(String(cell), cx + 3, y + 4, { width: colWidths[ci] - 4, lineBreak: false });
      cx += colWidths[ci];
    });
    y += rowH;
  });

  return y;
}

/**
 * ISPS SECURITY DECLARATION
 */
function renderIspsDeclaration(doc, filing, docData, extras, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'ISPS SECURITY DETAILS', y, pageW, margin);
  const ispsFields = [
    ['ISSC Number',                 docData.issc_number || '—'],
    ['ISSC Expiry Date',            docData.issc_expiry || '—'],
    ['ISSC Issuing Authority',      docData.issc_issuer || '—'],
    ['Current Security Level',      docData.security_level || docData.vessel_security_level || '1'],
    ['SSO Name',                    docData.sso_name || '—'],
    ['SSO Contact',                 docData.sso_contact || '—'],
    ['CSO Name',                    docData.cso_name || '—'],
    ['Last Port Facility Security', docData.last_port_facility || '—'],
    ['Threat Reported',             docData.threat_reported ? 'YES — SEE NOTES' : 'NO'],
    ['Special Measures',            docData.special_measures || 'None'],
  ];
  y = fieldGrid(doc, ispsFields, y, margin, pageW);
  y += 6;

  // Pre-arrival notifications
  const notifs = Array.isArray(extras.ispsNotifications) ? extras.ispsNotifications : [];
  y = sectionHeader(doc, 'SCA PRE-ARRIVAL ISPS NOTIFICATIONS (3 REQUIRED)', y, pageW, margin);

  const requiredNotifs = ['72h', '48h', '24h'];
  requiredNotifs.forEach(nType => {
    const found = notifs.find(n => n.notification_type === nType);
    const rowH = 18;
    doc.rect(margin, y, pageW - margin*2, rowH).fill(...hex(found ? C.passBg : C.failBg));
    doc.fontSize(8).font('Helvetica-Bold')
      .fillColor(...hex(found ? C.pass : C.fail))
      .text(`${nType} Notification:`, margin + 8, y + 5, { lineBreak: false });
    if (found) {
      doc.font('Helvetica').fillColor(...hex(C.slate))
        .text(`Sent ${found.sent_at ? new Date(found.sent_at).toISOString().slice(0,16).replace('T',' ') : 'pending'} — Ref: ${found.sca_reference || 'awaiting'}`, margin + 130, y + 5, { lineBreak: false });
      validationBadge(doc, 'pass', pageW - margin - 55, y + 3);
    } else {
      doc.font('Helvetica').fillColor(...hex(C.fail))
        .text('NOT YET SUBMITTED', margin + 130, y + 5, { lineBreak: false });
      validationBadge(doc, 'fail', pageW - margin - 55, y + 3);
    }
    y += rowH + 2;
  });

  y += 4;

  // Last 10 ports
  const ports = Array.isArray(docData.last_10_ports) ? docData.last_10_ports : [];
  if (ports.length > 0) {
    y = sectionHeader(doc, `LAST PORT CALLS (${ports.length} of 10)`, y, pageW, margin);
    const portCols = ['Port', 'LOCODE', 'Arrival', 'Departure', 'Sec. Level'];
    const portColW = [160, 60, 85, 85, 60];
    const pRowH = 13;
    const w = pageW - margin*2;

    doc.rect(margin, y, w, pRowH).fill(...hex(C.navy));
    let cx2 = margin;
    portCols.forEach((col, i) => {
      doc.fontSize(6).font('Helvetica-Bold').fillColor(...hex(C.teal))
        .text(col, cx2 + 3, y + 4, { width: portColW[i] - 4, lineBreak: false });
      cx2 += portColW[i];
    });
    y += pRowH;

    ports.slice(0, 10).forEach((p, idx) => {
      const bg = idx % 2 === 0 ? C.white : C.light;
      doc.rect(margin, y, w, pRowH).fill(...hex(bg));
      const cells2 = [p.port_name||'—', p.locode||'—', p.arrival||'—', p.departure||'—', String(p.security_level||1)];
      cx2 = margin;
      cells2.forEach((cell, ci) => {
        doc.fontSize(6).font('Helvetica').fillColor(...hex(C.navy))
          .text(String(cell).slice(0,25), cx2+3, y+4, { width: portColW[ci]-4, lineBreak: false });
        cx2 += portColW[ci];
      });
      y += pRowH;
    });
    y += 4;
  }

  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * SOPEP SUMMARY
 */
function renderSopep(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'SOPEP PLAN DETAILS', y, pageW, margin);
  const sopepFields = [
    ['SOPEP Plan Version',          docData.sopep_version || '—'],
    ['Date of Approval',            docData.sopep_approved_date || '—'],
    ['Approving Flag Authority',    docData.flag_authority || filing.flag_state || '—'],
    ['Qualified Individual (QI)',   docData.qi_name || '—'],
    ['QI Organisation',             docData.qi_organisation || '—'],
    ['QI Contact (24h)',            docData.qi_contact || '—'],
    ['OSC Contract No.',            docData.osc_contract || '—'],
    ['OSC Organisation',            docData.osc_organisation || '—'],
    ['OSC Contact (24h)',           docData.osc_contact || '—'],
    ['Oil Type Onboard',            docData.oil_type || '—'],
    ['Total Oil Onboard (MT)',      docData.oil_volume_mt || '—'],
    ['Sludge Capacity (m³)',        docData.sludge_capacity || '—'],
    ['Last Drill Date',             docData.last_drill_date || '—'],
    ['Last Audit Date',             docData.last_audit_date || '—'],
  ];
  y = fieldGrid(doc, sopepFields, y, margin, pageW);
  y += 4;

  y = noteBox(doc, 'SCA REQUIREMENT: SOPEP must be approved by the flag state administration or a recognised organisation authorised by the flag state.', y, margin, pageW, C.warnBg);
  y += 4;

  const valStatus = docData.validation_status || docData.status;
  if (valStatus) {
    y = sectionHeader(doc, 'COMPLIANCE VALIDATION', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 30).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text('SOPEP Validation Status:', margin + 8, y + 10, { lineBreak: false });
    validationBadge(doc, valStatus, margin + 200, y + 9);
    y += 34;
  }

  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * BALLAST WATER MANAGEMENT DECLARATION
 */
function renderBallastWater(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'BALLAST WATER MANAGEMENT DETAILS', y, pageW, margin);
  const bwFields = [
    ['BWM Standard',                docData.bwm_standard || '—'],
    ['BWMC Certificate No.',        docData.bwmc_cert || '—'],
    ['BWMC Expiry Date',            docData.bwmc_expiry || '—'],
    ['Issuing Authority',           docData.bwmc_issuer || '—'],
    ['BWM System Type',             docData.bwm_system_type || '—'],
    ['System IMO Type Approval',    docData.bwm_type_approval || '—'],
    ['Total Ballast Capacity (m³)', docData.ballast_capacity || '—'],
    ['Ballast Water Onboard (m³)', docData.ballast_onboard || '—'],
    ['Treatment Method',            docData.treatment_method || '—'],
    ['Ballast Origin Port',         docData.ballast_origin || '—'],
    ['Ballast Origin Date',         docData.ballast_loaded_date || '—'],
    ['Last Exchange Location',      docData.last_exchange_location || '—'],
    ['BWM Plan Onboard',            docData.bwm_plan_onboard ? 'YES' : 'NO'],
    ['BWM Record Book Onboard',     docData.bwm_record_book ? 'YES' : 'NO'],
  ];
  y = fieldGrid(doc, bwFields, y, margin, pageW);
  y += 4;

  // BWM standard note
  if (docData.bwm_standard === 'D-1') {
    y = noteBox(doc, 'D-1 Exchange: Sequential / Flow-through / Dilution method. Minimum 95% volumetric exchange required. SCA accepts D-1 if D-2 treatment unavailable on route.', y, margin, pageW, C.warnBg);
  } else if (docData.bwm_standard === 'D-2') {
    y = noteBox(doc, 'D-2 Treatment: Approved BWM system installed and certified by type approval authority. Compliant with IMO Resolution MEPC.300(72).', y, margin, pageW, C.passBg);
  }

  y += 4;
  const valStatus = docData.validation_status || docData.status;
  if (valStatus) {
    y = sectionHeader(doc, 'COMPLIANCE VALIDATION', y, pageW, margin);
    doc.rect(margin, y, pageW - margin*2, 30).fill(...hex(C.light));
    doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text('BWM Validation Status:', margin + 8, y + 10, { lineBreak: false });
    validationBadge(doc, valStatus, margin + 190, y + 9);
    y += 34;
  }

  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * TONNAGE CERTIFICATE SUMMARY
 */
function renderTonnageCertificate(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'SUEZ CANAL TONNAGE CERTIFICATE (SCNT) DETAILS', y, pageW, margin);
  const tcFields = [
    ['SCNT (Suez Canal Net Tonnage)',  filing.scnt || docData.scnt || '—'],
    ['Gross Tonnage (GT)',             filing.gross_tonnage || docData.gross_tonnage || '—'],
    ['Net Tonnage (NT)',               docData.net_tonnage || '—'],
    ['Deadweight Tonnage (DWT)',       docData.dwt || '—'],
    ['STC Certificate Number',         docData.stc_cert_number || '—'],
    ['STC Issue Date',                 docData.stc_issue_date || '—'],
    ['STC Issuing Authority',          docData.stc_issuer || filing.classification_society || '—'],
    ['Measurement Convention',        'ITC 69 (as modified for Suez)'],
    ['Classification Society',        filing.classification_society || docData.classification_society || '—'],
    ['Last Survey Date',               docData.last_survey_date || '—'],
    ['Next Survey Due',                docData.next_survey_date || '—'],
    ['Approved for Canal Transit',     docData.approved_transit ? 'YES' : 'PENDING'],
  ];
  y = fieldGrid(doc, tcFields, y, margin, pageW);
  y += 6;

  // SCNT vs GT comparison
  const scnt = parseFloat(filing.scnt || docData.scnt || 0);
  const gt   = parseFloat(filing.gross_tonnage || docData.gross_tonnage || 0);
  if (scnt > 0 && gt > 0) {
    y = sectionHeader(doc, 'TONNAGE ANALYSIS', y, pageW, margin);
    const ratio = (scnt / gt * 100).toFixed(1);
    const analysisFields = [
      ['SCNT / GT Ratio',        `${ratio}%  (typical range: 70–90%)`],
      ['Toll Basis',             'SCNT'],
      ['Applicable Tariff',      '2024 SCA Tariff Schedule'],
      ['Fee Est. (indicative)',  estimateScntFee(scnt, (filing.vessel_type || 'other').toLowerCase()).feeUsd],
    ];
    y = fieldGrid(doc, analysisFields, y, margin, pageW);
    y += 4;
    y = noteBox(doc, 'SCNT-based tolls: SCA applies its own tonnage measurement system (different from ITC/GT) to calculate transit dues. Verify SCNT with your classification society.', y, margin, pageW, C.warnBg);
  }

  y += 4;
  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * DANGEROUS GOODS DECLARATION (suez_dangerous_goods)
 * Dedicated form type — IMDG class, UN number, proper shipping name,
 * quantity, stowage location, emergency contact.
 */
function renderDangerousGoodsDeclaration(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  // Header fields
  y = sectionHeader(doc, 'DANGEROUS GOODS SHIPMENT DETAILS', y, pageW, margin);
  const headerFields = [
    ['Shipper / Consignor',           docData.shipper || '—'],
    ['Transport Document No.',        docData.transport_doc || '—'],
    ['UN Number',                     docData.un_number || '—'],
    ['Proper Shipping Name',          docData.proper_shipping_name || '—'],
    ['IMDG Class / Division',         docData.imdg_class || '—'],
    ['Packing Group',                 docData.packing_group || '—'],
    ['Total Quantity',                docData.quantity ? `${docData.quantity} ${docData.unit || ''}`.trim() : '—'],
    ['Package Type',                  docData.package_type || '—'],
    ['Flash Point (°C)',              docData.flash_point || 'N/A'],
    ['Stowage Location',              docData.stowage_location || '—'],
    ['Emergency Contact',             docData.emergency_contact || '—'],
  ];
  y = fieldGrid(doc, headerFields, y, margin, pageW);
  y += 4;

  // Special provisions
  if (docData.special_provisions) {
    y = sectionHeader(doc, 'SPECIAL PROVISIONS / REMARKS', y, pageW, margin);
    const provW = pageW - margin * 2;
    doc.rect(margin, y, provW, 36).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.navy))
      .text(docData.special_provisions, margin + 6, y + 6, { width: provW - 12 });
    y += 40;
  }

  // IMDG regulatory notice
  const isClass7 = String(docData.imdg_class || '').includes('7');
  const isClass1 = String(docData.imdg_class || '').startsWith('1');
  const isLithium = /un(3480|3481|3090|3091)/i.test(docData.un_number || '');
  y += 4;

  if (isClass7) {
    y = noteBox(doc, 'CLASS 7 RADIOACTIVE — Prior SCA approval required minimum 72h before transit. Contact SCA Agent immediately.', y, margin, pageW, C.failBg);
  } else if (isClass1) {
    y = noteBox(doc, 'CLASS 1 EXPLOSIVES — SCA Class 1 cargo requires prior approval 72h before transit. Verify with local SCA agent.', y, margin, pageW, C.warnBg);
  } else if (isLithium) {
    y = noteBox(doc, 'LITHIUM BATTERIES (IMDG 42-24) — UN3480/3481/3090/3091 require Class 9 declaration. State of Charge (SoC) must be ≤30% for air-mode transport. SCA notified.', y, margin, pageW, C.warnBg);
  } else {
    y = noteBox(doc, 'IMDG Amendment 42-24: All dangerous goods must be declared prior to Suez Canal transit. Ensure correct UN number, class, packing group, and stowage compliance.', y, margin, pageW, C.light);
  }

  y += 4;
  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * SCNT TONNAGE CALCULATION (suez_scnt_tonnage)
 * Dedicated form type — SCNT value, GT/NT/DWT, cert details, toll estimate.
 */
function renderScntTonnageCalculation(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'SCNT TONNAGE CERTIFICATE DETAILS', y, pageW, margin);
  const tcFields = [
    ['SCNT (Suez Canal Net Tonnage)',  docData.scnt_value || filing.scnt || '—'],
    ['ITC Gross Tonnage (GT)',         docData.gross_tonnage || filing.gross_tonnage || '—'],
    ['ITC Net Tonnage (NT)',           docData.net_tonnage || '—'],
    ['Deadweight Tonnage (DWT)',       docData.dwt || '—'],
    ['SCA Tonnage Certificate No.',   docData.cert_number || '—'],
    ['Certificate Issue Date',        docData.cert_issue_date || '—'],
    ['Certificate Expiry',            docData.cert_expiry || 'Indefinite validity'],
    ['Issuing Authority',             docData.cert_issuer || '—'],
    ['Measurement Convention',        'ITC 69 (as modified for Suez)'],
    ['Vessel Type',                   (docData.vessel_type || '—').replace(/_/g,' ')],
    ['LOA (m)',                       docData.loa || '—'],
    ['Beam (m)',                      docData.beam || '—'],
    ['Moulded Depth (m)',             docData.moulded_depth || '—'],
    ['Year Built',                    docData.year_built || '—'],
    ['Applicable Rebate Tier',        docData.rebate_tier || 'No Rebate'],
  ];
  y = fieldGrid(doc, tcFields, y, margin, pageW);
  y += 6;

  // Toll estimate section — include calculator output if available
  const tollEst = docData.toll_estimate;
  if (tollEst) {
    y = sectionHeader(doc, 'ESTIMATED SCA TRANSIT TOLL (CALCULATED)', y, pageW, margin);
    const tollFields = [
      ['SCNT Used for Calculation',    tollEst.scnt_used ? String(tollEst.scnt_used.toLocaleString()) : '—'],
      ['SCNT Estimated',               tollEst.scnt_estimated ? 'Yes (±15%)' : 'No — from certificate'],
      ['Estimated Transit Toll',       tollEst.transit_toll_usd ? `USD ${Number(tollEst.transit_toll_usd).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'],
      ['Net Total (after rebate)',     tollEst.net_total_usd ? `USD ${Number(tollEst.net_total_usd).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'],
      ['Total in SDR',                 tollEst.net_total_sdr ? `SDR ${Number(tollEst.net_total_sdr).toLocaleString('en-US', {maximumFractionDigits:0})}` : '—'],
      ['Best Rebate Applied',          tollEst.best_rebate ? `${tollEst.best_rebate} (${tollEst.rebate_pct}%)` : 'None'],
      ['SDR/USD Rate Used',            tollEst.sdr_rate ? String(tollEst.sdr_rate) : '~1.33 (approximate)'],
      ['Calculated At',               tollEst.calculated_at ? new Date(tollEst.calculated_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'],
    ];
    y = fieldGrid(doc, tollFields, y, margin, pageW);
    y += 4;
    y = noteBox(doc, 'Toll estimate is indicative only. Actual SCA toll calculated by SCA on day of transit based on published 2024 tariff schedule. SDR/USD rate from IMF on payment date.', y, margin, pageW, C.warnBg);
  } else {
    // Fall back to formula estimate
    const scnt = parseFloat(docData.scnt_value || filing.scnt || 0);
    const vesselType = (docData.vessel_type || filing.vessel_type || 'other').toLowerCase();
    if (scnt > 0) {
      y = sectionHeader(doc, 'ESTIMATED SCA TRANSIT TOLL (FORMULA ESTIMATE)', y, pageW, margin);
      const feeEstimate = estimateScntFee(scnt, vesselType);
      const feeFields = [
        ['SCNT',                          scnt.toLocaleString()],
        ['Base Rate (SDR/SCNT)',          feeEstimate.baseRate.toFixed(4)],
        ['Estimated Fee (SDR)',           feeEstimate.feeSdr.toLocaleString(undefined, { minimumFractionDigits: 2 })],
        ['Estimated Fee (USD approx.)',   feeEstimate.feeUsd],
        ['Rebate Program',               feeEstimate.rebateProgram],
        ['Tariff Version',               '2024 SCA Tariff Schedule'],
      ];
      y = fieldGrid(doc, feeFields, y, margin, pageW);
      y += 4;
      y = noteBox(doc, 'Fee estimate is indicative only. Use the full SCNT calculator at CanalClear for rebate-adjusted figures. Actual SCA invoice uses IMF SDR/USD rate on payment date.', y, margin, pageW, C.warnBg);
    }
  }

  // Remarks
  if (docData.remarks) {
    y += 4;
    y = sectionHeader(doc, 'REMARKS / AMENDMENTS', y, pageW, margin);
    const remW = pageW - margin * 2;
    doc.rect(margin, y, remW, 36).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.navy))
      .text(docData.remarks, margin + 6, y + 6, { width: remW - 12 });
    y += 40;
  }

  y += 4;
  y = renderSignatureBlock(doc, y, margin, pageW);
}

/**
 * PILOTAGE ARRANGEMENTS (suez_pilotage)
 * Pilot boarding point, vessel maneuverability data, tug requirements,
 * communication details.
 */
function renderPilotageArrangements(doc, filing, docData, margin, pageW) {
  let y = doc.y;

  y = renderVesselSection(doc, filing, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'PILOTAGE ARRANGEMENTS — SCA COMPULSORY PILOTAGE', y, pageW, margin);

  // Boarding & scheduling
  const pilotFields = [
    ['Pilot Boarding Station',        (docData.boarding_station || '—').replace(/_/g, ' ').toUpperCase()],
    ['Required Pilot Count',          docData.pilot_count ? `${docData.pilot_count} Pilot(s)` : '—'],
    ['ETA at Pilot Boarding Point',   docData.eta_pilot_point ? docData.eta_pilot_point.replace('T', ' ') + ' UTC' : '—'],
    ['Transit Direction',             (docData.transit_direction || '—').replace(/_/g, ' ')],
    ['Master\'s Full Name',           docData.master_name || '—'],
    ['VHF Working Channel',           docData.vhf_channel || 'Ch 16 / Ch 12 (default)'],
  ];
  y = fieldGrid(doc, pilotFields, y, margin, pageW);
  y += 6;

  // Vessel maneuverability data
  y = sectionHeader(doc, 'VESSEL MANEUVERABILITY DATA', y, pageW, margin);
  const manFields = [
    ['LOA (m)',                       docData.loa || filing.loa || '—'],
    ['Beam (m)',                      docData.beam || filing.beam || '—'],
    ['Air Draft (m)',                 docData.air_draft || filing.air_draft || '—'],
    ['Draft Forward (m)',             docData.draft_forward || filing.draft_forward || '—'],
    ['Draft Aft (m)',                 docData.draft_aft || filing.draft_aft || '—'],
    ['Service Speed (kn)',            docData.vessel_speed || '—'],
  ];
  y = fieldGrid(doc, manFields, y, margin, pageW);
  y += 4;

  // Pilot count rule notice
  const loa = parseFloat(docData.loa || filing.loa || 0);
  const beam = parseFloat(docData.beam || filing.beam || 0);
  const airDraft = parseFloat(docData.air_draft || filing.air_draft || 0);
  if (loa > 270 || beam > 40) {
    y = noteBox(doc, `SCA RULE: LOA ${loa}m / Beam ${beam}m — 2 pilots required (vessel exceeds LOA >270m or Beam >40m threshold).`, y, margin, pageW, C.warnBg);
  }
  if (airDraft > 0 && airDraft > 65) {
    y = noteBox(doc, `AIR DRAFT ADVISORY: ${airDraft}m — exceeds 65m advisory height. El-Ferdan Railway Bridge max clearance is ~70m. Verify bridge clearance with SCA.`, y, margin, pageW, C.warnBg);
  }

  // Special requirements
  if (docData.special_requirements) {
    y += 4;
    y = sectionHeader(doc, 'SPECIAL REQUIREMENTS / REMARKS', y, pageW, margin);
    const reqW = pageW - margin * 2;
    doc.rect(margin, y, reqW, 36).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.navy))
      .text(docData.special_requirements, margin + 6, y + 6, { width: reqW - 12 });
    y += 40;
  }

  // Regulatory notice
  y += 4;
  y = noteBox(doc, 'SCA REQUIREMENT: Pilotage is compulsory for ALL vessels transiting the Suez Canal. Submit arrangements minimum 24 hours before ETA at pilot boarding point. Non-compliance results in transit delay.', y, margin, pageW, C.light);
  y += 4;

  y = renderSignatureBlock(doc, y, margin, pageW);
}

// ── Signature block ───────────────────────────────────────────────────────────

function renderSignatureBlock(doc, startY, margin, pageW) {
  const y = startY + 8;
  const w = pageW - margin*2;

  doc.rect(margin, y, w, 70).fill(...hex(C.light))
    .moveTo(margin, y).lineTo(margin+w, y)
    .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();

  doc.fontSize(7.5).font('Helvetica-Bold').fillColor(...hex(C.slate))
    .text('MASTER\'S DECLARATION', margin + 8, y + 8);
  doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted))
    .text('I, the undersigned Master, declare that the information given in this document is correct and complete to the best of my knowledge and belief.', margin + 8, y + 20, { width: w - 120 });

  // Signature lines
  const sigY = y + 46;
  doc.moveTo(margin + 8,   sigY).lineTo(margin + 170, sigY).strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
  doc.moveTo(margin + 190, sigY).lineTo(margin + 360, sigY).strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
  doc.moveTo(margin + 380, sigY).lineTo(margin + w - 8, sigY).strokeColor(...hex(C.border)).lineWidth(0.5).stroke();

  doc.fontSize(6.5).font('Helvetica').fillColor(...hex(C.muted))
    .text('Master\'s Signature', margin + 8,   sigY + 3, { lineBreak: false })
    .text('Date',                margin + 190, sigY + 3, { lineBreak: false })
    .text('Ship\'s Stamp',       margin + 380, sigY + 3, { lineBreak: false });

  return y + 78;
}

// ── SCNT fee estimator (placeholder) ─────────────────────────────────────────

/**
 * Simplified SCNT fee estimate based on 2024 SCA tariff schedule.
 * This is indicative only — actual toll calculated by SCA.
 *
 * Base rates (SDR per SCNT) — simplified 2024 schedule:
 *   container:        3.20 SDR/SCNT
 *   tanker:           2.85 SDR/SCNT
 *   bulk_carrier:     2.50 SDR/SCNT  (rebate programs up to 75% in 2024)
 *   lng_carrier:      3.50 SDR/SCNT
 *   lpg_carrier:      3.10 SDR/SCNT
 *   general_cargo:    2.60 SDR/SCNT
 *   passenger/cruise: 8.00 SDR/SCNT  (per passenger berth in practice)
 *   ro_ro:            3.00 SDR/SCNT
 *   chemical_tanker:  2.90 SDR/SCNT
 *   other:            2.70 SDR/SCNT
 *
 * SDR/USD rate ≈ 1.35 (approximate — actual rate from IMF on transit date)
 */
const SCNT_RATES = {
  container:       3.20,
  tanker:          2.85,
  bulk_carrier:    2.50,
  lng_carrier:     3.50,
  lpg_carrier:     3.10,
  general_cargo:   2.60,
  cruise:          8.00,
  ro_ro:           3.00,
  chemical_tanker: 2.90,
  reefer:          2.70,
  vehicle_carrier: 3.00,
  offshore:        2.50,
  other:           2.70,
};

const BULK_REBATE_PROGRAMS = {
  bulk_carrier: { name: 'SCA Bulk Carrier Rebate 2024', maxRebate: '50%' },
  container:    { name: 'SCA Container Incentive 2024', maxRebate: '30%' },
  tanker:       { name: 'SCA Tanker Program 2024',      maxRebate: '20%' },
};

const SDR_TO_USD = 1.35; // approximate; actual rate from IMF on transit date

function estimateScntFee(scnt, vesselType) {
  const type = (vesselType || 'other').replace(/-/g, '_').toLowerCase();
  const baseRate = SCNT_RATES[type] || SCNT_RATES.other;
  const feeSdr  = scnt > 0 ? Math.max(scnt * baseRate, 5000) : 0; // 5,000 SDR minimum
  const feeUsd  = scnt > 0 ? `USD ${(feeSdr * SDR_TO_USD).toLocaleString('en-US', {maximumFractionDigits:0})} (est.)` : 'N/A';
  const rebate  = BULK_REBATE_PROGRAMS[type];

  return {
    baseRate,
    feeSdr,
    feeUsd,
    rebateProgram: rebate ? `${rebate.name} (max ${rebate.maxRebate} rebate available)` : 'None applicable',
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { generateSuezPDF, ALL_DOC_TYPES, DOC_META };
