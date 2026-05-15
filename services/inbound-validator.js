/**
 * services/inbound-validator.js — Validation for TMS inbound API payloads.
 *
 * Owns: IMO checksum validation, required-field checks, date format validation,
 *       structured per-field error responses.
 * Does NOT own: DB writes, route handling, field mapping.
 */

/**
 * Validate IMO number using the IMO luhn-style check digit algorithm.
 * Format: 7 digits where digit 7 = (sum of d1*7 + d2*6 + ... + d6*2) mod 10
 */
function validateIMO(imo) {
  if (!imo) return { valid: false, reason: 'IMO number is required' };
  const digits = String(imo).replace(/[^0-9]/g, '');
  if (digits.length !== 7) return { valid: false, reason: 'IMO must be exactly 7 digits' };

  let sum = 0;
  for (let i = 0; i < 6; i++) {
    sum += parseInt(digits[i], 10) * (7 - i);
  }
  const checkDigit = sum % 10;
  if (checkDigit !== parseInt(digits[6], 10)) {
    return { valid: false, reason: `IMO check digit invalid (expected ${checkDigit}, got ${digits[6]})` };
  }
  return { valid: true };
}

/**
 * Validate vessel payload.
 * Returns { valid: boolean, errors: { field: message }[] }
 */
function validateVesselPayload(data) {
  const errors = [];

  // Required
  if (!data.imo) errors.push({ field: 'imo', message: 'IMO number is required' });
  else {
    const imoCheck = validateIMO(data.imo);
    if (!imoCheck.valid) errors.push({ field: 'imo', message: imoCheck.reason });
  }

  // Numeric range checks
  if (data.gross_tonnage !== undefined && (isNaN(Number(data.gross_tonnage)) || Number(data.gross_tonnage) < 0)) {
    errors.push({ field: 'gross_tonnage', message: 'gross_tonnage must be a non-negative number' });
  }
  if (data.loa !== undefined && (isNaN(Number(data.loa)) || Number(data.loa) <= 0)) {
    errors.push({ field: 'loa', message: 'loa (length overall) must be a positive number in metres' });
  }
  if (data.beam !== undefined && (isNaN(Number(data.beam)) || Number(data.beam) <= 0)) {
    errors.push({ field: 'beam', message: 'beam must be a positive number in metres' });
  }
  if (data.draft !== undefined && (isNaN(Number(data.draft)) || Number(data.draft) <= 0)) {
    errors.push({ field: 'draft', message: 'draft must be a positive number in metres' });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate voyage payload.
 */
function validateVoyagePayload(data) {
  const errors = [];

  if (!data.vessel_imo) {
    errors.push({ field: 'vessel_imo', message: 'vessel_imo is required' });
  } else {
    const imoCheck = validateIMO(data.vessel_imo);
    if (!imoCheck.valid) errors.push({ field: 'vessel_imo', message: imoCheck.reason });
  }

  if (data.eta && isNaN(Date.parse(data.eta))) {
    errors.push({ field: 'eta', message: 'eta must be a valid ISO 8601 datetime (e.g. 2026-06-01T08:00:00Z)' });
  }
  if (data.etd && isNaN(Date.parse(data.etd))) {
    errors.push({ field: 'etd', message: 'etd must be a valid ISO 8601 datetime' });
  }
  if (data.eta && data.etd && Date.parse(data.etd) <= Date.parse(data.eta)) {
    errors.push({ field: 'etd', message: 'etd must be after eta' });
  }

  const VALID_WATERWAYS = ['panama', 'suez', 'bosporus', 'malacca', 'cape'];
  if (data.waterway && !VALID_WATERWAYS.includes(String(data.waterway).toLowerCase())) {
    errors.push({ field: 'waterway', message: `waterway must be one of: ${VALID_WATERWAYS.join(', ')}` });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate crew manifest payload.
 */
function validateCrewPayload(data) {
  const errors = [];

  if (!data.vessel_imo) {
    errors.push({ field: 'vessel_imo', message: 'vessel_imo is required' });
  } else {
    const imoCheck = validateIMO(data.vessel_imo);
    if (!imoCheck.valid) errors.push({ field: 'vessel_imo', message: imoCheck.reason });
  }

  if (!data.crew || !Array.isArray(data.crew)) {
    errors.push({ field: 'crew', message: 'crew must be an array of crew member objects' });
  } else if (data.crew.length === 0) {
    errors.push({ field: 'crew', message: 'crew array must contain at least one member' });
  } else {
    data.crew.forEach((member, i) => {
      if (!member.full_name && !member.name) {
        errors.push({ field: `crew[${i}].full_name`, message: 'Each crew member must have a full_name' });
      }
      if (member.cert_expiry && isNaN(Date.parse(member.cert_expiry))) {
        errors.push({ field: `crew[${i}].cert_expiry`, message: 'cert_expiry must be a valid date (YYYY-MM-DD)' });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Apply a webhook field mapping template to a raw payload.
 * mapping is { "target_field": "source.path.nested" }
 * Uses dot-notation to traverse source payload.
 */
function applyFieldMapping(payload, mapping) {
  if (!mapping || typeof mapping !== 'object') return payload;

  const result = {};
  for (const [targetField, sourcePath] of Object.entries(mapping)) {
    const parts = String(sourcePath).split('.');
    let value = payload;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') { value = undefined; break; }
      value = value[part];
    }
    if (value !== undefined) result[targetField] = value;
  }
  return result;
}

module.exports = {
  validateIMO,
  validateVesselPayload,
  validateVoyagePayload,
  validateCrewPayload,
  applyFieldMapping,
};
