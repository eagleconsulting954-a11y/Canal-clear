/**
 * services/tms-field-mapper.js — TMS Import field mapping and validation pipeline.
 * Owns: canonical field schema definition, file parsing (CSV/XLSX/JSON),
 *       column-to-canonical mapping application, per-row validation.
 * Does NOT own: DB persistence (db/tms-imports.js), HTTP routing (routes/tms-import.js),
 *   waterway-specific filing validation (services/*-validator.js).
 */

'use strict';

const XLSX = require('xlsx');

// ── Canonical Field Schema ────────────────────────────────────────────────────
// These are the canonical field names CanalClear understands.
// The field_mapping in DB maps source column names → canonical field names.

const CANONICAL_FIELDS = {
  // Vessel particulars
  imo_number:       { label: 'IMO Number',          required: false, type: 'string', example: '9876543' },
  vessel_name:      { label: 'Vessel Name',          required: true,  type: 'string', example: 'AEGEAN STAR' },
  flag_state:       { label: 'Flag State',           required: false, type: 'string', example: 'Liberia' },
  gross_tonnage:    { label: 'Gross Tonnage (GT)',   required: false, type: 'number', example: '45000' },
  loa_meters:       { label: 'LOA (meters)',         required: false, type: 'number', example: '229.5' },
  beam_meters:      { label: 'Beam (meters)',        required: false, type: 'number', example: '32.2' },
  max_draft_meters: { label: 'Max Draft (meters)',   required: false, type: 'number', example: '14.5' },
  vessel_type:      { label: 'Vessel Type',          required: false, type: 'string', example: 'Bulk Carrier' },

  // Voyage data
  port_of_origin:   { label: 'Port of Origin',      required: false, type: 'string', example: 'Rotterdam' },
  port_of_dest:     { label: 'Port of Destination', required: false, type: 'string', example: 'Singapore' },
  eta:              { label: 'ETA',                  required: false, type: 'date',   example: '2026-06-15T08:00:00Z' },
  etd:              { label: 'ETD',                  required: false, type: 'date',   example: '2026-06-16T12:00:00Z' },
  cargo_type:       { label: 'Cargo Type',           required: false, type: 'string', example: 'Iron Ore' },
  cargo_quantity:   { label: 'Cargo Quantity',       required: false, type: 'number', example: '75000' },
  cargo_unit:       { label: 'Cargo Unit',           required: false, type: 'string', example: 'MT' },

  // Crew
  master_name:      { label: "Master's Name",        required: false, type: 'string', example: 'Capt. John Smith' },
  crew_count:       { label: 'Total Crew',           required: false, type: 'number', example: '24' },

  // Documents
  pi_club:          { label: 'P&I Club',             required: false, type: 'string', example: 'Gard' },
  cofr_number:      { label: 'COFR Number',          required: false, type: 'string', example: 'COFR-2026-12345' },
  class_society:    { label: 'Classification Society',required: false, type: 'string', example: 'DNV' },
  class_cert_no:    { label: 'Class Certificate No', required: false, type: 'string', example: 'DNV-2026-98765' },
};

// Aliases: known column names from popular TMS exports → canonical field name.
// Used for auto-detection to suggest mappings to users.
const TMS_ALIASES = {
  // IMO
  'imo':            'imo_number',
  'imo no':         'imo_number',
  'imo number':     'imo_number',
  'imo no.':        'imo_number',
  'vessel imo':     'imo_number',

  // Vessel name
  'vessel':         'vessel_name',
  'vessel name':    'vessel_name',
  'ship name':      'vessel_name',
  'ship':           'vessel_name',
  'name':           'vessel_name',
  'mv':             'vessel_name',

  // Flag
  'flag':           'flag_state',
  'flag state':     'flag_state',
  'registry':       'flag_state',
  'flag/registry':  'flag_state',

  // GT
  'gt':             'gross_tonnage',
  'grt':            'gross_tonnage',
  'gross tonnage':  'gross_tonnage',
  'gross tons':     'gross_tonnage',
  'tonnage':        'gross_tonnage',

  // LOA
  'loa':            'loa_meters',
  'length overall': 'loa_meters',
  'length (m)':     'loa_meters',
  'loa (m)':        'loa_meters',
  'loa m':          'loa_meters',

  // Beam
  'beam':           'beam_meters',
  'breadth':        'beam_meters',
  'beam (m)':       'beam_meters',

  // Draft
  'draft':          'max_draft_meters',
  'draught':        'max_draft_meters',
  'max draft':      'max_draft_meters',
  'max draught':    'max_draft_meters',
  'max draft (m)':  'max_draft_meters',
  'deepest draft':  'max_draft_meters',

  // Vessel type
  'type':           'vessel_type',
  'vessel type':    'vessel_type',
  'ship type':      'vessel_type',
  'category':       'vessel_type',

  // Origin
  'origin':         'port_of_origin',
  'from port':      'port_of_origin',
  'load port':      'port_of_origin',
  'departure port': 'port_of_origin',
  'pol':            'port_of_origin',  // Port of Loading

  // Destination
  'destination':    'port_of_dest',
  'to port':        'port_of_dest',
  'discharge port': 'port_of_dest',
  'pod':            'port_of_dest',    // Port of Discharge
  'next port':      'port_of_dest',

  // ETA
  'eta':            'eta',
  'arrival':        'eta',
  'eta date':       'eta',

  // ETD
  'etd':            'etd',
  'departure':      'etd',
  'etd date':       'etd',

  // Cargo
  'cargo':          'cargo_type',
  'cargo type':     'cargo_type',
  'commodity':      'cargo_type',
  'cargo description': 'cargo_type',
  'quantity':       'cargo_quantity',
  'cargo quantity': 'cargo_quantity',
  'cargo qty':      'cargo_quantity',
  'cargo weight':   'cargo_quantity',
  'unit':           'cargo_unit',
  'cargo unit':     'cargo_unit',
  'uom':            'cargo_unit',

  // Crew
  'master':         'master_name',
  "master's name":  'master_name',
  'captain':        'master_name',
  'crew':           'crew_count',
  'crew count':     'crew_count',
  'total crew':     'crew_count',
  'pob':            'crew_count',

  // Docs
  'p&i':            'pi_club',
  'p&i club':       'pi_club',
  'pi club':        'pi_club',
  'p and i':        'pi_club',
  'cofr':           'cofr_number',
  'cofr number':    'cofr_number',
  'class':          'class_society',
  'classification': 'class_society',
  'class society':  'class_society',
  'class cert':     'class_cert_no',
  'certificate no': 'class_cert_no',
};

/**
 * Parse a file buffer into an array of raw row objects.
 * Supports CSV, XLSX, and JSON.
 *
 * Returns: { headers: string[], rows: object[] }
 */
function parseFile(buffer, mimetype, originalName) {
  const ext = (originalName.match(/\.(\w+)$/) || [])[1]?.toLowerCase();

  if (ext === 'json' || mimetype === 'application/json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    const data = Array.isArray(parsed) ? parsed : (parsed.vessels || parsed.data || [parsed]);
    if (!data.length) return { headers: [], rows: [] };
    const headers = Object.keys(data[0]);
    return { headers, rows: data };
  }

  // CSV or XLSX — use xlsx library for both
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

/**
 * Auto-detect mappings from file headers using the alias table.
 * Returns mapping object: { sourceColumn: canonicalField | null }
 */
function autoDetectMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const normalized = header.trim().toLowerCase().replace(/[_\-]+/g, ' ');
    mapping[header] = TMS_ALIASES[normalized] || TMS_ALIASES[header.trim().toLowerCase()] || null;
  }
  return mapping;
}

/**
 * Apply a field mapping to raw rows, producing canonical vessel objects.
 * fieldMapping: { sourceColumn: canonicalField }
 * Returns array of canonical objects.
 */
function applyMapping(rows, fieldMapping) {
  // Invert: canonical → source column
  const inverseMap = {};
  for (const [src, canonical] of Object.entries(fieldMapping)) {
    if (canonical) inverseMap[canonical] = src;
  }

  return rows.map((row, idx) => {
    const vessel = { rowNumber: idx + 2, rawRow: row }; // +2 for 1-indexed + header
    for (const [canonical, src] of Object.entries(inverseMap)) {
      const val = row[src];
      vessel[canonical] = (val === '' || val === undefined) ? null : val;
    }
    return vessel;
  });
}

/**
 * Validate a single canonical vessel object.
 * Returns { validationStatus, validationErrors, validationWarnings }
 */
function validateVessel(vessel) {
  const errors = [];
  const warnings = [];

  // Required field: vessel_name
  if (!vessel.vessel_name || String(vessel.vessel_name).trim() === '') {
    errors.push({ field: 'vessel_name', message: 'Vessel name is required' });
  }

  // IMO checksum (if provided)
  if (vessel.imo_number) {
    const imo = String(vessel.imo_number).replace(/^IMO\s*/i, '').trim();
    if (!/^\d{7}$/.test(imo)) {
      errors.push({ field: 'imo_number', message: `IMO must be exactly 7 digits (got: ${imo})` });
    } else {
      // Luhn-style IMO checksum
      const digits = imo.split('').map(Number);
      const weights = [7, 6, 5, 4, 3, 2];
      const checksum = weights.reduce((sum, w, i) => sum + w * digits[i], 0) % 10;
      if (checksum !== digits[6]) {
        errors.push({ field: 'imo_number', message: `IMO checksum invalid for ${imo}` });
      } else {
        // Normalise
        vessel.imo_number = imo;
      }
    }
  }

  // Numeric range guards
  if (vessel.gross_tonnage !== null && vessel.gross_tonnage !== undefined) {
    const gt = parseFloat(vessel.gross_tonnage);
    if (isNaN(gt) || gt <= 0) {
      errors.push({ field: 'gross_tonnage', message: 'Gross tonnage must be a positive number' });
    } else {
      vessel.gross_tonnage = gt;
      if (gt < 500)  warnings.push({ field: 'gross_tonnage', message: `GT ${gt} is unusually small for a canal transit` });
      if (gt > 500000) warnings.push({ field: 'gross_tonnage', message: `GT ${gt} is unusually large — verify` });
    }
  }

  if (vessel.loa_meters !== null && vessel.loa_meters !== undefined) {
    const loa = parseFloat(vessel.loa_meters);
    if (isNaN(loa) || loa <= 0) {
      errors.push({ field: 'loa_meters', message: 'LOA must be a positive number in meters' });
    } else {
      vessel.loa_meters = loa;
      if (loa > 400) warnings.push({ field: 'loa_meters', message: `LOA ${loa}m exceeds most canal limits — verify` });
    }
  }

  if (vessel.max_draft_meters !== null && vessel.max_draft_meters !== undefined) {
    const draft = parseFloat(vessel.max_draft_meters);
    if (isNaN(draft) || draft <= 0) {
      errors.push({ field: 'max_draft_meters', message: 'Draft must be a positive number in meters' });
    } else {
      vessel.max_draft_meters = draft;
      // Bosporus hard limit: 15.5m
      if (draft > 15.5) warnings.push({ field: 'max_draft_meters', message: `Draft ${draft}m exceeds Bosporus limit of 15.5m` });
    }
  }

  if (vessel.beam_meters !== null && vessel.beam_meters !== undefined) {
    const beam = parseFloat(vessel.beam_meters);
    if (!isNaN(beam) && beam > 0) vessel.beam_meters = beam;
  }

  // Date parsing
  for (const field of ['eta', 'etd']) {
    if (vessel[field]) {
      const d = new Date(vessel[field]);
      if (isNaN(d.getTime())) {
        errors.push({ field, message: `${field.toUpperCase()} is not a valid date: "${vessel[field]}"` });
        vessel[field] = null;
      } else {
        vessel[field] = d.toISOString();
      }
    }
  }

  // ETA before ETD check
  if (vessel.eta && vessel.etd) {
    if (new Date(vessel.eta) > new Date(vessel.etd)) {
      warnings.push({ field: 'eta', message: 'ETA is after ETD — check transit direction' });
    }
  }

  // Numeric parse for remaining numbers
  if (vessel.cargo_quantity) {
    const qty = parseFloat(vessel.cargo_quantity);
    vessel.cargo_quantity = isNaN(qty) ? null : qty;
  }
  if (vessel.crew_count) {
    const crew = parseInt(vessel.crew_count, 10);
    vessel.crew_count = isNaN(crew) ? null : crew;
    if (!isNaN(crew) && (crew < 1 || crew > 500)) {
      warnings.push({ field: 'crew_count', message: `Crew count ${crew} is outside expected range 1–500` });
    }
  }

  const status = errors.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'valid');
  return { validationStatus: status, validationErrors: errors, validationWarnings: warnings };
}

/**
 * Validate all vessel rows and return enriched rows with validation results.
 */
function validateAll(vesselRows) {
  return vesselRows.map(vessel => {
    const { validationStatus, validationErrors, validationWarnings } = validateVessel(vessel);
    return { ...vessel, validationStatus, validationErrors, validationWarnings };
  });
}

/**
 * Determine file format from mimetype / filename.
 */
function detectFormat(mimetype, originalName) {
  if (mimetype === 'application/json' || originalName.endsWith('.json')) return 'json';
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    originalName.endsWith('.xlsx')
  ) return 'xlsx';
  return 'csv';
}

module.exports = {
  CANONICAL_FIELDS,
  TMS_ALIASES,
  parseFile,
  autoDetectMapping,
  applyMapping,
  validateVessel,
  validateAll,
  detectFormat,
};
