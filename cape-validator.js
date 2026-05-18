/**
 * cape-validator.js — Cape of Good Hope ISPS Pre-Arrival compliance validator
 *
 * Owns: all validation logic for ISPS pre-arrival notifications filed with SAMSA
 *   (South African Maritime Safety Authority) under Marine Notice 12 of 2008.
 * Does NOT own: database access, filing CRUD, PDF generation, or vessel lookup.
 *
 * Regulatory basis:
 *  - SAMSA Marine Notice 12 of 2008: ISPS Code pre-arrival notification (96h window)
 *  - SOLAS Chapter XI-2 / ISPS Code Part A: Ship Security Levels 1/2/3
 *  - IMDG Code: Dangerous goods class declarations
 *  - IMO Circular FAL.2/Circ.128 — advance notification of ship arrival
 *  - South African Ports Act 12 of 2005: port entry requirements
 *  - MARPOL Annex I/II: Cape Town / Port Elizabeth pre-arrival documentation
 *  - IMO Resolution A.851(20): ship reporting system requirements
 */

'use strict';

// ── SAMSA ISPS filing constants ────────────────────────────────────────────────

const CAPE_LIMITS = {
  advanceHours:       96,   // hours — mandatory ISPS pre-arrival notice (SAMSA Marine Notice 12/2008)
  advisoryHours:     120,   // hours — recommended lead time for large vessels
  minPortsHistory:    10,   // last 10 ports required per ISPS Code Part B §9.38
  minCrewCount:        2,   // minimum declared crew for ISPS verification
  validIspsLevels: [1, 2, 3],
};

// ── Recognized flag states (ISO 3166-1 alpha-2 country codes used in shipping) ─

const RECOGNIZED_FLAGS = new Set([
  'AG','AI','AN','AO','AR','AT','AU','AW','AZ','BA','BB','BD','BE','BG','BH',
  'BJ','BM','BN','BO','BR','BS','BZ','CA','CG','CI','CL','CM','CN','CO','CR',
  'CU','CV','CW','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EG','ER','ES',
  'ET','FI','FJ','FK','FR','GA','GB','GD','GE','GH','GI','GL','GM','GN','GQ',
  'GR','GT','GY','HK','HN','HR','HT','HU','ID','IE','IL','IN','IQ','IR','IS',
  'IT','JM','JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','MG',
  'MH','MK','ML','MM','MN','MO','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NG','NI','NL','NO','NP','NR','NZ','OM','PA','PE','PF','PG','PH','PK',
  'PL','PR','PT','PW','PY','QA','RO','RS','RU','SA','SB','SC','SD','SE','SG',
  'SH','SI','SK','SL','SN','SO','SR','ST','SV','SX','SY','SZ','TC','TD','TG',
  'TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US',
  'UY','UZ','VC','VE','VG','VN','VU','WS','YE','ZA','ZM','ZW',
  // Commonly used as flag states in shipping (full names also accepted below)
]);

// Full country names accepted in addition to codes
const RECOGNIZED_FLAG_NAMES = new Set([
  'panama', 'liberia', 'marshall islands', 'bahamas', 'malta', 'cyprus',
  'singapore', 'hong kong', 'greece', 'united kingdom', 'china', 'norway',
  'italy', 'japan', 'united states', 'south korea', 'germany', 'bermuda',
  'antigua and barbuda', 'isle of man', 'cayman islands', 'denmark',
  'vanuatu', 'saint kitts and nevis', 'tuvalu', 'palau', 'cook islands',
  'cambodia', 'belize', 'comoros', 'georgia', 'moldova', 'sierra leone',
  'tanzania', 'indonesia', 'india', 'russia', 'brazil', 'turkey', 'nigeria',
  'south africa', 'australia', 'france', 'netherlands', 'belgium', 'sweden',
  'finland', 'portugal', 'spain', 'switzerland', 'austria', 'canada',
]);

function isFlagRecognized(flag) {
  if (!flag) return false;
  const upper = flag.toUpperCase().trim();
  if (RECOGNIZED_FLAGS.has(upper)) return true;
  return RECOGNIZED_FLAG_NAMES.has(flag.toLowerCase().trim());
}

// ── IMO checksum validation ────────────────────────────────────────────────────

function validateIMOChecksum(imo) {
  const digits = imo.replace(/^IMO\s*/i, '').trim();
  if (!/^\d{7}$/.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const check = nums[6];
  const sum = nums[0]*7 + nums[1]*6 + nums[2]*5 + nums[3]*4 + nums[4]*3 + nums[5]*2;
  return (sum % 10) === check;
}

// ── Hazmat class definitions ───────────────────────────────────────────────────

const DG_REQUIRES_DECLARATION = new Set(['1','2','3','4','5.1','5.2','6.1','6.2','7','8','9']);

// ── Check builder ─────────────────────────────────────────────────────────────

function check(id, status, name, message, requirement) {
  return { id, status, name, message, requirement };
}

function buildResult(canal, checks) {
  const passed   = checks.filter(c => c.status === 'pass').length;
  const failed   = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  const score = failed === 0 && warnings === 0
    ? 100
    : Math.max(0, Math.round(100 - (failed * 15) - (warnings * 5)));

  return {
    canal,
    overall_status:   failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed',
    compliance_score: score,
    total_checks:     checks.length,
    passed_checks:    passed,
    failed_checks:    failed,
    warning_checks:   warnings,
    checklist:        checks,
    critical_errors:  checks.filter(c => c.status === 'fail'),
    warnings_list:    checks.filter(c => c.status === 'warning'),
    passed_list:      checks.filter(c => c.status === 'pass'),
    categories: {
      critical: checks.filter(c => c.status === 'fail'),
      warnings: checks.filter(c => c.status === 'warning'),
      passed:   checks.filter(c => c.status === 'pass'),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Cape of Good Hope ISPS pre-arrival notification.
 *
 * @param {object} filing - form fields from the Cape demo form
 * @returns {object} validation result with checklist, score, categories
 */
function validateCapeFiling(filing) {
  const checks = [];

  // ── 1. IMO number — format + checksum ────────────────────────────────────────
  if (!filing.imo_number) {
    checks.push(check('imo_required', 'fail', 'IMO Number',
      'IMO number is required for ISPS pre-arrival notification.',
      'SAMSA Marine Notice 12/2008 — mandatory vessel identification'));
  } else {
    const raw = filing.imo_number.replace(/^IMO\s*/i, '').trim();
    if (!/^\d{7}$/.test(raw)) {
      checks.push(check('imo_format', 'fail', 'IMO Number Format',
        'IMO number must be exactly 7 digits.',
        'IMO standard — 7-digit vessel identifier'));
    } else if (!validateIMOChecksum(filing.imo_number)) {
      checks.push(check('imo_checksum', 'fail', 'IMO Checksum',
        'IMO number fails checksum validation. Verify the number is correct.',
        'IMO — check digit algorithm (digits × weights 7-2, mod 10)'));
    } else {
      checks.push(check('imo_valid', 'pass', 'IMO Number',
        'IMO number valid — checksum confirmed.', ''));
    }
  }

  // ── 2. Vessel name ───────────────────────────────────────────────────────────
  if (!filing.vessel_name || String(filing.vessel_name).trim().length < 2) {
    checks.push(check('vessel_name_required', 'fail', 'Vessel Name',
      'Vessel name is required for ISPS pre-arrival notification.',
      'SAMSA Marine Notice 12/2008 — mandatory field'));
  } else {
    checks.push(check('vessel_name_valid', 'pass', 'Vessel Name',
      `"${filing.vessel_name}" — vessel identification confirmed.`, ''));
  }

  // ── 3. Flag state ────────────────────────────────────────────────────────────
  if (!filing.flag_state) {
    checks.push(check('flag_required', 'fail', 'Flag State',
      'Flag state is required for ISPS identification.',
      'ISPS Code Part A §2.1 — flag state identity mandatory'));
  } else if (!isFlagRecognized(filing.flag_state)) {
    checks.push(check('flag_unrecognized', 'warning', 'Flag State — Unrecognized',
      `"${filing.flag_state}" is not a recognized IMO member flag state. Verify spelling.`,
      'ISPS Code — vessel must be flagged to an IMO member state'));
  } else {
    checks.push(check('flag_valid', 'pass', 'Flag State',
      `${filing.flag_state} — recognized flag state.`, ''));
  }

  // ── 4. Call sign ─────────────────────────────────────────────────────────────
  if (!filing.call_sign) {
    checks.push(check('callsign_required', 'warning', 'Call Sign',
      'Call sign recommended for SAMSA radio communications.',
      'SAMSA — VHF identification for port entry clearance'));
  } else {
    checks.push(check('callsign_ok', 'pass', 'Call Sign',
      `${filing.call_sign} — radio identification confirmed.`, ''));
  }

  // ── 5. Port of origin ────────────────────────────────────────────────────────
  if (!filing.port_of_origin) {
    checks.push(check('port_origin_required', 'fail', 'Port of Origin',
      'Port of origin / last port of call is required.',
      'SAMSA Marine Notice 12/2008 — voyage history required'));
  } else {
    checks.push(check('port_origin_ok', 'pass', 'Port of Origin',
      `${filing.port_of_origin} — last port of call confirmed.`, ''));
  }

  // ── 6. ETA — 96-hour pre-arrival window ──────────────────────────────────────
  if (!filing.estimated_arrival) {
    checks.push(check('eta_required', 'fail', 'ETA (96-Hour Window)',
      'Estimated time of arrival is required for ISPS pre-arrival filing.',
      'SAMSA Marine Notice 12/2008 — 96h advance notification mandatory'));
  } else {
    const etaMs = new Date(filing.estimated_arrival).getTime();
    const nowMs = Date.now();
    const hoursAhead = (etaMs - nowMs) / (1000 * 60 * 60);

    if (hoursAhead < 0) {
      checks.push(check('eta_past', 'fail', 'ETA in the Past',
        'ETA cannot be in the past. ISPS notification must precede port arrival.',
        'SAMSA — notification must be filed before vessel arrival'));
    } else if (hoursAhead < CAPE_LIMITS.advanceHours) {
      checks.push(check('eta_96h_window', 'fail', '96-Hour Pre-Arrival Window',
        `ETA is only ${Math.round(hoursAhead)}h away. SAMSA requires 96-hour advance ISPS notification.`,
        'SAMSA Marine Notice 12/2008 — 96h mandatory pre-arrival window'));
    } else if (hoursAhead < CAPE_LIMITS.advisoryHours) {
      checks.push(check('eta_advisory', 'warning', 'ETA Lead Time',
        `${Math.round(hoursAhead)}h notice. 120h recommended for vessels with hazmat or security level 2/3.`,
        'SAMSA advisory — additional lead time for complex filings'));
    } else {
      checks.push(check('eta_ok', 'pass', '96-Hour Pre-Arrival Window',
        `${Math.round(hoursAhead)}h advance notice — exceeds SAMSA 96h mandatory window.`, ''));
    }
  }

  // ── 7. Cargo summary ─────────────────────────────────────────────────────────
  if (!filing.cargo_summary || String(filing.cargo_summary).trim().length < 5) {
    checks.push(check('cargo_required', 'fail', 'Cargo Summary',
      'Cargo summary is required for ISPS security assessment.',
      'ISPS Code Part B §9.38 — cargo description for security screening'));
  } else {
    checks.push(check('cargo_ok', 'pass', 'Cargo Summary',
      'Cargo declaration provided.', ''));
  }

  // ── 8. Crew count ────────────────────────────────────────────────────────────
  const crew = parseInt(filing.crew_count);
  if (!crew || crew < 1) {
    checks.push(check('crew_required', 'fail', 'Crew Count',
      'Total crew count is required for ISPS port entry screening.',
      'SOLAS Regulation V/14 — manning level declaration mandatory'));
  } else if (crew < CAPE_LIMITS.minCrewCount) {
    checks.push(check('crew_minimum', 'fail', 'Crew — Minimum Manning',
      `${crew} crew declared. Minimum 2 crew required for SOLAS minimum manning certificate.`,
      'SOLAS Regulation V/14 — minimum safe manning'));
  } else {
    checks.push(check('crew_ok', 'pass', 'Crew Count',
      `${crew} crew declared — manning requirements met.`, ''));
  }

  // ── 9. ISPS security level ───────────────────────────────────────────────────
  const ispsLevel = parseInt(filing.isps_security_level);
  if (!ispsLevel) {
    checks.push(check('isps_level_required', 'fail', 'ISPS Security Level',
      'ISPS security level (1, 2, or 3) is required. South African ports operate at minimum MARSEC Level 1.',
      'ISPS Code Part A §3 — security level declaration mandatory'));
  } else if (!CAPE_LIMITS.validIspsLevels.includes(ispsLevel)) {
    checks.push(check('isps_level_invalid', 'fail', 'ISPS Security Level Invalid',
      `Security level ${ispsLevel} is not valid. Must be 1 (normal), 2 (heightened), or 3 (exceptional).`,
      'ISPS Code Part A §3 — valid levels: 1, 2, 3'));
  } else if (ispsLevel === 3) {
    checks.push(check('isps_level_3', 'warning', 'ISPS Security Level 3 — Exceptional',
      'Security Level 3 is exceptional. SAMSA and South African Port Authority (SAMSA/Transnet) coordination required before port entry.',
      'ISPS Code Part A §8 — Level 3 requires authority coordination'));
  } else if (ispsLevel === 2) {
    checks.push(check('isps_level_2', 'warning', 'ISPS Security Level 2 — Heightened',
      'Security Level 2 is heightened. Additional security measures apply. Notify SAMSA in advance.',
      'ISPS Code Part A §7 — heightened measures apply'));
  } else {
    checks.push(check('isps_level_ok', 'pass', 'ISPS Security Level',
      `MARSEC Level ${ispsLevel} — standard security declaration.`, ''));
  }

  // ── 10. Last 10 ports of call ────────────────────────────────────────────────
  let ports10 = filing.last_10_ports;
  if (typeof ports10 === 'string') {
    try { ports10 = JSON.parse(ports10); } catch (_) { ports10 = []; }
  }
  const portsArr = Array.isArray(ports10) ? ports10 : [];

  if (portsArr.length === 0) {
    checks.push(check('ports10_required', 'fail', 'Last 10 Ports of Call',
      'Last 10 ports of call are required for ISPS security review.',
      'ISPS Code Part B §9.38 — last 10 ports mandatory for security assessment'));
  } else if (portsArr.length < CAPE_LIMITS.minPortsHistory) {
    checks.push(check('ports10_incomplete', 'warning', 'Last 10 Ports — Incomplete',
      `Only ${portsArr.length} of the last 10 ports provided. Provide all 10 for full ISPS compliance.`,
      'SAMSA Marine Notice 12/2008 — full 10-port history required'));
  } else {
    checks.push(check('ports10_ok', 'pass', 'Last 10 Ports of Call',
      `${portsArr.length} ports of call declared — ISPS history complete.`, ''));
  }

  // ── 11. Dangerous goods declaration ──────────────────────────────────────────
  const hasDG = !!(filing.has_dangerous_goods);
  const dgClass = filing.dangerous_goods_class;

  if (hasDG) {
    if (!dgClass) {
      checks.push(check('dg_class_required', 'fail', 'DG Class Required',
        'Dangerous goods class must be declared when hazardous cargo is present.',
        'IMDG Code — class declaration mandatory for DG cargo'));
    } else if (!DG_REQUIRES_DECLARATION.has(String(dgClass))) {
      checks.push(check('dg_class_invalid', 'warning', 'DG Class — Verify',
        `Class "${dgClass}" is not a standard IMDG class. Verify the declaration.`,
        'IMDG Code — valid classes: 1-9 (with sub-divisions)'));
    } else if (['1', '7'].includes(String(dgClass))) {
      checks.push(check('dg_restricted', 'fail', 'Restricted DG — SAMSA Pre-Approval',
        `IMDG Class ${dgClass} cargo requires SAMSA pre-approval before port entry. File separate DG notification.`,
        'South African Ports Act 12 of 2005 — Class 1 explosives/Class 7 radioactives require prior approval'));
    } else {
      checks.push(check('dg_declared', 'pass', 'Dangerous Goods Declaration',
        `IMDG Class ${dgClass} declared. Ensure SAMSA DG notification is filed separately.`, ''));
    }
  } else {
    checks.push(check('dg_none', 'pass', 'Dangerous Goods',
      'No dangerous goods — standard ISPS pre-arrival applies.', ''));
  }

  // ── 12. Ship Security Officer (SSO) details ───────────────────────────────────
  const hasSSOName    = filing.sso_name    && String(filing.sso_name).trim().length > 1;
  const hasSSOContact = filing.sso_contact && String(filing.sso_contact).trim().length > 1;

  if (!hasSSOName) {
    checks.push(check('sso_name_required', 'fail', 'Ship Security Officer — Name',
      'Ship Security Officer (SSO) name is required for ISPS filing.',
      'ISPS Code Part A §12 — SSO designation mandatory'));
  } else if (!hasSSOContact) {
    checks.push(check('sso_contact_required', 'fail', 'Ship Security Officer — Contact',
      'SSO contact details (phone/VHF) required for SAMSA communications.',
      'SAMSA Marine Notice 12/2008 — SSO contact for security coordination'));
  } else {
    checks.push(check('sso_ok', 'pass', 'Ship Security Officer',
      `SSO ${filing.sso_name} — contact details on file.`, ''));
  }

  return buildResult('cape', checks);
}

module.exports = { validateCapeFiling, CAPE_LIMITS, validateIMOChecksum };
