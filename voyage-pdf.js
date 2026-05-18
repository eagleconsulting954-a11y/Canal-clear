/**
 * services/voyage-pdf.js — Unified Voyage Compliance Package PDF Generator
 *
 * Owns: PDF generation for the multi-waterway "Voyage Compliance Package" —
 *       a single document covering all waterway filings for one voyage.
 * Does NOT own: SQL, validation logic, route handling, or email delivery.
 *
 * Produces an A4 PDF suitable for ship captains, fleet managers, and port agents.
 */

'use strict';

const PDFDocument = require('pdfkit');
const { waterwayLabel, requiredForms, WATERWAY_GATES } = require('./voyage-generator');

// ── Brand constants ───────────────────────────────────────────────────────────

const BRAND = {
  name:    'CanalClear',
  tagline: 'Canal Compliance Automation',
  url:     'canalclear.org',
  email:   'compliance@canalclear.org',
};

// ── Colour palette ────────────────────────────────────────────────────────────

const C = {
  navy:    '#0A1628',
  orange:  '#E85A00',
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

const WATERWAY_COLORS = {
  panama:   '#0369A1',
  suez:     '#D97706',
  bosporus: '#7C3AED',
  malacca:  '#059669',
  cape:     '#DC2626',
};

function fmtDate(v) {
  if (!v) return '—';
  try { return new Date(v).toUTCString().replace(' GMT', ' UTC'); } catch { return String(v); }
}

function scoreLabel(s) {
  if (s >= 90) return 'COMPLIANT';
  if (s >= 70) return 'REVIEW NEEDED';
  return 'NON-COMPLIANT';
}

function scoreColor(s) {
  if (s >= 90) return C.pass;
  if (s >= 70) return C.warn;
  return C.fail;
}

/**
 * Generate a Voyage Compliance Package PDF.
 *
 * @param {Object} voyage  - Voyage record with vessel fields
 * @param {Object[]} waypoints - Ordered waypoint records
 * @returns {Buffer} PDF buffer
 */
function generateVoyageCompliancePDF(voyage, waypoints) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks = [];
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;   // ~595
    const M = 48;               // margin
    const CW = W - 2 * M;      // content width ~499

    // ── Cover Page ────────────────────────────────────────────────────────────

    // Navy header bar
    doc.rect(0, 0, W, 130).fill(C.navy);

    doc.fill(C.orange).fontSize(22).font('Helvetica-Bold')
       .text(BRAND.name, M, 28);
    doc.fill(C.white).fontSize(9).font('Helvetica')
       .text(BRAND.tagline.toUpperCase(), M, 52, { letterSpacing: 1 });

    doc.fill(C.white).fontSize(18).font('Helvetica-Bold')
       .text('VOYAGE COMPLIANCE PACKAGE', M, 70);
    doc.fill(C.white).fontSize(9).font('Helvetica')
       .text(`Generated: ${fmtDate(new Date().toISOString())}  ·  ${BRAND.url}`, M, 96);

    doc.y = 150;

    // Voyage summary card
    _sectionHeader(doc, '🗺  VOYAGE SUMMARY', C.navy, M, CW);

    const vesselRows = [
      ['Voyage',       voyage.voyage_name || 'Unnamed Voyage'],
      ['Vessel',       voyage.vessel_name || '—'],
      ['IMO Number',   voyage.imo_number  || '—'],
      ['Flag State',   voyage.flag_state  || '—'],
      ['Vessel Type',  voyage.vessel_type || '—'],
      ['Gross Tonnage',voyage.gross_tonnage ? `${voyage.gross_tonnage.toLocaleString()} GT` : '—'],
    ];
    const routeRows = [
      ['Origin',       voyage.origin_port       || '—'],
      ['Destination',  voyage.destination_port   || '—'],
      ['Departure',    fmtDate(voyage.departure_date)],
      ['Arrival (ETA)',fmtDate(voyage.arrival_date)],
      ['Speed',        voyage.vessel_speed_kt ? `${voyage.vessel_speed_kt} knots` : '—'],
      ['Overall Score',`${voyage.overall_score || 0}%`],
    ];

    _twoColumnTable(doc, vesselRows, routeRows, M, CW);

    doc.moveDown(1.5);

    // Waterway overview badges
    _sectionHeader(doc, '🚢  WATERWAY TRANSIT PLAN', C.navy, M, CW);
    doc.moveDown(0.4);

    const badgeW = 90, badgeH = 52, badgeGap = 8;
    let bx = M;
    const by = doc.y;
    for (const wp of waypoints) {
      const col = WATERWAY_COLORS[wp.waterway] || C.slate;
      doc.roundedRect(bx, by, badgeW, badgeH, 4).fill(col);
      doc.fill(C.white).fontSize(7).font('Helvetica-Bold')
         .text(waterwayLabel(wp.waterway).toUpperCase(), bx + 4, by + 6, { width: badgeW - 8, align: 'center' });
      doc.fill(C.white).fontSize(16).font('Helvetica-Bold')
         .text(`${wp.compliance_score || 0}%`, bx + 4, by + 20, { width: badgeW - 8, align: 'center' });
      doc.fill(C.white).fontSize(6).font('Helvetica')
         .text(scoreLabel(wp.compliance_score || 0), bx + 4, by + 40, { width: badgeW - 8, align: 'center' });
      bx += badgeW + badgeGap;
    }
    doc.y = by + badgeH + 16;

    // Deadline timeline table
    doc.moveDown(0.5);
    _sectionHeader(doc, '⏱  FILING DEADLINES', C.navy, M, CW);
    doc.moveDown(0.3);

    const dlHeaders = ['Waterway', 'Required Forms', 'ETA', 'Filing Deadline', 'Status'];
    const dlColW    = [90, 160, 95, 95, 60];
    _tableHeader(doc, dlHeaders, dlColW, M);
    for (const wp of waypoints) {
      const forms = requiredForms(wp.waterway).join(', ');
      const status = wp.filing_status === 'complete' ? '✅ Complete'
                   : wp.filing_status === 'in_progress' ? '🔄 In Progress'
                   : wp.filing_status === 'overdue' ? '🔴 Overdue'
                   : '⏳ Pending';
      _tableRow(doc, [
        waterwayLabel(wp.waterway),
        forms,
        fmtDate(wp.eta),
        fmtDate(wp.filing_deadline),
        status,
      ], dlColW, M);
    }

    // ── Per-waterway filing detail sections ───────────────────────────────────

    for (const wp of waypoints) {
      doc.addPage();

      const col   = WATERWAY_COLORS[wp.waterway] || C.slate;
      const label = waterwayLabel(wp.waterway);

      // Coloured header bar
      doc.rect(0, 0, W, 80).fill(col);
      doc.fill(C.white).fontSize(18).font('Helvetica-Bold')
         .text(label.toUpperCase(), M, 20);
      doc.fill(C.white).fontSize(10).font('Helvetica')
         .text(`${(voyage.vessel_name || '').toUpperCase()}  ·  IMO ${voyage.imo_number || '—'}  ·  ${fmtDate(wp.eta)}`, M, 44);

      // Compliance score ring (text representation)
      const ringX = W - M - 64;
      doc.roundedRect(ringX, 12, 64, 56, 4).fill('rgba(255,255,255,0.15)');
      doc.fill(C.white).fontSize(22).font('Helvetica-Bold')
         .text(`${wp.compliance_score || 0}%`, ringX, 20, { width: 64, align: 'center' });
      doc.fill(C.white).fontSize(7).font('Helvetica')
         .text(scoreLabel(wp.compliance_score || 0), ringX, 46, { width: 64, align: 'center' });

      doc.y = 100;

      // Transit details
      _sectionHeader(doc, 'TRANSIT DETAILS', col, M, CW);
      const tdRows = [
        ['Entry Port',      wp.port_entry      || '—'],
        ['Exit Port',       wp.port_exit       || '—'],
        ['ETA',             fmtDate(wp.eta)],
        ['ETD',             fmtDate(wp.etd)],
        ['Transit Duration',wp.transit_hours ? `${wp.transit_hours} hours` : '—'],
        ['Filing Deadline', fmtDate(wp.filing_deadline)],
        ['Filing Status',   (wp.filing_status || 'pending').replace(/_/g, ' ').toUpperCase()],
      ];
      _simpleTable(doc, tdRows, M, CW);

      // Pre-populated filing data
      doc.moveDown(0.8);
      _sectionHeader(doc, 'PRE-POPULATED FILING DATA', col, M, CW);
      const fd = wp.filing_data || {};
      const fdRows = Object.entries(fd)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [
          k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          String(v),
        ]);
      if (fdRows.length > 0) {
        _simpleTable(doc, fdRows, M, CW);
      } else {
        doc.fill(C.muted).fontSize(9).font('Helvetica')
           .text('No filing data yet. Complete the filing form in the CanalClear app.', M, doc.y);
      }

      // Required forms checklist
      doc.moveDown(0.8);
      _sectionHeader(doc, 'REQUIRED FORMS CHECKLIST', col, M, CW);
      doc.moveDown(0.3);
      for (const form of requiredForms(wp.waterway)) {
        const statusIcon = wp.filing_status === 'complete' ? '☑' : '☐';
        doc.fill(C.slate).fontSize(10).font('Helvetica')
           .text(`${statusIcon}  ${form}`, M + 8, doc.y);
        doc.moveDown(0.4);
      }
    }

    // ── Master Compliance Checklist (final page) ───────────────────────────────

    doc.addPage();
    doc.rect(0, 0, W, 80).fill(C.navy);
    doc.fill(C.orange).fontSize(18).font('Helvetica-Bold')
       .text('MASTER COMPLIANCE CHECKLIST', M, 24);
    doc.fill(C.white).fontSize(9).font('Helvetica')
       .text(`${voyage.voyage_name || 'Voyage'}  ·  ${voyage.origin_port} → ${voyage.destination_port}`, M, 50);
    doc.y = 100;

    for (const wp of waypoints) {
      const col   = WATERWAY_COLORS[wp.waterway] || C.slate;
      const label = waterwayLabel(wp.waterway);
      doc.fill(col).fontSize(11).font('Helvetica-Bold').text(label, M, doc.y);
      doc.moveDown(0.3);
      for (const form of requiredForms(wp.waterway)) {
        const done = wp.filing_status === 'complete';
        doc.fill(done ? C.pass : C.muted).fontSize(9).font('Helvetica')
           .text(`${done ? '✅' : '☐'}  ${form}  —  Deadline: ${fmtDate(wp.filing_deadline)}`, M + 12, doc.y);
        doc.moveDown(0.35);
      }
      doc.moveDown(0.4);
    }

    // Footer on every page
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 28;
      doc.fill(C.muted).fontSize(7).font('Helvetica')
         .text(`${BRAND.name}  ·  ${BRAND.url}  ·  ${BRAND.email}  |  Page ${i + 1} of ${pageCount}`,
               M, y, { align: 'center', width: CW });
    }

    doc.end();
  });
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function _sectionHeader(doc, title, color, M, CW) {
  const y = doc.y;
  doc.rect(M, y, CW, 22).fill(color);
  doc.fill('#FFFFFF').fontSize(8).font('Helvetica-Bold')
     .text(title, M + 8, y + 7, { width: CW - 16 });
  doc.y = y + 26;
}

function _twoColumnTable(doc, leftRows, rightRows, M, CW) {
  const colW = CW / 2 - 4;
  const startY = doc.y;
  let ly = startY, ry = startY;

  for (const [k, v] of leftRows) {
    doc.fill('#718096').fontSize(7).font('Helvetica').text(k, M, ly);
    doc.fill('#1A202C').fontSize(9).font('Helvetica-Bold').text(String(v), M, ly + 8);
    ly += 26;
  }
  for (const [k, v] of rightRows) {
    doc.fill('#718096').fontSize(7).font('Helvetica').text(k, M + colW + 8, ry);
    doc.fill('#1A202C').fontSize(9).font('Helvetica-Bold').text(String(v), M + colW + 8, ry + 8);
    ry += 26;
  }
  doc.y = Math.max(ly, ry) + 4;
}

function _simpleTable(doc, rows, M, CW) {
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.rect(M, y, CW, 18).fill('#F7FAFC');
    doc.fill('#718096').fontSize(7).font('Helvetica').text(k, M + 6, y + 3, { width: 130 });
    doc.fill('#1A202C').fontSize(8).font('Helvetica').text(String(v), M + 140, y + 3, { width: CW - 146 });
    doc.y = y + 20;
  }
}

function _tableHeader(doc, headers, colWidths, M) {
  const y = doc.y;
  doc.rect(M, y, colWidths.reduce((a, b) => a + b, 0), 18).fill('#2D3748');
  let x = M;
  for (let i = 0; i < headers.length; i++) {
    doc.fill('#FFFFFF').fontSize(7).font('Helvetica-Bold')
       .text(headers[i], x + 4, y + 5, { width: colWidths[i] - 8 });
    x += colWidths[i];
  }
  doc.y = y + 20;
}

function _tableRow(doc, cells, colWidths, M) {
  const y = doc.y;
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  const rowH = 20;
  doc.rect(M, y, totalW, rowH).stroke('#E2E8F0');
  let x = M;
  for (let i = 0; i < cells.length; i++) {
    doc.fill('#2D3748').fontSize(7).font('Helvetica')
       .text(String(cells[i] || '—'), x + 4, y + 5, { width: colWidths[i] - 8 });
    x += colWidths[i];
  }
  doc.y = y + rowH;
}

module.exports = { generateVoyageCompliancePDF };
