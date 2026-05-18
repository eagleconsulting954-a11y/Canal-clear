/**
 * bosporus-sp1-pdf.js — Bosporus SP-1 Filing PDF Generator
 *
 * Owns: PDF generation for SP-1 (Turkish Straits pre-arrival notification) filings.
 * Does NOT own: database access, validation logic, route handling, or email delivery.
 *
 * Produces A4 PDFs suitable for submission to the Turkish VTS (Vessel Traffic Service).
 * Uses PDFKit (already a project dependency). Called by GET /api/bosporus/filings/:id/pdf
 */

'use strict';

const PDFDocument = require('pdfkit');

// ── Brand constants ───────────────────────────────────────────────────────────

const BRAND = {
  name:    'CanalClear',
  tagline: 'Canal Compliance Automation',
  url:     'canalclear.org',
  email:   'compliance@canalclear.org',
};

// ── Color palette (same as suez-pdf-generator for visual consistency) ─────────

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
  orange:  '#C05621',
  orangeBg:'#FEEBC8',
};

// ── Document metadata ─────────────────────────────────────────────────────────

const DOC_META = {
  sp1_pre_arrival: {
    title:    'SP-1 PRE-ARRIVAL NOTIFICATION',
    subtitle: 'Turkish Straits Vessel Traffic Service — Mandatory Pre-Arrival Form',
    form:     'VTS/SP-1/2024',
  },
  sp1_compliance_report: {
    title:    'SP-1 COMPLIANCE ASSESSMENT REPORT',
    subtitle: 'CanalClear Automated Validation — Turkish Straits Transit',
    form:     'CC/BSP/CR/2024',
  },
};

const ALL_DOC_TYPES = Object.keys(DOC_META);

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer for a Bosporus SP-1 filing.
 *
 * @param {object} filing   Row from sp1_filings table
 * @param {string} docType  'sp1_pre_arrival' | 'sp1_compliance_report' | 'all'
 * @returns {Promise<Buffer>}
 */
async function generateBosporusPDF(filing, docType) {
  const doc = new PDFDocument({
    size:   'A4',
    margin: 0,
    info: {
      Title:    `${BRAND.name} — ${docType === 'all' ? 'SP-1 Complete Package' : (DOC_META[docType]?.title || docType)}`,
      Author:   BRAND.name,
      Subject:  `Bosporus SP-1 Filing — ${filing.vessel_name || 'Unknown Vessel'} — ${filing.id}`,
      Creator:  `${BRAND.name} Compliance Platform`,
      Producer: `${BRAND.name} (${BRAND.url})`,
    },
  });

  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  if (docType === 'all') {
    for (let i = 0; i < ALL_DOC_TYPES.length; i++) {
      if (i > 0) doc.addPage();
      renderDocument(doc, ALL_DOC_TYPES[i], filing);
    }
  } else {
    renderDocument(doc, docType, filing);
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

// ── Document dispatcher ───────────────────────────────────────────────────────

function renderDocument(doc, docType, filing) {
  const meta   = DOC_META[docType] || { title: docType.toUpperCase(), subtitle: '', form: '' };
  const pageW  = doc.page.width;
  const pageH  = doc.page.height;
  const margin = 40;

  renderPageHeader(doc, meta, filing, pageW, margin);

  doc.y = 160;

  switch (docType) {
    case 'sp1_pre_arrival':
      renderSP1PreArrival(doc, filing, margin, pageW, pageH);
      break;
    case 'sp1_compliance_report':
      renderComplianceReport(doc, filing, margin, pageW, pageH);
      break;
    default:
      doc.fontSize(12).fillColor(...hex(C.muted))
        .text(`Document type "${docType}" not recognised.`, margin, doc.y);
  }

  renderPageFooter(doc, filing, pageW, pageH, margin);
}

// ── Page header ───────────────────────────────────────────────────────────────

function renderPageHeader(doc, meta, filing, pageW, margin) {
  doc.rect(0, 0, pageW, 130).fill(...hex(C.navy));

  doc.fontSize(18).font('Helvetica-Bold')
    .fillColor(...hex(C.teal))
    .text(BRAND.name, margin, 18, { lineBreak: false });

  doc.fontSize(8).font('Helvetica')
    .fillColor(...hex(C.muted))
    .text(BRAND.tagline.toUpperCase(), margin, 38, { lineBreak: false });

  doc.moveTo(margin, 52).lineTo(pageW - margin, 52)
    .strokeColor(...hex(C.teal)).lineWidth(0.5).stroke();

  doc.fontSize(14).font('Helvetica-Bold')
    .fillColor(...hex(C.white))
    .text(meta.title, margin, 60, { width: pageW - margin*2, align: 'center', lineBreak: false });

  doc.fontSize(8).font('Helvetica')
    .fillColor(...hex(C.border))
    .text(meta.subtitle, margin, 78, { width: pageW - margin*2, align: 'center', lineBreak: false });

  const refX = pageW - margin - 200;
  doc.fontSize(7).font('Helvetica')
    .fillColor(...hex(C.muted))
    .text('FORM', refX, 18, { width: 200, align: 'right', lineBreak: false });
  doc.fontSize(7).font('Helvetica-Bold')
    .fillColor(...hex(C.border))
    .text(meta.form, refX, 26, { width: 200, align: 'right', lineBreak: false });

  // Filing info bar
  doc.rect(0, 130, pageW, 30).fill(...hex(C.light));
  doc.moveTo(0, 130).lineTo(pageW, 130).strokeColor(...hex(C.teal)).lineWidth(2).stroke();

  const ts     = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const refNum = `CC-BSP-${String(filing.id).padStart(6,'0')}`;

  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate));
  const bY = 139;
  doc.text(`FILING REF: ${refNum}`,                                margin,       bY, { lineBreak: false });
  doc.text(`VESSEL: ${(filing.vessel_name || '—').toUpperCase()}`, margin + 150, bY, { lineBreak: false });
  doc.text(`IMO: ${filing.imo_number || '—'}`,                     margin + 370, bY, { lineBreak: false });
  doc.text(`GENERATED: ${ts}`,                                     margin + 460, bY, { lineBreak: false });
}

// ── Page footer ───────────────────────────────────────────────────────────────

function renderPageFooter(doc, filing, pageW, pageH, margin) {
  const footerY = pageH - 40;
  doc.moveTo(margin, footerY).lineTo(pageW - margin, footerY)
    .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();

  doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
  doc.text(`Generated by ${BRAND.name} · ${BRAND.url}`, margin, footerY + 8, { lineBreak: false });
  doc.text(
    'CONFIDENTIAL — FOR REGULATORY SUBMISSION ONLY',
    margin + 180, footerY + 8,
    { lineBreak: false, align: 'center', width: pageW - margin*2 - 180 }
  );
  doc.text('Page 1', pageW - margin - 40, footerY + 8, { lineBreak: false });
}

// ── Shared rendering helpers ──────────────────────────────────────────────────

function sectionHeader(doc, title, y, pageW, margin) {
  doc.rect(margin, y, pageW - margin*2, 18).fill(...hex(C.navy));
  doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.teal))
    .text(title, margin + 6, y + 5, { lineBreak: false });
  return y + 22;
}

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

function fieldGrid(doc, fields, startY, margin, pageW) {
  const rowH  = 18;
  const colW  = (pageW - margin*2) / 2;
  let y    = startY;
  let col  = 0;

  for (let i = 0; i < fields.length; i++) {
    const [label, value] = fields[i];
    const x = margin + col * colW;
    fieldRow(doc, label, value, x, y, colW, rowH, i % 2 === 0);
    col++;
    if (col >= 2) { col = 0; y += rowH; }
  }
  if (col > 0) y += rowH;
  return y + 4;
}

function validationBadge(doc, status, x, y) {
  const isPass = status === 'pass' || status === 'passed' || status === true;
  const isWarn = status === 'warning' || status === 'warn';
  const bg  = isPass ? C.passBg  : isWarn ? C.warnBg  : C.failBg;
  const fg  = isPass ? C.pass    : isWarn ? C.warn     : C.fail;
  const txt = isPass ? '✓ PASS'  : isWarn ? '⚠ WARN'   : '✗ FAIL';

  doc.roundedRect(x, y, 50, 13, 3).fill(...hex(bg));
  doc.fontSize(6.5).font('Helvetica-Bold').fillColor(...hex(fg))
    .text(txt, x + 4, y + 3, { lineBreak: false });
}

function noteBox(doc, text, y, margin, pageW, color = C.warnBg) {
  const w = pageW - margin*2;
  doc.rect(margin, y, w, 20).fill(...hex(color));
  doc.moveTo(margin, y).lineTo(margin, y+20).strokeColor(...hex(C.warn)).lineWidth(2).stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
    .text(text, margin + 8, y + 6, { width: w - 12, lineBreak: false });
  return y + 24;
}

function scoreBar(doc, score, y, margin, pageW) {
  const w     = pageW - margin*2;
  const score_ = Math.max(0, Math.min(100, score || 0));
  const color = score_ >= 80 ? C.pass : score_ >= 50 ? C.warn : C.fail;
  const bgClr = score_ >= 80 ? C.passBg : score_ >= 50 ? C.warnBg : C.failBg;

  doc.rect(margin, y, w, 28).fill(...hex(bgClr));
  doc.moveTo(margin, y).lineTo(margin, y+28).strokeColor(...hex(color)).lineWidth(3).stroke();

  doc.fontSize(9).font('Helvetica-Bold').fillColor(...hex(color))
    .text(`Compliance Score: ${score_}/100`, margin + 12, y + 9, { lineBreak: false });

  const label = score_ === 100 ? 'FULLY COMPLIANT'
    : score_ >= 80 ? 'COMPLIANT — Minor Issues'
    : score_ >= 50 ? 'CONDITIONAL — Warnings Present'
    : 'NON-COMPLIANT — Action Required';

  doc.fontSize(8).font('Helvetica').fillColor(...hex(C.slate))
    .text(label, margin + 200, y + 10, { lineBreak: false });

  return y + 32;
}

// ── SP-1 Pre-Arrival Notification renderer ────────────────────────────────────

function renderSP1PreArrival(doc, filing, margin, pageW, pageH) {
  let y = doc.y;

  // ── Authority note ─────────────────────────────────────────────────────────
  y = noteBox(
    doc,
    'Submit to: Turkish Straits VTS (Istanbul VTS: +90 212 249 7900 / vts@turkbogazvts.gov.tr)  |  Filing window: 24h min (48h for hazmat/oversized)',
    y, margin, pageW, C.orangeBg
  );

  y += 4;

  // ── Section 1: Vessel Particulars ──────────────────────────────────────────
  y = sectionHeader(doc, '1. VESSEL PARTICULARS', y, pageW, margin);

  const vesselFields = [
    ['Vessel Name',          filing.vessel_name    || '—'],
    ['IMO Number',           filing.imo_number     || '—'],
    ['Call Sign',            filing.call_sign      || '—'],
    ['MMSI',                 filing.mmsi           || '—'],
    ['Flag State',           filing.flag_state     || '—'],
    ['Vessel Type',          fmtVesselType(filing.vessel_type)],
    ['Gross Tonnage (GT)',   filing.gross_tonnage  ?? '—'],
    ['Net Tonnage (NT)',     filing.net_tonnage    ?? '—'],
    ['Length Overall (m)',   filing.loa            ?? '—'],
    ['Beam (m)',             filing.beam           ?? '—'],
    ['Draft (m)',            filing.draft          ?? '—'],
    ['Year Built',           filing.year_built     || '—'],
  ];
  y = fieldGrid(doc, vesselFields, y, margin, pageW);

  // ── Section 2: Transit Details ─────────────────────────────────────────────
  y += 4;
  y = sectionHeader(doc, '2. TRANSIT DETAILS', y, pageW, margin);

  const eta = filing.estimated_arrival
    ? new Date(filing.estimated_arrival).toISOString().replace('T',' ').slice(0,16) + ' UTC'
    : '—';

  const transitFields = [
    ['Transit Direction',   fmtDirection(filing.transit_direction)],
    ['Last Port of Call',   filing.last_port          || '—'],
    ['Next Port of Call',   filing.next_port          || '—'],
    ['Estimated Arrival',   eta],
    ['Pilot Required',      filing.pilot_required ? 'YES — Confirmed' : 'Not specified'],
    ['Pilot Booking Ref',   filing.pilot_booking_ref  || '—'],
    ['Agent Name',          filing.agent_name         || '—'],
    ['Agent Contact',       filing.agent_contact      || '—'],
  ];
  y = fieldGrid(doc, transitFields, y, margin, pageW);

  // ── Section 3: Cargo Information ───────────────────────────────────────────
  y += 4;
  y = sectionHeader(doc, '3. CARGO INFORMATION', y, pageW, margin);

  const cargoFields = [
    ['Cargo Type',            fmtCargoType(filing.cargo_type)],
    ['Cargo Quantity (MT)',   filing.cargo_quantity    ?? '—'],
    ['Dangerous Goods Class', filing.dangerous_goods_class ? `IMDG Class ${filing.dangerous_goods_class}` : 'None declared'],
    ['Hazmat UN Number',      filing.hazmat_un_number  || '—'],
    ['Ballast Condition',     filing.in_ballast ? 'YES — In Ballast' : 'No'],
  ];
  y = fieldGrid(doc, cargoFields, y, margin, pageW);

  // ── Section 4: Crew & Passengers ──────────────────────────────────────────
  y += 4;
  y = sectionHeader(doc, '4. CREW & PASSENGERS', y, pageW, margin);

  const crewFields = [
    ['Total Crew Count',     filing.crew_count       ?? '—'],
    ['Passenger Count',      filing.passenger_count  ?? 0],
    ['Master / Captain',     filing.master_name       || '—'],
    ['Nationality (Master)', filing.master_nationality || '—'],
  ];
  y = fieldGrid(doc, crewFields, y, margin, pageW);

  // ── Section 5: Insurance & P&I ─────────────────────────────────────────────
  y += 4;
  y = sectionHeader(doc, '5. INSURANCE & P&I COVER', y, pageW, margin);

  const insuranceFields = [
    ['P&I Club',              filing.pi_club          || '—'],
    ['Insurance Details',     filing.insurance_details || '—'],
    ['Certificate Valid To',  filing.insurance_expiry  || '—'],
  ];
  y = fieldGrid(doc, insuranceFields, y, margin, pageW);

  // ── Section 6: Declaration ─────────────────────────────────────────────────
  y += 8;
  y = sectionHeader(doc, '6. DECLARATION', y, pageW, margin);

  const declW = pageW - margin*2;
  doc.rect(margin, y, declW, 50).fill(...hex(C.light))
    .moveTo(margin, y).lineTo(margin+declW, y).strokeColor(...hex(C.border)).lineWidth(0.3).stroke();

  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
    .text(
      'I hereby declare that the particulars given in this notification are correct and complete to the best of my knowledge, ' +
      'and that the vessel is in compliance with the Turkish Straits Maritime Traffic Regulations. I understand that providing ' +
      'false information is an offence under Turkish maritime law.',
      margin + 6, y + 6,
      { width: declW - 12 }
    );

  y += 54;

  // Signature lines
  const sigY = y + 4;
  const colW  = (pageW - margin*2) / 2;

  doc.moveTo(margin, sigY + 24).lineTo(margin + colW - 20, sigY + 24)
    .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
  doc.moveTo(margin + colW, sigY + 24).lineTo(pageW - margin, sigY + 24)
    .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();

  doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
  doc.text('Master Signature / Date',           margin,            sigY + 28, { lineBreak: false });
  doc.text('Agent / Ship\'s Agent Signature',   margin + colW,     sigY + 28, { lineBreak: false });
}

// ── Compliance Assessment Report renderer ─────────────────────────────────────

function renderComplianceReport(doc, filing, margin, pageW, pageH) {
  let y = doc.y;

  // Score banner
  y = scoreBar(doc, filing.compliance_score, y, margin, pageW);
  y += 6;

  // ── Summary block ──────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'FILING SUMMARY', y, pageW, margin);

  const eta = filing.estimated_arrival
    ? new Date(filing.estimated_arrival).toISOString().replace('T',' ').slice(0,16) + ' UTC'
    : '—';

  const summaryFields = [
    ['Vessel',                 `${filing.vessel_name || '—'} (IMO ${filing.imo_number || '—'})`],
    ['Flag',                   filing.flag_state || '—'],
    ['Transit',                fmtDirection(filing.transit_direction)],
    ['ETA',                    eta],
    ['LOA (m)',                filing.loa    ?? '—'],
    ['Draft (m)',              filing.draft  ?? '—'],
    ['GT',                     filing.gross_tonnage ?? '—'],
    ['Cargo Class',            filing.dangerous_goods_class ? `IMDG ${filing.dangerous_goods_class}` : 'None'],
    ['Filing Status',          fmtStatus(filing.filing_status)],
    ['Compliance Score',       `${filing.compliance_score ?? '—'} / 100`],
  ];
  y = fieldGrid(doc, summaryFields, y, margin, pageW);
  y += 6;

  // ── Checklist ──────────────────────────────────────────────────────────────
  y = sectionHeader(doc, 'VALIDATION CHECKLIST', y, pageW, margin);

  const checklist = parseChecklist(filing);
  const rowH = 19;
  const colW = pageW - margin*2;

  for (let i = 0; i < checklist.length; i++) {
    const item = checklist[i];
    const bg   = i % 2 === 0 ? C.light : C.white;

    // Check if we need a new page
    if (y + rowH > pageH - 60) {
      doc.addPage();
      y = 40;
    }

    doc.rect(margin, y, colW, rowH).fill(...hex(bg));
    doc.moveTo(margin, y).lineTo(margin+colW, y).strokeColor(...hex(C.border)).lineWidth(0.3).stroke();

    validationBadge(doc, item.status, margin + 4, y + 3);

    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(...hex(C.slate))
      .text(item.name, margin + 62, y + 3, { width: 200, lineBreak: false });

    doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted))
      .text(item.message || item.requirement || '', margin + 265, y + 4, {
        width: colW - 265 - 4,
        lineBreak: false,
      });

    y += rowH;
  }

  y += 8;

  // ── Deadline tracker ──────────────────────────────────────────────────────
  if (filing.deadline_24h || filing.deadline_48h) {
    if (y + 60 > pageH - 60) { doc.addPage(); y = 40; }

    y = sectionHeader(doc, 'FILING DEADLINE TRACKER', y, pageW, margin);

    const now = Date.now();
    const dl24 = filing.deadline_24h ? new Date(filing.deadline_24h) : null;
    const dl48 = filing.deadline_48h ? new Date(filing.deadline_48h) : null;

    const deadlineFields = [
      ['24h SP-1 Deadline',
        dl24 ? `${dl24.toISOString().replace('T',' ').slice(0,16)} UTC${dl24.getTime() < now ? ' [ELAPSED]' : ''}` : '—'],
      ['48h Hazmat Deadline',
        dl48 ? `${dl48.toISOString().replace('T',' ').slice(0,16)} UTC${dl48.getTime() < now ? ' [ELAPSED]' : ''}` : '—'],
    ];
    y = fieldGrid(doc, deadlineFields, y, margin, pageW);
    y += 4;
  }

  // ── Recommendations ────────────────────────────────────────────────────────
  const failures  = checklist.filter(c => c.status === 'fail');
  const warnings  = checklist.filter(c => c.status === 'warning' || c.status === 'warn');

  if (failures.length > 0 || warnings.length > 0) {
    if (y + 30 > pageH - 60) { doc.addPage(); y = 40; }
    y = sectionHeader(doc, 'RECOMMENDED ACTIONS', y, pageW, margin);

    const allIssues = [...failures, ...warnings];
    for (const issue of allIssues) {
      if (y + 18 > pageH - 60) { doc.addPage(); y = 40; }
      const bg = issue.status === 'fail' ? C.failBg : C.warnBg;
      const fg = issue.status === 'fail' ? C.fail   : C.warn;
      const w  = pageW - margin*2;

      doc.rect(margin, y, w, 18).fill(...hex(bg));
      doc.moveTo(margin, y).lineTo(margin, y+18).strokeColor(...hex(fg)).lineWidth(2).stroke();
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(...hex(fg))
        .text(`${issue.status === 'fail' ? '✗' : '⚠'} ${issue.name}`, margin + 8, y + 5, { lineBreak: false });
      doc.fontSize(7).font('Helvetica').fillColor(...hex(C.slate))
        .text(issue.requirement || issue.message || '', margin + 200, y + 6, { width: w - 205, lineBreak: false });
      y += 20;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVesselType(t) {
  if (!t) return '—';
  return t.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtCargoType(t) {
  if (!t) return '—';
  return t.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDirection(d) {
  if (!d) return '—';
  if (d === 'northbound') return 'Northbound (Black Sea → Mediterranean)';
  if (d === 'southbound') return 'Southbound (Mediterranean → Black Sea)';
  return d;
}

function fmtStatus(s) {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse the compliance checklist from the filing.
 * The checklist may be stored as a JSON array in document_data.checklist,
 * or we fall back to a minimal generated checklist.
 */
function parseChecklist(filing) {
  try {
    const dd = typeof filing.document_data === 'string'
      ? JSON.parse(filing.document_data || '{}')
      : (filing.document_data || {});

    if (Array.isArray(dd.checklist)) return dd.checklist;
    if (Array.isArray(dd.validation?.checklist)) return dd.validation.checklist;
  } catch (_) {}

  // Minimal fallback checklist based on raw filing fields
  const items = [];
  const score = filing.compliance_score ?? 0;

  if (filing.imo_number) {
    items.push({ status: 'pass', name: 'IMO Number', message: `IMO ${filing.imo_number} provided` });
  } else {
    items.push({ status: 'fail', name: 'IMO Number', message: 'IMO number missing', requirement: 'Mandatory for all VTS notifications' });
  }

  if (filing.loa) {
    const loaNum = parseFloat(filing.loa);
    if (loaNum > 300) {
      items.push({ status: 'warn', name: 'Vessel Length', message: `LOA ${loaNum}m — may require special arrangement`, requirement: '>300m requires Turkish authority approval' });
    } else {
      items.push({ status: 'pass', name: 'Vessel Length', message: `LOA ${loaNum}m — within normal limits` });
    }
  }

  if (filing.draft) {
    const draftNum = parseFloat(filing.draft);
    if (draftNum > 15.5) {
      items.push({ status: 'fail', name: 'Draft Limit', message: `Draft ${draftNum}m exceeds 15.5m limit`, requirement: 'Maximum loaded draft: 15.5m' });
    } else {
      items.push({ status: 'pass', name: 'Draft Limit', message: `Draft ${draftNum}m — within 15.5m limit` });
    }
  }

  if (filing.crew_count && parseInt(filing.crew_count) >= 2) {
    items.push({ status: 'pass', name: 'Bridge Manning', message: `${filing.crew_count} crew declared` });
  } else {
    items.push({ status: 'warn', name: 'Bridge Manning', message: 'Crew count low or not declared', requirement: 'Minimum 2 bridge officers required' });
  }

  if (filing.agent_name) {
    items.push({ status: 'pass', name: 'Local Agent', message: `Agent: ${filing.agent_name}` });
  } else {
    items.push({ status: 'warn', name: 'Local Agent', message: 'No agent contact specified', requirement: 'Recommended for VTS liaison' });
  }

  return items;
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = { generateBosporusPDF, ALL_DOC_TYPES, DOC_META };
