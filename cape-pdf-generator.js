/**
 * cape-pdf-generator.js — Cape of Good Hope ISPS Pre-Arrival PDF Generator
 *
 * Owns: PDF generation for ISPS pre-arrival notifications filed with SAMSA
 *   (South African Maritime Safety Authority) under Marine Notice 12 of 2008.
 * Does NOT own: database access, validation logic, route handling, or email.
 *
 * Produces A4 PDFs suitable for submission to:
 *   - SAMSA (South African Maritime Safety Authority)
 *   - Transnet National Ports Authority (South Africa)
 *   - Cape Town / Port Elizabeth / Durban port captains
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
  orange:  '#E85A00',  // Cape accent (burnt orange — rugged South African coastline)
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
  gold:    '#B7791F',
  goldBg:  '#FEFCBF',
  capeSea: '#0369A1',  // Deep Atlantic/Indian Ocean blue
  capeSeaBg: '#E0F2FE',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toUTCString().replace(' GMT', ' UTC');
  } catch (_) { return String(v); }
}

function fmtNum(v, unit = '') {
  if (v === undefined || v === null || v === '') return '—';
  return `${Number(v).toLocaleString()}${unit ? ' ' + unit : ''}`;
}

function safe(v) {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}

function ispsLevelLabel(level) {
  const labels = { 1: 'MARSEC Level 1 (Normal)', 2: 'MARSEC Level 2 (Heightened)', 3: 'MARSEC Level 3 (Exceptional)' };
  return labels[parseInt(level)] || `Level ${level}`;
}

// ── PDF drawing primitives ─────────────────────────────────────────────────────

function drawHeader(doc, filing) {
  // Navy header bar
  doc.rect(0, 0, doc.page.width, 72).fill(hex(C.navy));

  // Title left
  doc.fillColor(hex(C.white))
    .font('Helvetica-Bold').fontSize(15)
    .text('ISPS PRE-ARRIVAL NOTIFICATION', 50, 20, { width: 350 });

  doc.fillColor(hex(C.orange))
    .font('Helvetica').fontSize(8.5)
    .text('SAMSA Marine Notice 12 of 2008 — Cape of Good Hope', 50, 40, { width: 350 });

  // Top-right brand block
  doc.fillColor(hex(C.white))
    .font('Helvetica-Bold').fontSize(11)
    .text(BRAND.name, doc.page.width - 200, 22, { width: 150, align: 'right' });
  doc.fillColor(hex(C.orange))
    .font('Helvetica').fontSize(7.5)
    .text(BRAND.tagline, doc.page.width - 200, 37, { width: 150, align: 'right' });
  doc.fillColor([0.7, 0.7, 0.7])
    .text(BRAND.url, doc.page.width - 200, 50, { width: 150, align: 'right' });

  // Vessel name banner
  const vesselBannerY = 75;
  doc.rect(0, vesselBannerY, doc.page.width, 28).fill(hex(C.orange));
  doc.fillColor(hex(C.white))
    .font('Helvetica-Bold').fontSize(11)
    .text(
      `${safe(filing.vessel_name)}   IMO ${safe(filing.imo_number)}   Flag: ${safe(filing.flag_state)}`,
      50, vesselBannerY + 7, { width: doc.page.width - 100 }
    );

  doc.y = vesselBannerY + 36;
}

function sectionTitle(doc, label) {
  doc.moveDown(0.7);
  doc.rect(50, doc.y, doc.page.width - 100, 18).fill(hex(C.capeSea));
  doc.fillColor(hex(C.white))
    .font('Helvetica-Bold').fontSize(8)
    .text(label.toUpperCase(), 58, doc.y + 4, { width: doc.page.width - 116 });
  doc.y += 22;
}

function fieldRow(doc, label, value) {
  const lineY = doc.y;
  doc.fillColor(hex(C.muted))
    .font('Helvetica').fontSize(7.5)
    .text(label + ':', 58, lineY, { width: 145 });
  doc.fillColor(hex(C.navy))
    .font('Helvetica-Bold').fontSize(8.5)
    .text(safe(value), 205, lineY, { width: doc.page.width - 260 });
  doc.y = lineY + 14;
}

function twoCol(doc, leftLabel, leftVal, rightLabel, rightVal) {
  const lineY = doc.y;
  const midX  = (doc.page.width) / 2;

  doc.fillColor(hex(C.muted)).font('Helvetica').fontSize(7.5)
    .text(leftLabel + ':', 58, lineY, { width: 120 });
  doc.fillColor(hex(C.navy)).font('Helvetica-Bold').fontSize(8.5)
    .text(safe(leftVal), 180, lineY, { width: midX - 180 });

  doc.fillColor(hex(C.muted)).font('Helvetica').fontSize(7.5)
    .text(rightLabel + ':', midX + 5, lineY, { width: 110 });
  doc.fillColor(hex(C.navy)).font('Helvetica-Bold').fontSize(8.5)
    .text(safe(rightVal), midX + 120, lineY, { width: doc.page.width - midX - 140 });

  doc.y = lineY + 14;
}

function drawScoreBadge(doc, score) {
  const x = doc.page.width - 110;
  const y = 110;
  const radius = 28;

  const color = score >= 80 ? C.pass : score >= 60 ? C.warn : C.fail;
  doc.circle(x, y + radius, radius).fill(hex(color));
  doc.fillColor(hex(C.white)).font('Helvetica-Bold').fontSize(18)
    .text(score, x - 20, y + radius - 10, { width: 40, align: 'center' });
  doc.fillColor(hex(C.white)).font('Helvetica').fontSize(7)
    .text('SCORE', x - 22, y + radius + 12, { width: 44, align: 'center' });
}

function drawChecklistItem(doc, item) {
  const icons  = { pass: '✓', fail: '✗', warning: '!' };
  const colors = { pass: C.pass, fail: '#C53030', warning: '#B7791F' };

  const icon  = icons[item.status]  || '?';
  const color = colors[item.status] || C.muted;

  if (doc.y > doc.page.height - 80) {
    doc.addPage();
    doc.y = 50;
  }

  const rowY = doc.y;
  doc.circle(65, rowY + 5, 6).fill(hex(color));
  doc.fillColor(hex(C.white)).font('Helvetica-Bold').fontSize(7)
    .text(icon, 62, rowY + 1.5, { width: 8, align: 'center' });

  doc.fillColor(hex(color)).font('Helvetica-Bold').fontSize(8)
    .text(item.name, 78, rowY, { width: 160 });
  doc.fillColor(hex(C.slate)).font('Helvetica').fontSize(7.5)
    .text(item.message, 245, rowY, { width: doc.page.width - 295 });

  doc.y = rowY + 16;
}

function drawPortsTable(doc, ports) {
  if (!Array.isArray(ports) || ports.length === 0) {
    fieldRow(doc, 'Last 10 Ports', 'Not declared');
    return;
  }

  sectionTitle(doc, 'Last 10 Ports of Call');

  // Table header
  const hY = doc.y;
  doc.rect(50, hY, doc.page.width - 100, 15).fill(hex(C.slate));
  doc.fillColor(hex(C.white)).font('Helvetica-Bold').fontSize(7)
    .text('#',       56,  hY + 3, { width: 20 })
    .text('Port',    78,  hY + 3, { width: 140 })
    .text('Country', 220, hY + 3, { width: 80 })
    .text('Arrived', 305, hY + 3, { width: 110 })
    .text('Departed', 415, hY + 3, { width: 110 });
  doc.y = hY + 18;

  ports.forEach((p, i) => {
    if (doc.y > doc.page.height - 80) { doc.addPage(); doc.y = 50; }
    const rowY = doc.y;
    if (i % 2 === 0) doc.rect(50, rowY, doc.page.width - 100, 13).fill([0.97, 0.97, 0.97]);

    doc.fillColor(hex(C.navy)).font('Helvetica').fontSize(7.5)
      .text(i + 1,              56,  rowY + 2, { width: 20 })
      .text(safe(p.port),       78,  rowY + 2, { width: 140 })
      .text(safe(p.country),   220,  rowY + 2, { width: 80 })
      .text(fmtDate(p.arrived_at),   305, rowY + 2, { width: 110 })
      .text(fmtDate(p.departed_at),  415, rowY + 2, { width: 110 });
    doc.y = rowY + 15;
  });
}

function drawFooter(doc) {
  const y = doc.page.height - 45;
  doc.rect(0, y, doc.page.width, 45).fill(hex(C.navy));

  const generated = new Date().toUTCString().replace(' GMT', ' UTC');
  doc.fillColor(hex(C.orange))
    .font('Helvetica-Bold').fontSize(7.5)
    .text('SAMSA Marine Notice 12 of 2008 — ISPS Pre-Arrival Notification', 50, y + 8, { width: doc.page.width - 100 });
  doc.fillColor([0.6, 0.6, 0.6])
    .font('Helvetica').fontSize(6.5)
    .text(`Generated by ${BRAND.name} (${BRAND.url}) · ${generated}`, 50, y + 22, { width: doc.page.width - 100 });
  doc.text('For submission to SAMSA / Transnet National Ports Authority · compliance@canalclear.org', 50, y + 33, { width: doc.page.width - 100 });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: generateCapeISPSPDF
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an ISPS pre-arrival PDF for a Cape of Good Hope filing.
 *
 * @param {object} filing        - db row from cape_filings
 * @param {object} validation    - result from validateCapeFiling()
 * @param {object} [opts]
 * @param {string} [opts.type]   - 'isps_pre_arrival' | 'compliance_report'
 * @returns {Buffer}
 */
function generateCapeISPSPDF(filing, validation, opts = {}) {
  const score = (validation && validation.compliance_score) ?? 0;

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 115, bottom: 55, left: 50, right: 50 },
    info: {
      Title: `ISPS Pre-Arrival Notification — ${filing.vessel_name || 'Vessel'} — IMO ${filing.imo_number || ''}`,
      Author: BRAND.name,
      Subject: 'SAMSA Marine Notice 12 of 2008 — Cape of Good Hope ISPS Filing',
      Creator: `${BRAND.name} (${BRAND.url})`,
    },
  });

  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  drawHeader(doc, filing);
  drawScoreBadge(doc, score);

  // ── Filing reference block ────────────────────────────────────────────────
  doc.y = 115;
  twoCol(doc,
    'Filing Reference',   `CAPE-${filing.id || 'DEMO'}-${Date.now().toString(36).toUpperCase()}`,
    'Generated',          fmtDate(new Date())
  );
  twoCol(doc,
    'Regulatory Basis',   'SAMSA Marine Notice 12/2008',
    'Compliance Score',   `${score} / 100`
  );

  // ── Section 1: Vessel identification ──────────────────────────────────────
  sectionTitle(doc, 'Section 1 — Vessel Identification');
  twoCol(doc, 'Vessel Name',    filing.vessel_name, 'IMO Number', `IMO ${filing.imo_number}`);
  twoCol(doc, 'Flag State',     filing.flag_state,  'Call Sign',  filing.call_sign);
  twoCol(doc, 'MMSI',           filing.mmsi,        'Vessel Type', filing.vessel_type);
  twoCol(doc, 'Gross Tonnage',  fmtNum(filing.gross_tonnage, 'GT'),  'Net Tonnage',  fmtNum(filing.net_tonnage, 'NT'));
  twoCol(doc, 'LOA',            fmtNum(filing.loa, 'm'),             'Beam',         fmtNum(filing.beam, 'm'));
  fieldRow(doc, 'Maximum Draft', fmtNum(filing.draft, 'm'));

  // ── Section 2: Voyage details ─────────────────────────────────────────────
  sectionTitle(doc, 'Section 2 — Voyage Details');
  twoCol(doc, 'Port of Origin', filing.port_of_origin, 'Next Port', filing.next_port);
  fieldRow(doc, 'Estimated Arrival (ETA)', fmtDate(filing.estimated_arrival));
  fieldRow(doc, 'Cargo Summary', filing.cargo_summary);
  fieldRow(doc, 'Total Crew', fmtNum(filing.crew_count, 'persons'));

  // ── Section 3: ISPS Security ──────────────────────────────────────────────
  sectionTitle(doc, 'Section 3 — ISPS Security Declaration');
  fieldRow(doc, 'Security Level', ispsLevelLabel(filing.isps_security_level));

  const hasDG = filing.has_dangerous_goods;
  if (hasDG) {
    twoCol(doc, 'Dangerous Goods',  'YES — Declared',  'DG Class', `IMDG Class ${safe(filing.dangerous_goods_class)}`);
    if (filing.dangerous_goods_detail) {
      fieldRow(doc, 'DG Detail', filing.dangerous_goods_detail);
    }
  } else {
    fieldRow(doc, 'Dangerous Goods', 'None declared');
  }

  // ── Section 4: Ship Security Officer ─────────────────────────────────────
  sectionTitle(doc, 'Section 4 — Ship Security Officer (SSO)');
  twoCol(doc, 'SSO Name',    filing.sso_name,    'Contact', filing.sso_contact);
  fieldRow(doc, 'SSO Email', filing.sso_email || '—');

  // ── Section 5: Last 10 Ports ──────────────────────────────────────────────
  let ports10 = filing.last_10_ports;
  if (typeof ports10 === 'string') {
    try { ports10 = JSON.parse(ports10); } catch (_) { ports10 = []; }
  }
  drawPortsTable(doc, ports10);

  // ── Section 6: Compliance checklist ──────────────────────────────────────
  if (validation && validation.checklist) {
    if (doc.y > doc.page.height - 200) { doc.addPage(); doc.y = 50; }
    sectionTitle(doc, 'Section 6 — Compliance Checklist');

    // Summary bar
    const cY = doc.y;
    doc.rect(50, cY, doc.page.width - 100, 22).fill(hex(score >= 80 ? C.passBg : score >= 60 ? C.warnBg : C.failBg));
    const statusLabel = validation.overall_status === 'passed' ? 'COMPLIANT' : validation.overall_status === 'warning' ? 'WARNING' : 'FAILED';
    doc.fillColor(hex(score >= 80 ? C.pass : score >= 60 ? C.warn : C.fail)).font('Helvetica-Bold').fontSize(9)
      .text(
        `${statusLabel}  ·  Score ${score}/100  ·  ${validation.passed_checks} passed  ·  ${validation.failed_checks} failed  ·  ${validation.warning_checks} warnings`,
        58, cY + 6, { width: doc.page.width - 120 }
      );
    doc.y = cY + 28;

    for (const item of validation.checklist) {
      drawChecklistItem(doc, item);
    }
  }

  // ── Certification block ───────────────────────────────────────────────────
  doc.moveDown(1.5);
  if (doc.y > doc.page.height - 130) { doc.addPage(); doc.y = 50; }

  const certY = doc.y;
  doc.rect(50, certY, doc.page.width - 100, 70)
    .stroke(hex(C.border));
  doc.fillColor(hex(C.navy)).font('Helvetica-Bold').fontSize(8)
    .text('MASTER\'S CERTIFICATION', 60, certY + 8, { width: doc.page.width - 120 });
  doc.fillColor(hex(C.slate)).font('Helvetica').fontSize(7.5)
    .text(
      'I, the Master of the above-named vessel, certify that the information provided in this ISPS pre-arrival notification is accurate and complete to the best of my knowledge. I acknowledge that submission of false or misleading information to SAMSA is an offence under the South African Ports Act 12 of 2005.',
      60, certY + 20, { width: doc.page.width - 120, lineGap: 1.5 }
    );

  doc.y = certY + 78;
  twoCol(doc, 'Master Signature', '___________________________', 'Date', '___________________________');
  twoCol(doc, 'Vessel Stamp', '___________________________', 'Master Name', '___________________________');

  doc.on('end', () => {});
  drawFooter(doc);
  doc.end();

  return Buffer.concat(chunks);
}

module.exports = { generateCapeISPSPDF };
