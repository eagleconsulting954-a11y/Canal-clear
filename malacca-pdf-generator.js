/**
 * malacca-pdf-generator.js — Strait of Malacca STRAITREP PDF Generator
 *
 * Owns: PDF generation for STRAITREP (ship reporting) and MARPOL compliance
 *   documents for Strait of Malacca & Singapore transits.
 * Does NOT own: database access, validation logic, route handling, or email.
 *
 * Produces A4 PDFs suitable for submission to:
 *   - MESASRCC (Malaysia Rescue Coordination Centre) via STRAITREP
 *   - MPA Singapore (Maritime and Port Authority)
 *   - MARDEP Malaysia (Marine Department)
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

// ── Color palette ─────────────────────────────────────────────────────────────

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
  gold:    '#B7791F',
  goldBg:  '#FEFCBF',
  // Malacca accent — blue-green representing the strait waters
  strait:  '#0891B2',
  straitBg:'#E0F2FE',
};

// ── Document metadata ─────────────────────────────────────────────────────────

const DOC_META = {
  straitrep_notification: {
    title:    'STRAITREP NOTIFICATION',
    subtitle: 'Strait of Malacca & Singapore Ship Reporting System — Mandatory Entry Notification',
    form:     'MESASRCC/STRAITREP-01/2026',
  },
  marpol_compliance: {
    title:    'MARPOL COMPLIANCE DECLARATION',
    subtitle: 'Strait of Malacca — MARPOL Annex I/V Pollution Prevention Compliance',
    form:     'MPA-SG/MARPOL-02/2026',
  },
};

const ALL_DOC_TYPES = Object.keys(DOC_META);

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer for a Malacca STRAITREP filing.
 *
 * @param {object} filing   Row from malacca_filings table
 * @param {string} docType  Key from DOC_META, or 'all' for complete package
 * @returns {Promise<Buffer>}
 */
async function generateMalaccaPDF(filing, docType) {
  const doc = new PDFDocument({
    size:   'A4',
    margin: 0,
    info: {
      Title:    `${BRAND.name} — ${docType === 'all' ? 'Malacca STRAITREP Filing Package' : (DOC_META[docType]?.title || docType)}`,
      Author:   BRAND.name,
      Subject:  `Strait of Malacca Filing — ${filing.vessel_name || 'Unknown Vessel'} — ${filing.id}`,
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
    case 'straitrep_notification':
      renderStraitrepNotification(doc, filing, margin, pageW, pageH);
      break;
    case 'marpol_compliance':
      renderMarpolCompliance(doc, filing, margin, pageW, pageH);
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

  // Strait designation badge
  doc.fontSize(7).font('Helvetica-Bold')
    .fillColor(...hex(C.strait))
    .text('STRAIT OF MALACCA & SINGAPORE', margin, 38, { width: pageW - margin*2, align: 'right', lineBreak: false });

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
  const refNum = `CC-MLS-${String(filing.id).padStart(6,'0')}`;

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
    'CONFIDENTIAL — FOR MESASRCC/MPA STRAITREP SUBMISSION ONLY',
    margin + 180, footerY + 8,
    { lineBreak: false, align: 'center', width: pageW - margin*2 - 180 }
  );
  doc.text('Page 1', pageW - margin - 40, footerY + 8, { lineBreak: false });
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function sectionHeader(doc, title, y, pageW, margin) {
  doc.rect(margin, y, pageW - margin*2, 18).fill(...hex(C.navy));
  doc.fontSize(8).font('Helvetica-Bold').fillColor(...hex(C.teal))
    .text(title, margin + 6, y + 5, { lineBreak: false });
  return y + 22;
}

function fieldRow(doc, label, value, x, y, w, rowHeight, isEven) {
  doc.rect(x, y, w, rowHeight).fill(...hex(isEven ? C.light : C.white));
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
  const rowH = 18;
  const colW = (pageW - margin*2) / 2;
  let y = startY, col = 0;

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

function noteBox(doc, text, y, margin, pageW, color = C.warnBg) {
  const w = pageW - margin*2;
  doc.rect(margin, y, w, 22).fill(...hex(color));
  doc.moveTo(margin, y).lineTo(margin, y+22).strokeColor(...hex(C.orange)).lineWidth(2).stroke();
  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
    .text(text, margin + 8, y + 7, { width: w - 12, lineBreak: false });
  return y + 26;
}

// ── STRAITREP Notification renderer ──────────────────────────────────────────

function renderStraitrepNotification(doc, filing, margin, pageW, pageH) {
  let y = doc.y;

  y = noteBox(
    doc,
    'Transmit via: MESASRCC Kuala Lumpur (+60 3 2051 4599) or MPA Singapore VTS (+65 6226 9630)  |  File ≥3h before entry',
    y, margin, pageW, C.orangeBg
  );
  y += 4;

  // ── Section A: Vessel Particulars ─────────────────────────────────────────
  y = sectionHeader(doc, 'A. VESSEL IDENTIFICATION (STRAITREP SECTION A)', y, pageW, margin);

  const vesselFields = [
    ['Vessel Name',              filing.vessel_name           || '—'],
    ['IMO Number',               filing.imo_number            || '—'],
    ['Radio Call Sign',          filing.call_sign             || '—'],
    ['MMSI',                     filing.mmsi                  || '—'],
    ['Flag State',               filing.flag_state            || '—'],
    ['Vessel Type',              fmtType(filing.vessel_type)],
    ['Gross Tonnage (GT)',        filing.gross_tonnage         ?? '—'],
    ['Length Overall (m)',        filing.loa                   ?? '—'],
    ['Beam (m)',                  filing.beam                  ?? '—'],
    ['Draft (m)',                 filing.draft                 ?? '—'],
  ];
  y = fieldGrid(doc, vesselFields, y, margin, pageW);
  y += 4;

  // ── Section B: Transit Information ───────────────────────────────────────
  y = sectionHeader(doc, 'B. TRANSIT INFORMATION (STRAITREP SECTION B)', y, pageW, margin);

  const eta = filing.estimated_arrival
    ? new Date(filing.estimated_arrival).toISOString().replace('T',' ').slice(0,16) + ' UTC'
    : '—';

  const transitFields = [
    ['Transit Direction',        fmtDirection(filing.transit_direction)],
    ['Reporting Point',          fmtReportingPoint(filing.reporting_point)],
    ['ETA at Reporting Point',   eta],
    ['Last Port of Call',        filing.last_port             || '—'],
    ['Next Port of Call',        filing.next_port             || '—'],
    ['Speed Through Strait',     filing.speed_through ? `${filing.speed_through} knots` : '—'],
  ];
  y = fieldGrid(doc, transitFields, y, margin, pageW);
  y += 4;

  // ── Section C: Cargo ─────────────────────────────────────────────────────
  if (y + 60 < pageH - 60) {
    y = sectionHeader(doc, 'C. CARGO & DANGEROUS GOODS (STRAITREP SECTION C)', y, pageW, margin);

    const dg = filing.has_dangerous_goods;
    const cargoFields = [
      ['Cargo Type',             fmtType(filing.cargo_type)],
      ['Cargo Quantity (MT)',    filing.cargo_quantity        ?? '—'],
      ['In Ballast',             filing.in_ballast ? 'YES — Ballast voyage' : 'No'],
      ['Dangerous Goods',        dg ? `YES — IMDG Class ${filing.dangerous_goods_class || 'declared'}` : 'None declared'],
      ['DG UN Number',           dg ? (filing.dg_un_number   || '—') : '—'],
      ['DG Proper Name',         dg ? (filing.dg_proper_name || '—') : '—'],
    ];
    y = fieldGrid(doc, cargoFields, y, margin, pageW);
    y += 4;
  }

  // ── Section D: People & Pilot ─────────────────────────────────────────────
  if (y + 50 < pageH - 60) {
    y = sectionHeader(doc, 'D. CREW, MASTER & PILOTAGE', y, pageW, margin);

    const peopleFields = [
      ['Total Crew',             filing.crew_count            ?? '—'],
      ['Master / Captain',       filing.master_name           || '—'],
      ['Pilot Required',         filing.pilot_required ? 'YES — Compulsory' : 'No'],
      ['Pilot Embarkation',      filing.pilot_embark_point ? fmtType(filing.pilot_embark_point) : '—'],
    ];
    y = fieldGrid(doc, peopleFields, y, margin, pageW);
    y += 4;
  }

  // ── Section E: Agent ──────────────────────────────────────────────────────
  if (y + 40 < pageH - 60) {
    y = sectionHeader(doc, 'E. PORT AGENT (MALAYSIA / SINGAPORE)', y, pageW, margin);

    const agentFields = [
      ['Agency Name',            filing.agent_name            || '—'],
      ['Agent Contact',          filing.agent_contact         || '—'],
    ];
    y = fieldGrid(doc, agentFields, y, margin, pageW);
    y += 4;
  }

  // ── Deadline summary ──────────────────────────────────────────────────────
  if (y + 50 < pageH - 60 && filing.estimated_arrival) {
    y = sectionHeader(doc, 'F. NOTIFICATION DEADLINES', y, pageW, margin);

    const d3h  = filing.deadline_3h  ? new Date(filing.deadline_3h).toISOString().replace('T',' ').slice(0,16)+' UTC' : '—';
    const d24h = filing.deadline_24h ? new Date(filing.deadline_24h).toISOString().replace('T',' ').slice(0,16)+' UTC' : '—';
    const d48h = filing.deadline_48h ? new Date(filing.deadline_48h).toISOString().replace('T',' ').slice(0,16)+' UTC' : '—';

    const deadlineFields = [
      ['STRAITREP (3h before entry)',    d3h],
      ['DG 24h advance (if applicable)', d24h],
      ['DG 48h advance (hazmat)',        d48h],
    ];
    y = fieldGrid(doc, deadlineFields, y, margin, pageW);
    y += 4;
  }

  // ── Master's declaration ──────────────────────────────────────────────────
  if (y + 60 < pageH - 60) {
    y = sectionHeader(doc, 'G. MASTER\'S DECLARATION', y, pageW, margin);
    const declW = pageW - margin*2;
    doc.rect(margin, y, declW, 46).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
      .text(
        'I certify that the information in this STRAITREP notification is accurate to the best of my knowledge. ' +
        'The vessel complies with MARPOL requirements, TSS Traffic Separation Scheme rules, ' +
        'and all applicable Singapore and Malaysia port state regulations. ' +
        'I understand that submission does not constitute clearance — the vessel must maintain continuous VHF Ch. 16 watch.',
        margin + 6, y + 6, { width: declW - 12 }
      );
    y += 50;

    const sigY = y + 4;
    const colW = (pageW - margin*2) / 2;
    doc.moveTo(margin, sigY + 24).lineTo(margin + colW - 20, sigY + 24)
      .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
    doc.moveTo(margin + colW, sigY + 24).lineTo(pageW - margin, sigY + 24)
      .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
    doc.text('Master Signature / Date',         margin,        sigY + 28, { lineBreak: false });
    doc.text('Port Agent / Date',               margin + colW, sigY + 28, { lineBreak: false });
  }
}

// ── MARPOL Compliance Declaration renderer ────────────────────────────────────

function renderMarpolCompliance(doc, filing, margin, pageW, pageH) {
  let y = doc.y;

  y = noteBox(
    doc,
    'MARPOL Annex I (Oil Pollution) and Annex V (Garbage) compliance required for all vessels transiting TSS Malacca.',
    y, margin, pageW, C.straitBg
  );
  y += 4;

  y = sectionHeader(doc, 'VESSEL & VOYAGE DETAILS', y, pageW, margin);

  const vesselFields = [
    ['Vessel Name',             filing.vessel_name              || '—'],
    ['IMO Number',              filing.imo_number               || '—'],
    ['Flag State',              filing.flag_state               || '—'],
    ['Vessel Type',             fmtType(filing.vessel_type)],
    ['Gross Tonnage',           filing.gross_tonnage            ?? '—'],
    ['Transit Direction',       fmtDirection(filing.transit_direction)],
    ['Last Port',               filing.last_port                || '—'],
    ['Next Port',               filing.next_port                || '—'],
  ];
  y = fieldGrid(doc, vesselFields, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'MARPOL ANNEX I — OIL POLLUTION PREVENTION', y, pageW, margin);

  const annexIFields = [
    ['Oil Record Book Current',    'Confirmed (Master Declaration)'],
    ['Oily Water Separator',       'Operational (15ppm requirement)'],
    ['Oil Discharge Monitor',      'Calibrated and functional'],
    ['Slop Tanks Capacity',        'As per approved IOPP Certificate'],
    ['MARPOL Compliance Status',   filing.marpol_compliance !== false ? 'COMPLIANT' : 'NOT CONFIRMED'],
  ];
  y = fieldGrid(doc, annexIFields, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'MARPOL ANNEX V — GARBAGE MANAGEMENT', y, pageW, margin);

  const annexVFields = [
    ['Garbage Management Plan',    filing.garbage_plan ? 'YES — Written plan on board' : 'NOT CONFIRMED'],
    ['Garbage Record Book',        'Maintained per MARPOL requirements'],
    ['Plastics Disposal',          'PROHIBITED — all seas'],
    ['Food Waste Outside 12nm',    'As permitted by flag state rules'],
    ['Port Reception Facilities',  'Planned at next port of call'],
  ];
  y = fieldGrid(doc, annexVFields, y, margin, pageW);
  y += 6;

  // Declaration
  if (y + 70 < pageH - 60) {
    y = sectionHeader(doc, 'MASTER\'S MARPOL DECLARATION', y, pageW, margin);
    const declW = pageW - margin*2;
    doc.rect(margin, y, declW, 52).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
      .text(
        'I declare that this vessel is in full compliance with MARPOL Annex I and Annex V requirements. ' +
        'The Oil Record Book is current and available for inspection. A written Garbage Management Plan is maintained on board. ' +
        'No unlawful discharges have occurred during this voyage. ' +
        'The vessel and crew are familiar with MARPOL requirements applicable in the Strait of Malacca and Singapore.',
        margin + 6, y + 6, { width: declW - 12 }
      );
    y += 56;

    const sigY = y + 4;
    doc.moveTo(margin, sigY + 24).lineTo(margin + 200, sigY + 24)
      .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
    doc.text('Master Signature / Date', margin, sigY + 28, { lineBreak: false });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtType(t) {
  if (!t) return '—';
  return t.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDirection(d) {
  if (!d) return '—';
  if (d === 'eastbound') return 'Eastbound (Indian Ocean → Singapore / South China Sea)';
  if (d === 'westbound') return 'Westbound (South China Sea / Singapore → Indian Ocean)';
  return d;
}

function fmtReportingPoint(p) {
  if (!p) return '—';
  const map = {
    one_fathom_bank: 'One Fathom Bank (Malaysia — westbound entry)',
    raffles_light:   'Raffles Light (Singapore — eastbound entry)',
    iyu_kecil:       'Iyu Kecil (Thailand-Malaysia border — northern approach)',
    pulau_pejantan:  'Pulau Pejantan (southern Malacca approach)',
  };
  return map[p] || p.replace(/_/g,' ');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = { generateMalaccaPDF, ALL_DOC_TYPES, DOC_META };
