/**
 * panama-pdf-generator.js — Panama Canal Filing PDF Generator
 *
 * Owns: PDF generation for VUMPA (pre-arrival notification) and PCSOPEP
 *   (Panama Canal Spill Oil Emergency Plan declaration) filings.
 * Does NOT own: database access, validation logic, route handling, or email.
 *
 * Produces A4 PDFs suitable for submission to ACP (Autoridad del Canal de Panamá)
 * via VUMPA (Ventanilla Única Marítima de Panamá).
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
};

// ── Document metadata ─────────────────────────────────────────────────────────

const DOC_META = {
  vumpa_pre_arrival: {
    title:    'VUMPA PRE-ARRIVAL NOTIFICATION',
    subtitle: 'ACP Maritime Single Window — VUMPA Pre-Arrival Mandatory Filing',
    form:     'ACP/VUMPA-01/2026',
  },
  pcsopep_plan: {
    title:    'PCSOPEP DECLARATION',
    subtitle: 'Panama Canal Spill Oil Emergency Plan — Master & ACP Compliance Declaration',
    form:     'ACP/PCSOPEP-02/2026',
  },
  crew_manifest: {
    title:    'CREW MANIFEST',
    subtitle: 'Panama Canal Authority — Crew List (STCW / IMO FAL Form 5)',
    form:     'ACP/CM-03/2026',
  },
  cargo_declaration: {
    title:    'CARGO DECLARATION',
    subtitle: 'Panama Canal Authority — Cargo & Bill of Lading Summary',
    form:     'ACP/CD-04/2026',
  },
};

const ALL_DOC_TYPES = Object.keys(DOC_META);

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer for a Panama Canal filing.
 *
 * @param {object} filing   Row from filings table (canal = 'panama')
 * @param {string} docType  Key from DOC_META, or 'all' for complete package
 * @returns {Promise<Buffer>}
 */
async function generatePanamaPDF(filing, docType) {
  const doc = new PDFDocument({
    size:   'A4',
    margin: 0,
    info: {
      Title:    `${BRAND.name} — ${docType === 'all' ? 'Panama Canal Complete Filing Package' : (DOC_META[docType]?.title || docType)}`,
      Author:   BRAND.name,
      Subject:  `Panama Canal Filing — ${filing.vessel_name || 'Unknown Vessel'} — ${filing.reference_number || filing.id}`,
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
    case 'vumpa_pre_arrival':
      renderVumpaPreArrival(doc, filing, margin, pageW, pageH);
      break;
    case 'pcsopep_plan':
      renderPcsopep(doc, filing, margin, pageW, pageH);
      break;
    case 'crew_manifest':
      renderCrewManifest(doc, filing, margin, pageW, pageH);
      break;
    case 'cargo_declaration':
      renderCargoDeclaration(doc, filing, margin, pageW, pageH);
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
  const refNum = filing.reference_number || `CC-ACP-${String(filing.id).padStart(6,'0')}`;

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
    'CONFIDENTIAL — FOR ACP/VUMPA SUBMISSION ONLY',
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

// ── VUMPA Pre-Arrival Notification renderer ───────────────────────────────────

function renderVumpaPreArrival(doc, filing, margin, pageW, pageH) {
  const dd = parseDocData(filing);
  let y = doc.y;

  y = noteBox(
    doc,
    'File via: ACP Maritime Service Portal (msp.pancanal.com)  |  ETA window: 96h min before Balboa/Cristóbal anchorage',
    y, margin, pageW, C.orangeBg
  );
  y += 4;

  // ── Section 1: Vessel Particulars ──────────────────────────────────────────
  y = sectionHeader(doc, '1. VESSEL PARTICULARS', y, pageW, margin);

  const vesselFields = [
    ['Vessel Name',              filing.vessel_name          || '—'],
    ['IMO Number',               filing.imo_number           || '—'],
    ['Call Sign',                dd.call_sign                || '—'],
    ['Flag State',               filing.flag_state           || '—'],
    ['Vessel Type',              fmtType(filing.vessel_type)],
    ['Classification Society',   filing.classification_society || '—'],
    ['Length Overall (m)',        filing.loa                  ?? '—'],
    ['Beam (m)',                  filing.beam                 ?? '—'],
    ['Draft (m)',                 filing.draft                ?? '—'],
    ['Gross Tonnage (GT)',        filing.gross_tonnage        ?? '—'],
    ['PC/UMS Net Tonnage',        dd.pcums_nt                 || '—'],
    ['Air Draft (m)',             dd.air_draft                || '—'],
  ];
  y = fieldGrid(doc, vesselFields, y, margin, pageW);
  y += 4;

  // ── Section 2: Transit Information ────────────────────────────────────────
  y = sectionHeader(doc, '2. TRANSIT INFORMATION', y, pageW, margin);

  const eta = dd.eta
    ? new Date(dd.eta).toISOString().replace('T',' ').slice(0,16) + ' UTC'
    : (filing.submitted_at ? new Date(filing.submitted_at).toISOString().slice(0,16) + ' UTC' : '—');

  const transitFields = [
    ['Transit Direction',        fmtDirection(dd.transit_direction)],
    ['ETA at Anchorage',         eta],
    ['Last Port of Call',        dd.last_port        || '—'],
    ['Next Port of Call',        dd.next_port        || '—'],
    ['Requested Transit Date',   dd.transit_date     || '—'],
    ['Lock Type',                fmtLockType(dd.lock_type)],
    ['Tug Assistance Required',  dd.tugs_required ? 'YES' : 'No'],
  ];
  y = fieldGrid(doc, transitFields, y, margin, pageW);
  y += 4;

  // ── Section 3: Cargo Information ──────────────────────────────────────────
  if (y + 60 < pageH - 60) {
    y = sectionHeader(doc, '3. CARGO INFORMATION', y, pageW, margin);

    const cargoFields = [
      ['Cargo Type',             fmtType(dd.cargo_type || filing.vessel_type)],
      ['Total Quantity (MT)',    dd.cargo_quantity      ?? '—'],
      ['Bill of Lading No.',     dd.bill_of_lading_no   || '—'],
      ['In Ballast',             dd.in_ballast ? 'YES — Ballast voyage' : 'No'],
      ['Dangerous Goods',        dd.has_dg ? `YES — IMDG Class ${dd.dg_class || 'declared'}` : 'None declared'],
      ['DG UN Number',           dd.dg_un_number        || '—'],
    ];
    y = fieldGrid(doc, cargoFields, y, margin, pageW);
    y += 4;
  }

  // ── Section 4: Crew Summary ────────────────────────────────────────────────
  if (y + 50 < pageH - 60) {
    y = sectionHeader(doc, '4. CREW SUMMARY', y, pageW, margin);

    const crewFields = [
      ['Total Crew',             dd.crew_count    ?? '—'],
      ['Passengers',             dd.pax_count     ?? 0],
      ['Master / Captain',       dd.master_name   || '—'],
      ['Master Nationality',     dd.master_nat    || '—'],
    ];
    y = fieldGrid(doc, crewFields, y, margin, pageW);
    y += 4;
  }

  // ── Section 5: Agent & Contact ────────────────────────────────────────────
  if (y + 40 < pageH - 60) {
    y = sectionHeader(doc, '5. PANAMA AGENT', y, pageW, margin);

    const agentFields = [
      ['Agency Name',           dd.agent_name    || '—'],
      ['Agent Contact',         dd.agent_contact || '—'],
      ['Agency VUMPA Code',     dd.agent_code    || '—'],
    ];
    y = fieldGrid(doc, agentFields, y, margin, pageW);
    y += 4;
  }

  // ── Section 6: Declaration ─────────────────────────────────────────────────
  if (y + 60 < pageH - 60) {
    y = sectionHeader(doc, '6. MASTER\'S DECLARATION', y, pageW, margin);
    const declW = pageW - margin*2;
    doc.rect(margin, y, declW, 46).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
      .text(
        'I certify that all particulars in this pre-arrival notification are correct and complete to the best of my knowledge. ' +
        'The vessel, its equipment, crew and cargo comply with all applicable ACP regulations and international maritime conventions. ' +
        'I understand that any false declaration may result in rejection or penalties under ACP Maritime Regulations.',
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
    doc.text('Authorized Agent / Date',         margin + colW, sigY + 28, { lineBreak: false });
  }
}

// ── PCSOPEP Declaration renderer ─────────────────────────────────────────────

function renderPcsopep(doc, filing, margin, pageW, pageH) {
  const dd = parseDocData(filing);
  let y = doc.y;

  y = noteBox(
    doc,
    'ACP Requirement: Current PCSOPEP must be signed by serving master, ACP-approved, and attached to VUMPA filing as PDF upload.',
    y, margin, pageW, C.orangeBg
  );
  y += 4;

  y = sectionHeader(doc, 'VESSEL & PCSOPEP REFERENCE', y, pageW, margin);

  const pcsopepFields = [
    ['Vessel Name',             filing.vessel_name             || '—'],
    ['IMO Number',              filing.imo_number              || '—'],
    ['Flag State',              filing.flag_state              || '—'],
    ['Vessel Type',             fmtType(filing.vessel_type)],
    ['PCSOPEP Document No.',    dd.pcsopep_doc_no              || '—'],
    ['ACP Approval No.',        dd.pcsopep_acp_approval        || '—'],
    ['PCSOPEP Issue Date',      dd.pcsopep_issue_date          || '—'],
    ['PCSOPEP Expiry Date',     dd.pcsopep_expiry_date         || '—'],
    ['Qualified Individual',    dd.pcsopep_qi_name             || '—'],
    ['QI Company',              dd.pcsopep_qi_company          || '—'],
    ['QI 24h Phone',            dd.pcsopep_qi_phone            || '—'],
    ['Response Contractor',     dd.pcsopep_contractor          || '—'],
    ['Shipboard SOPEP Last Rev.',dd.sopep_revision_date        || '—'],
    ['Master Name',             dd.master_name                 || '—'],
    ['Master Signature Date',   dd.pcsopep_master_signed_date  || '—'],
  ];
  y = fieldGrid(doc, pcsopepFields, y, margin, pageW);
  y += 6;

  // Worst case discharge scenarios
  y = sectionHeader(doc, 'WORST-CASE DISCHARGE SCENARIO', y, pageW, margin);

  const wcdFields = [
    ['Fuel Oil Volume (MT)',    dd.wcd_fuel_oil             ?? '—'],
    ['Cargo Oil Volume (MT)',   dd.wcd_cargo_oil            ?? '—'],
    ['Total WCD Volume (MT)',   dd.wcd_total                ?? '—'],
    ['Tank Capacity (MT)',      dd.tank_capacity            ?? '—'],
    ['Double Bottom Tanks',     dd.double_bottom ? 'YES' : 'No'],
    ['Segregated Ballast',      dd.segregated_ballast ? 'YES' : 'No'],
  ];
  y = fieldGrid(doc, wcdFields, y, margin, pageW);
  y += 6;

  // Declaration box
  if (y + 60 < pageH - 60) {
    y = sectionHeader(doc, 'MASTER\'S PCSOPEP DECLARATION', y, pageW, margin);
    const declW = pageW - margin*2;
    doc.rect(margin, y, declW, 46).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.slate))
      .text(
        'I declare that the above PCSOPEP is current, ACP-approved, and has been reviewed with all officers and crew. ' +
        'The vessel carries sufficient response equipment and the Qualified Individual has been briefed on Panama Canal transit procedures. ' +
        'The plan is available on the bridge and in the engine room.',
        margin + 6, y + 6, { width: declW - 12 }
      );
    y += 50;

    const sigY = y + 4;
    doc.moveTo(margin, sigY + 24).lineTo(margin + 200, sigY + 24)
      .strokeColor(...hex(C.border)).lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica').fillColor(...hex(C.muted));
    doc.text('Master Signature / Date', margin, sigY + 28, { lineBreak: false });
  }
}

// ── Crew Manifest renderer ────────────────────────────────────────────────────

function renderCrewManifest(doc, filing, margin, pageW, pageH) {
  const dd = parseDocData(filing);
  let y = doc.y;

  y = sectionHeader(doc, 'VESSEL PARTICULARS', y, pageW, margin);

  const vesselFields = [
    ['Vessel Name',  filing.vessel_name || '—'],
    ['IMO Number',   filing.imo_number  || '—'],
    ['Flag State',   filing.flag_state  || '—'],
    ['Call Sign',    dd.call_sign       || '—'],
    ['Gross Tonnage',filing.gross_tonnage ?? '—'],
    ['Crew Total',   dd.crew_count      ?? '—'],
  ];
  y = fieldGrid(doc, vesselFields, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'CREW LIST (IMO FAL FORM 5)', y, pageW, margin);

  // Table header
  const tableW = pageW - margin*2;
  const cols   = [['#', 18], ['Name / Rank', 160], ['Nationality', 68], ['Cert No.', 90], ['STCW Expiry', 80], ['DOB', 60]];
  let cx = margin;

  doc.rect(margin, y, tableW, 16).fill(...hex(C.navy));
  for (const [label, w] of cols) {
    doc.fontSize(7).font('Helvetica-Bold').fillColor(...hex(C.teal))
      .text(label, cx + 3, y + 4, { width: w - 4, lineBreak: false });
    cx += w;
  }
  y += 16;

  const crewList = Array.isArray(dd.crew_list) ? dd.crew_list : [];

  if (crewList.length === 0) {
    doc.rect(margin, y, tableW, 18).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.muted))
      .text('Crew list not available in filing data. Attach separately per IMO FAL Form 5.', margin + 6, y + 5, { width: tableW - 10 });
    y += 20;
  } else {
    for (let i = 0; i < crewList.length; i++) {
      if (y + 16 > pageH - 60) { doc.addPage(); y = 40; }
      const m = crewList[i];
      const bg = i % 2 === 0 ? C.light : C.white;
      doc.rect(margin, y, tableW, 16).fill(...hex(bg));
      doc.moveTo(margin, y).lineTo(margin+tableW, y).strokeColor(...hex(C.border)).lineWidth(0.3).stroke();

      const row = [
        String(i + 1),
        `${m.name || '—'} / ${m.rank || '—'}`,
        m.nationality || '—',
        m.cert_number  || '—',
        m.stcw_expiry  || '—',
        m.dob          || '—',
      ];
      cx = margin;
      for (let ci = 0; ci < cols.length; ci++) {
        doc.fontSize(7).font('Helvetica').fillColor(...hex(C.slate))
          .text(row[ci], cx + 3, y + 4, { width: cols[ci][1] - 4, lineBreak: false });
        cx += cols[ci][1];
      }
      y += 16;
    }
  }

  y += 8;
  doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.muted))
    .text('Certification: All crew members hold valid STCW certificates as required by the International Convention on Standards of Training, Certification and Watchkeeping for Seafarers.', margin, y, { width: tableW });
}

// ── Cargo Declaration renderer ────────────────────────────────────────────────

function renderCargoDeclaration(doc, filing, margin, pageW, pageH) {
  const dd = parseDocData(filing);
  let y = doc.y;

  y = sectionHeader(doc, 'CARGO SUMMARY', y, pageW, margin);

  const cargoSummary = [
    ['Vessel Name',          filing.vessel_name             || '—'],
    ['IMO Number',           filing.imo_number              || '—'],
    ['Transit Direction',    fmtDirection(dd.transit_direction)],
    ['Total Cargo (MT)',     dd.cargo_quantity              ?? '—'],
    ['Cargo Type',           fmtType(dd.cargo_type)],
    ['In Ballast',           dd.in_ballast ? 'YES' : 'No'],
    ['Dangerous Goods',      dd.has_dg ? `YES — Class ${dd.dg_class}` : 'None'],
    ['Number of B/L',        dd.bl_count                    ?? '—'],
  ];
  y = fieldGrid(doc, cargoSummary, y, margin, pageW);
  y += 6;

  y = sectionHeader(doc, 'BILL OF LADING SUMMARY', y, pageW, margin);

  const blList = Array.isArray(dd.bills_of_lading) ? dd.bills_of_lading : [];
  const tableW = pageW - margin*2;

  // Table header
  const cols = [['B/L Number', 140], ['Description', 180], ['Quantity (MT)', 90], ['Consignee', 105]];
  let cx = margin;
  doc.rect(margin, y, tableW, 16).fill(...hex(C.navy));
  for (const [label, w] of cols) {
    doc.fontSize(7).font('Helvetica-Bold').fillColor(...hex(C.teal))
      .text(label, cx + 3, y + 4, { width: w - 4, lineBreak: false });
    cx += w;
  }
  y += 16;

  if (blList.length === 0) {
    doc.rect(margin, y, tableW, 18).fill(...hex(C.light));
    doc.fontSize(7.5).font('Helvetica').fillColor(...hex(C.muted))
      .text('Bill of lading details not captured in this filing. Attach cargo manifest separately.', margin + 6, y + 5, { width: tableW - 10 });
    y += 20;
  } else {
    for (let i = 0; i < blList.length; i++) {
      if (y + 16 > pageH - 60) { doc.addPage(); y = 40; }
      const bl = blList[i];
      const bg = i % 2 === 0 ? C.light : C.white;
      doc.rect(margin, y, tableW, 16).fill(...hex(bg));
      doc.moveTo(margin, y).lineTo(margin+tableW, y).strokeColor(...hex(C.border)).lineWidth(0.3).stroke();

      const row = [bl.bl_number || '—', bl.description || '—', bl.quantity || '—', bl.consignee || '—'];
      cx = margin;
      for (let ci = 0; ci < cols.length; ci++) {
        doc.fontSize(7).font('Helvetica').fillColor(...hex(C.slate))
          .text(row[ci], cx + 3, y + 4, { width: cols[ci][1] - 4, lineBreak: false });
        cx += cols[ci][1];
      }
      y += 16;
    }
  }

  // DG section if applicable
  if (dd.has_dg) {
    y += 8;
    y = sectionHeader(doc, 'DANGEROUS GOODS DECLARATION', y, pageW, margin);

    const dgFields = [
      ['IMDG Class',    dd.dg_class        || '—'],
      ['UN Number',     dd.dg_un_number    || '—'],
      ['Proper Name',   dd.dg_proper_name  || '—'],
      ['Packing Group', dd.dg_packing_grp  || '—'],
      ['Stow Location', dd.dg_stow         || '—'],
      ['Quantity (MT)', dd.dg_quantity     ?? '—'],
    ];
    y = fieldGrid(doc, dgFields, y, margin, pageW);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDocData(filing) {
  try {
    return typeof filing.document_data === 'string'
      ? JSON.parse(filing.document_data || '{}')
      : (filing.document_data || {});
  } catch (_) {
    return {};
  }
}

function fmtType(t) {
  if (!t) return '—';
  return t.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fmtDirection(d) {
  if (!d) return '—';
  if (d === 'northbound') return 'Northbound (Balboa → Cristóbal)';
  if (d === 'southbound') return 'Southbound (Cristóbal → Balboa)';
  return d;
}

function fmtLockType(t) {
  if (!t) return '—';
  if (t === 'neopanamax') return 'Neo-Panamax (New Locks)';
  if (t === 'panamax')    return 'Panamax (Original Locks)';
  return t;
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = { generatePanamaPDF, ALL_DOC_TYPES, DOC_META };
