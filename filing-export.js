/**
 * filing-export.js — CSV and Excel export utilities for all filing types
 *
 * Owns: CSV and .xlsx generation for Panama filings (filings table),
 *   Bosporus SP-1 filings (sp1_filings table), and
 *   Malacca STRAITREP filings (malacca_filings table).
 * Does NOT own: database queries, PDF generation, route handling, or auth.
 *
 * Used by: export route handlers in routes/api.js, routes/bosporus.js,
 *   and routes/malacca.js
 */

'use strict';

const XLSX = require('xlsx');

// ── Panama / Suez filings export ──────────────────────────────────────────────

/**
 * Convert a list of filings (from the `filings` table) to CSV string.
 *
 * @param {Array<object>} filings  Rows from the filings table
 * @returns {string}               UTF-8 CSV string
 */
function filingsToCSV(filings) {
  const headers = [
    'ID', 'Reference Number', 'Canal', 'Document Type', 'Status',
    'Vessel Name', 'IMO Number', 'Flag State', 'Vessel Type',
    'LOA (m)', 'Beam (m)', 'Draft (m)', 'Gross Tonnage',
    'Classification Society', 'Notes', 'Submitted At', 'Created At',
  ];

  const rows = filings.map(f => [
    f.id,
    f.reference_number || '',
    f.canal            || 'panama',
    f.document_type    || '',
    f.status           || '',
    f.vessel_name      || '',
    f.imo_number       || '',
    f.flag_state       || '',
    f.vessel_type      || '',
    f.loa              ?? '',
    f.beam             ?? '',
    f.draft            ?? '',
    f.gross_tonnage    ?? '',
    f.classification_society || '',
    f.notes            || '',
    f.submitted_at ? new Date(f.submitted_at).toISOString() : '',
    f.created_at   ? new Date(f.created_at).toISOString()   : '',
  ]);

  return buildCSV([headers, ...rows]);
}

/**
 * Convert a list of filings to an Excel (.xlsx) buffer.
 *
 * @param {Array<object>} filings
 * @param {string}        sheetName  Worksheet name
 * @returns {Buffer}
 */
function filingsToXLSX(filings, sheetName = 'Filings') {
  const rows = filings.map(f => ({
    'ID':                    f.id,
    'Reference Number':      f.reference_number || '',
    'Canal':                 f.canal            || 'panama',
    'Document Type':         f.document_type    || '',
    'Status':                f.status           || '',
    'Vessel Name':           f.vessel_name      || '',
    'IMO Number':            f.imo_number       || '',
    'Flag State':            f.flag_state       || '',
    'Vessel Type':           f.vessel_type      || '',
    'LOA (m)':               f.loa              ?? null,
    'Beam (m)':              f.beam             ?? null,
    'Draft (m)':             f.draft            ?? null,
    'Gross Tonnage':         f.gross_tonnage    ?? null,
    'Classification Society':f.classification_society || '',
    'Notes':                 f.notes            || '',
    'Submitted At':          f.submitted_at ? new Date(f.submitted_at).toISOString() : '',
    'Created At':            f.created_at   ? new Date(f.created_at).toISOString()   : '',
  }));

  return buildXLSX(rows, sheetName);
}

// ── Bosporus SP-1 filings export ──────────────────────────────────────────────

/**
 * Convert a list of SP-1 filings (from the `sp1_filings` table) to CSV string.
 *
 * @param {Array<object>} filings
 * @returns {string}
 */
function sp1FilingsToCSV(filings) {
  const headers = [
    'ID', 'Filing Status', 'Compliance Score',
    'Vessel Name', 'IMO Number', 'Call Sign', 'MMSI', 'Flag State', 'Vessel Type',
    'Gross Tonnage', 'Net Tonnage', 'LOA (m)', 'Beam (m)', 'Draft (m)',
    'Transit Direction', 'Last Port', 'Next Port', 'Estimated Arrival',
    'Cargo Type', 'Cargo Quantity (MT)', 'Dangerous Goods Class',
    'Crew Count', 'Passenger Count', 'Master Name',
    'Agent Name', 'Agent Contact',
    'P&I Club', 'Insurance Details',
    'Deadline 24h', 'Deadline 48h',
    'Created At', 'Updated At',
  ];

  const rows = filings.map(f => [
    f.id,
    f.filing_status    || '',
    f.compliance_score ?? '',
    f.vessel_name      || '',
    f.imo_number       || '',
    f.call_sign        || '',
    f.mmsi             || '',
    f.flag_state       || '',
    f.vessel_type      || '',
    f.gross_tonnage    ?? '',
    f.net_tonnage      ?? '',
    f.loa              ?? '',
    f.beam             ?? '',
    f.draft            ?? '',
    f.transit_direction || '',
    f.last_port        || '',
    f.next_port        || '',
    f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    f.cargo_type       || '',
    f.cargo_quantity   ?? '',
    f.dangerous_goods_class || '',
    f.crew_count       ?? '',
    f.passenger_count  ?? '',
    f.master_name      || '',
    f.agent_name       || '',
    f.agent_contact    || '',
    f.pi_club          || '',
    f.insurance_details || '',
    f.deadline_24h ? new Date(f.deadline_24h).toISOString() : '',
    f.deadline_48h ? new Date(f.deadline_48h).toISOString() : '',
    f.created_at   ? new Date(f.created_at).toISOString()   : '',
    f.updated_at   ? new Date(f.updated_at).toISOString()   : '',
  ]);

  return buildCSV([headers, ...rows]);
}

/**
 * Convert a list of SP-1 filings to an Excel (.xlsx) buffer.
 *
 * @param {Array<object>} filings
 * @returns {Buffer}
 */
function sp1FilingsToXLSX(filings) {
  const rows = filings.map(f => ({
    'ID':                    f.id,
    'Filing Status':         f.filing_status    || '',
    'Compliance Score':      f.compliance_score ?? null,
    'Vessel Name':           f.vessel_name      || '',
    'IMO Number':            f.imo_number       || '',
    'Call Sign':             f.call_sign        || '',
    'MMSI':                  f.mmsi             || '',
    'Flag State':            f.flag_state       || '',
    'Vessel Type':           f.vessel_type      || '',
    'Gross Tonnage':         f.gross_tonnage    ?? null,
    'Net Tonnage':           f.net_tonnage      ?? null,
    'LOA (m)':               f.loa              ?? null,
    'Beam (m)':              f.beam             ?? null,
    'Draft (m)':             f.draft            ?? null,
    'Transit Direction':     f.transit_direction || '',
    'Last Port':             f.last_port        || '',
    'Next Port':             f.next_port        || '',
    'Estimated Arrival':     f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    'Cargo Type':            f.cargo_type       || '',
    'Cargo Quantity (MT)':   f.cargo_quantity   ?? null,
    'Dangerous Goods Class': f.dangerous_goods_class || '',
    'Crew Count':            f.crew_count       ?? null,
    'Passenger Count':       f.passenger_count  ?? null,
    'Master Name':           f.master_name      || '',
    'Agent Name':            f.agent_name       || '',
    'Agent Contact':         f.agent_contact    || '',
    'P&I Club':              f.pi_club          || '',
    'Insurance Details':     f.insurance_details || '',
    'Deadline 24h':          f.deadline_24h ? new Date(f.deadline_24h).toISOString() : '',
    'Deadline 48h':          f.deadline_48h ? new Date(f.deadline_48h).toISOString() : '',
    'Created At':            f.created_at   ? new Date(f.created_at).toISOString()   : '',
    'Updated At':            f.updated_at   ? new Date(f.updated_at).toISOString()   : '',
  }));

  return buildXLSX(rows, 'SP-1 Filings');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a CSV string from a 2D array of rows (first row = headers).
 */
function buildCSV(rows) {
  return rows.map(row =>
    row.map(cell => {
      const s = String(cell === null || cell === undefined ? '' : cell);
      // Wrap in quotes if it contains comma, newline, or double-quote
      if (s.includes(',') || s.includes('\n') || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }).join(',')
  ).join('\r\n');
}

/**
 * Build an .xlsx buffer from an array of row-objects.
 * Column order follows the key insertion order of the first row.
 */
function buildXLSX(rows, sheetName = 'Export') {
  const ws = XLSX.utils.json_to_sheet(rows);

  // Auto-fit column widths (approximate)
  const maxWidths = {};
  if (rows.length > 0) {
    Object.keys(rows[0]).forEach(key => {
      maxWidths[key] = Math.max(
        key.length,
        ...rows.slice(0, 50).map(r => String(r[key] ?? '').length)
      );
    });
    ws['!cols'] = Object.values(maxWidths).map(w => ({ wch: Math.min(w + 2, 40) }));
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ── Malacca STRAITREP filings export ──────────────────────────────────────────

/**
 * Convert a list of Malacca STRAITREP filings (from the `malacca_filings` table) to CSV string.
 *
 * @param {Array<object>} filings
 * @returns {string}
 */
function malaccaFilingsToCSV(filings) {
  const headers = [
    'ID', 'Filing Status', 'Compliance Score',
    'Vessel Name', 'IMO Number', 'Call Sign', 'MMSI', 'Flag State', 'Vessel Type',
    'Gross Tonnage', 'Net Tonnage', 'LOA (m)', 'Beam (m)', 'Draft (m)',
    'Transit Direction', 'Reporting Point', 'Last Port', 'Next Port',
    'Estimated Arrival', 'Speed Through (kn)',
    'Cargo Type', 'Cargo Quantity (MT)', 'In Ballast',
    'Has Dangerous Goods', 'DG Class', 'DG UN Number', 'DG Proper Name',
    'MARPOL Compliance', 'Garbage Plan',
    'Crew Count', 'Master Name',
    'Pilot Required', 'Pilot Embark Point',
    'Agent Name', 'Agent Contact',
    'Deadline 3h', 'Deadline 24h', 'Deadline 48h',
    'Created At', 'Updated At',
  ];

  const rows = filings.map(f => [
    f.id,
    f.filing_status              || '',
    f.compliance_score           ?? '',
    f.vessel_name                || '',
    f.imo_number                 || '',
    f.call_sign                  || '',
    f.mmsi                       || '',
    f.flag_state                 || '',
    f.vessel_type                || '',
    f.gross_tonnage              ?? '',
    f.net_tonnage                ?? '',
    f.loa                        ?? '',
    f.beam                       ?? '',
    f.draft                      ?? '',
    f.transit_direction          || '',
    f.reporting_point            || '',
    f.last_port                  || '',
    f.next_port                  || '',
    f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    f.speed_through              ?? '',
    f.cargo_type                 || '',
    f.cargo_quantity             ?? '',
    f.in_ballast                 ? 'YES' : 'No',
    f.has_dangerous_goods        ? 'YES' : 'No',
    f.dangerous_goods_class      || '',
    f.dg_un_number               || '',
    f.dg_proper_name             || '',
    f.marpol_compliance !== false ? 'YES' : 'No',
    f.garbage_plan               ? 'YES' : 'No',
    f.crew_count                 ?? '',
    f.master_name                || '',
    f.pilot_required             ? 'YES' : 'No',
    f.pilot_embark_point         || '',
    f.agent_name                 || '',
    f.agent_contact              || '',
    f.deadline_3h  ? new Date(f.deadline_3h).toISOString()  : '',
    f.deadline_24h ? new Date(f.deadline_24h).toISOString() : '',
    f.deadline_48h ? new Date(f.deadline_48h).toISOString() : '',
    f.created_at   ? new Date(f.created_at).toISOString()   : '',
    f.updated_at   ? new Date(f.updated_at).toISOString()   : '',
  ]);

  return buildCSV([headers, ...rows]);
}

/**
 * Convert a list of Malacca STRAITREP filings to an Excel (.xlsx) buffer.
 *
 * @param {Array<object>} filings
 * @returns {Buffer}
 */
function malaccaFilingsToXLSX(filings) {
  const rows = filings.map(f => ({
    'ID':                    f.id,
    'Filing Status':         f.filing_status              || '',
    'Compliance Score':      f.compliance_score           ?? null,
    'Vessel Name':           f.vessel_name                || '',
    'IMO Number':            f.imo_number                 || '',
    'Call Sign':             f.call_sign                  || '',
    'MMSI':                  f.mmsi                       || '',
    'Flag State':            f.flag_state                 || '',
    'Vessel Type':           f.vessel_type                || '',
    'Gross Tonnage':         f.gross_tonnage              ?? null,
    'Net Tonnage':           f.net_tonnage                ?? null,
    'LOA (m)':               f.loa                        ?? null,
    'Beam (m)':              f.beam                       ?? null,
    'Draft (m)':             f.draft                      ?? null,
    'Transit Direction':     f.transit_direction          || '',
    'Reporting Point':       f.reporting_point            || '',
    'Last Port':             f.last_port                  || '',
    'Next Port':             f.next_port                  || '',
    'Estimated Arrival':     f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    'Speed Through (kn)':    f.speed_through              ?? null,
    'Cargo Type':            f.cargo_type                 || '',
    'Cargo Quantity (MT)':   f.cargo_quantity             ?? null,
    'In Ballast':            f.in_ballast                 ? 'YES' : 'No',
    'Has Dangerous Goods':   f.has_dangerous_goods        ? 'YES' : 'No',
    'DG Class':              f.dangerous_goods_class      || '',
    'DG UN Number':          f.dg_un_number               || '',
    'DG Proper Name':        f.dg_proper_name             || '',
    'MARPOL Compliance':     f.marpol_compliance !== false ? 'YES' : 'No',
    'Garbage Plan':          f.garbage_plan               ? 'YES' : 'No',
    'Crew Count':            f.crew_count                 ?? null,
    'Master Name':           f.master_name                || '',
    'Pilot Required':        f.pilot_required             ? 'YES' : 'No',
    'Pilot Embark Point':    f.pilot_embark_point         || '',
    'Agent Name':            f.agent_name                 || '',
    'Agent Contact':         f.agent_contact              || '',
    'Deadline 3h':           f.deadline_3h  ? new Date(f.deadline_3h).toISOString()  : '',
    'Deadline 24h':          f.deadline_24h ? new Date(f.deadline_24h).toISOString() : '',
    'Deadline 48h':          f.deadline_48h ? new Date(f.deadline_48h).toISOString() : '',
    'Created At':            f.created_at   ? new Date(f.created_at).toISOString()   : '',
    'Updated At':            f.updated_at   ? new Date(f.updated_at).toISOString()   : '',
  }));

  return buildXLSX(rows, 'STRAITREP Filings');
}

// ── Cape of Good Hope ISPS filings export ────────────────────────────────────

/**
 * Convert a list of Cape ISPS filings (from the `cape_filings` table) to CSV string.
 *
 * @param {Array<object>} filings
 * @returns {string}
 */
function capeFilingsToCSV(filings) {
  const headers = [
    'ID', 'Filing Status', 'Compliance Score',
    'Vessel Name', 'IMO Number', 'Call Sign', 'MMSI', 'Flag State', 'Vessel Type',
    'Gross Tonnage', 'Net Tonnage', 'LOA (m)', 'Beam (m)', 'Draft (m)',
    'Port of Origin', 'Next Port', 'Estimated Arrival',
    'Cargo Summary', 'Crew Count',
    'ISPS Security Level',
    'Has Dangerous Goods', 'DG Class', 'DG Detail',
    'SSO Name', 'SSO Contact', 'SSO Email',
    'Deadline 96h',
    'Created At', 'Updated At',
  ];

  const rows = filings.map(f => [
    f.id,
    f.filing_status              || '',
    f.compliance_score           ?? '',
    f.vessel_name                || '',
    f.imo_number                 || '',
    f.call_sign                  || '',
    f.mmsi                       || '',
    f.flag_state                 || '',
    f.vessel_type                || '',
    f.gross_tonnage              ?? '',
    f.net_tonnage                ?? '',
    f.loa                        ?? '',
    f.beam                       ?? '',
    f.draft                      ?? '',
    f.port_of_origin             || '',
    f.next_port                  || '',
    f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    f.cargo_summary              || '',
    f.crew_count                 ?? '',
    f.isps_security_level        ?? '',
    f.has_dangerous_goods        ? 'YES' : 'No',
    f.dangerous_goods_class      || '',
    f.dangerous_goods_detail     || '',
    f.sso_name                   || '',
    f.sso_contact                || '',
    f.sso_email                  || '',
    f.deadline_96h_at ? new Date(f.deadline_96h_at).toISOString() : '',
    f.created_at ? new Date(f.created_at).toISOString() : '',
    f.updated_at ? new Date(f.updated_at).toISOString() : '',
  ]);

  return buildCSV([headers, ...rows]);
}

/**
 * Convert a list of Cape ISPS filings to an Excel (.xlsx) buffer.
 *
 * @param {Array<object>} filings
 * @returns {Buffer}
 */
function capeFilingsToXLSX(filings) {
  const rows = filings.map(f => ({
    'ID':                    f.id,
    'Filing Status':         f.filing_status              || '',
    'Compliance Score':      f.compliance_score           ?? null,
    'Vessel Name':           f.vessel_name                || '',
    'IMO Number':            f.imo_number                 || '',
    'Call Sign':             f.call_sign                  || '',
    'MMSI':                  f.mmsi                       || '',
    'Flag State':            f.flag_state                 || '',
    'Vessel Type':           f.vessel_type                || '',
    'Gross Tonnage':         f.gross_tonnage              ?? null,
    'Net Tonnage':           f.net_tonnage                ?? null,
    'LOA (m)':               f.loa                        ?? null,
    'Beam (m)':              f.beam                       ?? null,
    'Draft (m)':             f.draft                      ?? null,
    'Port of Origin':        f.port_of_origin             || '',
    'Next Port':             f.next_port                  || '',
    'Estimated Arrival':     f.estimated_arrival ? new Date(f.estimated_arrival).toISOString() : '',
    'Cargo Summary':         f.cargo_summary              || '',
    'Crew Count':            f.crew_count                 ?? null,
    'ISPS Security Level':   f.isps_security_level        ?? null,
    'Has Dangerous Goods':   f.has_dangerous_goods        ? 'YES' : 'No',
    'DG Class':              f.dangerous_goods_class      || '',
    'DG Detail':             f.dangerous_goods_detail     || '',
    'SSO Name':              f.sso_name                   || '',
    'SSO Contact':           f.sso_contact                || '',
    'SSO Email':             f.sso_email                  || '',
    'Deadline 96h':          f.deadline_96h_at ? new Date(f.deadline_96h_at).toISOString() : '',
    'Created At':            f.created_at ? new Date(f.created_at).toISOString() : '',
    'Updated At':            f.updated_at ? new Date(f.updated_at).toISOString() : '',
  }));

  return buildXLSX(rows, 'Cape ISPS Filings');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  filingsToCSV,
  filingsToXLSX,
  sp1FilingsToCSV,
  sp1FilingsToXLSX,
  malaccaFilingsToCSV,
  malaccaFilingsToXLSX,
  capeFilingsToCSV,
  capeFilingsToXLSX,
};
