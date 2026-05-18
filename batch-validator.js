/**
 * batch-validator.js — Multi-vessel batch filing validation orchestrator
 *
 * Owns: running multiple vessels through the correct per-waterway validator,
 *   returning a per-row result set with compliance scores and issue summaries.
 * Does NOT own: database writes, file parsing, PDF generation, or route handling.
 *
 * Supported waterways: panama, suez, bosporus, malacca, cape
 */

'use strict';

const { validateVUMPA }       = require('./vumpa-validator');
const { validateSuezFiling }  = require('./suez-validator');
const { validateSP1Filing }   = require('./bosporus-validator');
const { validateMalaccaFiling } = require('./malacca-validator');
const { validateCapeFiling }  = require('./cape-validator');

// ── CSV template column definitions per waterway ──────────────────────────────

const TEMPLATE_HEADERS = {
  panama: [
    'vessel_name', 'imo_number', 'flag_state', 'vessel_type',
    'loa', 'beam', 'draft', 'gross_tonnage', 'net_tonnage',
    'transit_direction', 'estimated_arrival',
    'cargo_type', 'cargo_quantity', 'has_dangerous_goods', 'dangerous_goods_class',
    'crew_count', 'last_port', 'next_port', 'agent_name',
  ],
  suez: [
    'vessel_name', 'imo_number', 'flag_state', 'vessel_type',
    'loa', 'beam', 'draft', 'gross_tonnage', 'air_draft',
    'estimated_arrival', 'transit_direction',
    'cargo_type', 'has_dangerous_goods', 'dangerous_goods_class',
    'crew_count', 'last_port', 'next_port', 'agent_name',
  ],
  bosporus: [
    'vessel_name', 'imo_number', 'flag_state', 'vessel_type',
    'loa', 'beam', 'draft', 'gross_tonnage', 'net_tonnage',
    'transit_direction', 'estimated_arrival',
    'cargo_type', 'cargo_quantity', 'dangerous_goods_class',
    'crew_count', 'last_port', 'next_port', 'agent_name', 'agent_contact',
  ],
  malacca: [
    'vessel_name', 'imo_number', 'flag_state', 'vessel_type',
    'loa', 'beam', 'draft', 'gross_tonnage', 'net_tonnage',
    'transit_direction', 'estimated_arrival', 'speed_knots',
    'cargo_type', 'has_dangerous_goods', 'dangerous_goods_class',
    'crew_count', 'last_port', 'next_port',
    'vhf_watch', 'isps_compliant', 'pilotage_booked',
  ],
  cape: [
    'vessel_name', 'imo_number', 'flag_state', 'vessel_type',
    'loa', 'beam', 'draft', 'gross_tonnage',
    'estimated_arrival', 'port_of_origin', 'next_port',
    'cargo_summary', 'crew_count',
    'isps_security_level', 'has_dangerous_goods', 'dangerous_goods_class',
    'sso_name', 'sso_contact',
  ],
};

// ── Sample data for template row ──────────────────────────────────────────────

const SAMPLE_ROW = {
  panama: {
    vessel_name: 'EXAMPLE VESSEL', imo_number: '9876543', flag_state: 'PA',
    vessel_type: 'container', loa: '290', beam: '32', draft: '11.5',
    gross_tonnage: '50000', net_tonnage: '30000',
    transit_direction: 'northbound', estimated_arrival: '2026-07-01T12:00:00Z',
    cargo_type: 'containerized', cargo_quantity: '5000',
    has_dangerous_goods: 'false', dangerous_goods_class: '',
    crew_count: '22', last_port: 'COLON', next_port: 'MIAMI', agent_name: 'Panama Agents SA',
  },
  suez: {
    vessel_name: 'EXAMPLE VESSEL', imo_number: '9876543', flag_state: 'LR',
    vessel_type: 'bulk_carrier', loa: '220', beam: '32', draft: '12.5',
    gross_tonnage: '45000', air_draft: '45',
    estimated_arrival: '2026-07-01T12:00:00Z', transit_direction: 'northbound',
    cargo_type: 'dry_bulk', has_dangerous_goods: 'false', dangerous_goods_class: '',
    crew_count: '22', last_port: 'PORT SAID', next_port: 'ROTTERDAM', agent_name: 'Suez Agent Co',
  },
  bosporus: {
    vessel_name: 'EXAMPLE VESSEL', imo_number: '9876543', flag_state: 'TR',
    vessel_type: 'tanker', loa: '180', beam: '28', draft: '11',
    gross_tonnage: '35000', net_tonnage: '20000',
    transit_direction: 'northbound', estimated_arrival: '2026-07-01T12:00:00Z',
    cargo_type: 'liquid_bulk', cargo_quantity: '30000', dangerous_goods_class: '',
    crew_count: '20', last_port: 'ISTANBUL', next_port: 'NOVOROSSIYSK',
    agent_name: 'Turkish Strait Agents', agent_contact: '+90-212-000-0000',
  },
  malacca: {
    vessel_name: 'EXAMPLE VESSEL', imo_number: '9876543', flag_state: 'SG',
    vessel_type: 'container', loa: '300', beam: '40', draft: '13',
    gross_tonnage: '80000', net_tonnage: '50000',
    transit_direction: 'northbound', estimated_arrival: '2026-07-01T12:00:00Z',
    speed_knots: '10',
    cargo_type: 'containerized', has_dangerous_goods: 'false', dangerous_goods_class: '',
    crew_count: '25', last_port: 'PORT KLANG', next_port: 'SINGAPORE',
    vhf_watch: 'true', isps_compliant: 'true', pilotage_booked: 'false',
  },
  cape: {
    vessel_name: 'EXAMPLE VESSEL', imo_number: '9876543', flag_state: 'ZA',
    vessel_type: 'bulk_carrier', loa: '250', beam: '43', draft: '14',
    gross_tonnage: '90000',
    estimated_arrival: '2026-07-01T12:00:00Z',
    port_of_origin: 'CAPE TOWN', next_port: 'DURBAN',
    cargo_summary: 'Iron ore - 85000MT', crew_count: '25',
    isps_security_level: '1', has_dangerous_goods: 'false', dangerous_goods_class: '',
    sso_name: 'John Smith', sso_contact: 'john.smith@vessel.com',
  },
};

// ── Supported waterways ───────────────────────────────────────────────────────

const SUPPORTED_WATERWAYS = new Set(['panama', 'suez', 'bosporus', 'malacca', 'cape']);

// ── Parse boolean from CSV string ────────────────────────────────────────────

function parseBool(val) {
  if (val === true || val === false) return val;
  const s = String(val || '').toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes';
}

// ── Map parsed CSV row → filing-data shape expected by each validator ─────────

function normalizeRow(row, waterway) {
  // Common numeric parser
  const num = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const base = {
    vessel_name:            (row.vessel_name || '').trim(),
    imo_number:             (row.imo_number || '').trim(),
    flag_state:             (row.flag_state || '').trim(),
    vessel_type:            (row.vessel_type || '').trim(),
    loa:                    num(row.loa),
    beam:                   num(row.beam),
    draft:                  num(row.draft),
    gross_tonnage:          num(row.gross_tonnage),
    net_tonnage:            num(row.net_tonnage),
    crew_count:             num(row.crew_count),
    last_port:              (row.last_port || '').trim(),
    next_port:              (row.next_port || '').trim(),
    transit_direction:      (row.transit_direction || '').trim(),
    estimated_arrival:      (row.estimated_arrival || '').trim() || null,
    cargo_type:             (row.cargo_type || '').trim(),
    cargo_quantity:         num(row.cargo_quantity),
    dangerous_goods_class:  (row.dangerous_goods_class || '').trim() || null,
    agent_name:             (row.agent_name || '').trim(),
    agent_contact:          (row.agent_contact || '').trim(),
    document_data: {},
  };

  // Waterway-specific enrichment
  if (waterway === 'bosporus') {
    const hasDG = parseBool(row.has_dangerous_goods);
    base.document_data = { has_dangerous_goods: hasDG };
  }

  if (waterway === 'malacca') {
    const hasDG = parseBool(row.has_dangerous_goods);
    base.has_dangerous_goods = hasDG;
    base.speed_knots = num(row.speed_knots);
    base.vhf_watch = parseBool(row.vhf_watch);
    base.isps_compliant = parseBool(row.isps_compliant);
    base.pilotage_booked = parseBool(row.pilotage_booked);
    base.document_data = { has_dangerous_goods: hasDG, speed_through: base.speed_knots };
  }

  if (waterway === 'cape') {
    const hasDG = parseBool(row.has_dangerous_goods);
    base.has_dangerous_goods = hasDG;
    base.port_of_origin = (row.port_of_origin || '').trim();
    base.cargo_summary = (row.cargo_summary || '').trim();
    base.isps_security_level = num(row.isps_security_level) || 1;
    base.sso_name = (row.sso_name || '').trim();
    base.sso_contact = (row.sso_contact || '').trim();
    base.sso_email = (row.sso_email || '').trim();
    base.dangerous_goods_detail = (row.dangerous_goods_detail || '').trim();
    base.document_data = { has_dangerous_goods: hasDG };
  }

  if (waterway === 'suez') {
    const hasDG = parseBool(row.has_dangerous_goods);
    base.has_dangerous_goods = hasDG;
    base.air_draft = num(row.air_draft);
    base.document_data = { has_dangerous_goods: hasDG };
  }

  if (waterway === 'panama') {
    const hasDG = parseBool(row.has_dangerous_goods);
    base.has_dangerous_goods = hasDG;
    base.document_data = { has_dangerous_goods: hasDG };
  }

  return base;
}

// ── Run single vessel through the correct validator ───────────────────────────

function validateVessel(normalized, waterway) {
  switch (waterway) {
    case 'panama':   return validateVUMPA(normalized);
    case 'suez':     return validateSuezFiling(normalized);
    case 'bosporus': return validateSP1Filing(normalized);
    case 'malacca':  return validateMalaccaFiling(normalized);
    case 'cape':     return validateCapeFiling(normalized);
    default:         throw new Error(`Unsupported waterway: ${waterway}`);
  }
}

// ── Extract compliance_score from result (validator shapes differ slightly) ───

function extractScore(result) {
  if (typeof result.compliance_score === 'number') return result.compliance_score;
  // Some validators return score nested inside an object
  if (result.score) return result.score;
  return 0;
}

// ── Main batch validation entry point ─────────────────────────────────────────

/**
 * Validate an array of CSV row objects for a given waterway.
 *
 * @param {Array<Object>} rows     Raw CSV rows (key = column header, value = string)
 * @param {string}        waterway One of: panama, suez, bosporus, malacca, cape
 * @returns {Array<Object>}        One result per input row with validation details
 */
function validateBatch(rows, waterway) {
  if (!SUPPORTED_WATERWAYS.has(waterway)) {
    throw new Error(`Unsupported waterway "${waterway}". Valid: ${[...SUPPORTED_WATERWAYS].join(', ')}`);
  }

  return rows.map((row, index) => {
    const rowNum = index + 2; // 1-indexed, +1 for header

    // Skip blank rows
    const hasAnyData = Object.values(row).some(v => v && String(v).trim());
    if (!hasAnyData) return null;

    try {
      const normalized = normalizeRow(row, waterway);
      const result = validateVessel(normalized, waterway);
      const score = extractScore(result);

      // Build concise issues list for the results table
      const criticalErrors = (result.critical_errors || result.checklist?.filter(c => c.status === 'fail') || [])
        .map(c => c.name || c.id);
      const warnings = (result.warnings_list || result.checklist?.filter(c => c.status === 'warning') || [])
        .map(c => c.name || c.id);

      return {
        row: rowNum,
        vessel_name:      normalized.vessel_name || `Row ${rowNum}`,
        imo_number:       normalized.imo_number || '',
        waterway,
        compliance_score: score,
        overall_status:   result.overall_status,
        passed_checks:    result.passed_checks ?? 0,
        failed_checks:    result.failed_checks ?? 0,
        warning_checks:   result.warning_checks ?? 0,
        critical_errors:  criticalErrors,
        warnings:         warnings,
        checklist:        result.checklist || [],
        normalized,        // original data for filing creation
        error:            null,
      };
    } catch (err) {
      return {
        row:              rowNum,
        vessel_name:      (row.vessel_name || `Row ${rowNum}`).trim(),
        imo_number:       (row.imo_number || '').trim(),
        waterway,
        compliance_score: 0,
        overall_status:   'error',
        passed_checks:    0,
        failed_checks:    0,
        warning_checks:   0,
        critical_errors:  ['Validation error: ' + err.message],
        warnings:         [],
        checklist:        [],
        normalized:       null,
        error:            err.message,
      };
    }
  }).filter(Boolean); // drop blank rows
}

// ── CSV template generator ────────────────────────────────────────────────────

/**
 * Generate a CSV template string for the given waterway.
 * Includes one sample row to illustrate expected values.
 *
 * @param {string} waterway
 * @returns {string}  UTF-8 CSV string (with BOM prefix expected by caller)
 */
function generateTemplate(waterway) {
  const headers = TEMPLATE_HEADERS[waterway];
  if (!headers) throw new Error(`No template defined for waterway: ${waterway}`);

  const sample = SAMPLE_ROW[waterway] || {};
  const sampleRow = headers.map(h => sample[h] || '');

  const lines = [headers.join(','), sampleRow.join(',')];
  return lines.join('\r\n');
}

module.exports = {
  validateBatch,
  generateTemplate,
  TEMPLATE_HEADERS,
  SUPPORTED_WATERWAYS: [...SUPPORTED_WATERWAYS],
};
