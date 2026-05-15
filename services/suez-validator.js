/**
 * Suez Canal Compliance Validator
 *
 * Validates vessel filings against SCA (Suez Canal Authority) requirements.
 * Covers all seven Suez document types:
 *   - sca_transit_application  (SCA pre-arrival notice)
 *   - suez_crew_manifest       (Suez-specific crew list)
 *   - suez_cargo_declaration   (IMDG Amendment 42-24 compliant)
 *   - suez_isps_declaration    (ISPS vessel security plan)
 *   - suez_sopep               (Suez oil pollution emergency plan)
 *   - suez_ballast_water       (BWM Convention declaration)
 *   - suez_tonnage_certificate (SCNT certificate data)
 *
 * Key differences from Panama VUMPA validator:
 *  - SCNT (not PC/UMS) tonnage for toll calculation
 *  - Separate forward/aft draft readings required
 *  - 48h mandatory ETA (vs ACP's 96h)
 *  - IMDG Amendment 42-24 lithium battery classifications
 *  - Three-stage ISPS pre-arrival notifications (72h/48h/24h)
 *  - Convoy system (vs Panama's one-way lock scheduling)
 *  - El-Ferdan Railway Bridge air draft constraint (70m)
 *  - Yellow fever declaration for crew from endemic countries
 *  - ENRRA permit for Class 7 radioactive cargo
 */

// ── SCA Dimensional Limits ────────────────────────────────────────────────────

const SCA_LIMITS = {
  maxLOA:           400,    // meters (solo transit; >400m needs special approval)
  maxBeam:          77.5,   // meters (post-2015 expansion)
  maxDraft:         18.90,  // meters (hard limit — 62-foot channel)
  advisoryDraft:    17.68,  // meters (varies seasonally; check SCA Notice to Mariners)
  maxAirDraft:      70,     // meters (El-Ferdan Railway Bridge)
  advisoryAirDraft: 68,     // meters (approach limit triggering advance SCA coordination)
  minEtaHours:      48,     // minimum pre-arrival notice (hard requirement)
  advisoryEtaHours: 96,     // recommended for convoy assignment
};

// ── IMDG Amendment 42-24 — Lithium Battery UN Numbers ────────────────────────
// These are the most commonly misclassified DG items at Suez (45% of errors per research)

const LITHIUM_BATTERY_UN_NUMBERS = new Set([
  'UN3090', // Lithium metal batteries (standalone)
  'UN3091', // Lithium metal batteries contained in or packed with equipment
  'UN3480', // Lithium ion batteries (standalone)
  'UN3481', // Lithium ion batteries contained in or packed with equipment
]);

const LITHIUM_BATTERY_IMDG_CLASS = '9';

// ── DG classes requiring SCA special/advance approval ────────────────────────
const SCA_RESTRICTED_DG_CLASSES = {
  '1':   { restriction: 'prior_approval_72h',  notes: 'SCA explosives permit + 72h advance notice required.' },
  '1.1': { restriction: 'prior_approval_72h',  notes: 'SCA explosives permit required. Daytime transit only with SCA escort.' },
  '1.2': { restriction: 'prior_approval_72h',  notes: 'SCA explosives permit required. Daytime transit only.' },
  '1.3': { restriction: 'prior_approval_72h',  notes: 'SCA explosives permit required.' },
  '1.4': { restriction: 'prior_approval_72h',  notes: 'SCA prior notification required.' },
  '7':   { restriction: 'sca_enrra_permit',    notes: 'SCA approval + ENRRA (Egyptian Nuclear and Radiological Regulatory Authority) permit required. 30+ day lead time.' },
};

// ── Convoy options ────────────────────────────────────────────────────────────
const VALID_CONVOY_PREFERENCES = [
  'first_northbound',    // Port Said ~06:00 LT
  'second_northbound',   // Port Said ~12:00 LT
  'southbound',          // Suez port ~07:00 LT
  'single',              // Special arrangement (oversized, hazmat, etc.)
];

// ── Shared vessel types (same as Panama) ──────────────────────────────────────
const VALID_VESSEL_TYPES = [
  'bulk_carrier', 'container', 'tanker', 'lng_carrier', 'lpg_carrier',
  'vehicle_carrier', 'general_cargo', 'reefer', 'cruise', 'ro_ro',
  'chemical_tanker', 'offshore', 'tug', 'yacht', 'naval', 'other',
];

// ── BWM Standards ─────────────────────────────────────────────────────────────
const VALID_BWM_STANDARDS = ['D-1', 'D-2', 'exemption'];

// ── Classification societies approved for SCNT certificates ──────────────────
const SCNT_APPROVED_SOCIETIES = [
  "Lloyd's Register", 'LR',
  'DNV', 'Bureau Veritas', 'BV',
  'American Bureau of Shipping', 'ABS',
  'ClassNK', 'Nippon Kaiji Kyokai',
  'RINA', 'Registro Italiano Navale',
  'Korean Register', 'KR',
  'China Classification Society', 'CCS',
  'Indian Register of Shipping', 'IRS',
  'Russian Maritime Register', 'RS',
  'SCA', 'Suez Canal Authority',
];


// ─────────────────────────────────────────────────────────────────────────────
// DB RULES: Build effective limits by overlaying DB rule thresholds
// Allows rule thresholds to be updated via admin without code changes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map suez_validation_rules.rule_key to SCA_LIMITS property names.
 * Only threshold rules with a numeric threshold_value are used as overrides.
 */
const DB_RULE_KEY_TO_LIMIT = {
  'sca_eta_minimum_hours':    'minEtaHours',
  'sca_eta_recommended_hours':'advisoryEtaHours',
  'sca_beam_maximum':         'maxBeam',
  'sca_draft_maximum':        'maxDraft',
  'sca_draft_advisory':       'advisoryDraft',
  'sca_air_draft_maximum':    'maxAirDraft',
  'sca_air_draft_advisory':   'advisoryAirDraft',
  'sca_loa_maximum':          'maxLOA',
};

/**
 * Build effective SCA limits from DB rules.
 * DB rules win over hard-coded defaults where active and numeric.
 * Falls back to SCA_LIMITS if DB has no entry.
 */
function buildEffectiveLimits(dbRules = []) {
  const limits = { ...SCA_LIMITS };
  for (const rule of dbRules) {
    const limitKey = DB_RULE_KEY_TO_LIMIT[rule.rule_key];
    if (limitKey && rule.threshold_value != null && rule.active !== false) {
      const parsed = parseFloat(rule.threshold_value);
      if (!isNaN(parsed)) {
        limits[limitKey] = parsed;
      }
    }
  }
  return limits;
}

/**
 * Set of rule_keys already handled by hard-coded validators.
 * Supplemental DB rules only run for keys NOT in this set.
 */
const HARD_CODED_RULE_KEYS = new Set([
  'sca_eta_minimum_hours', 'sca_eta_recommended_hours',
  'sca_scnt_required', 'sca_scnt_minimum', 'sca_scnt_ratio',
  'sca_beam_maximum', 'sca_draft_maximum', 'sca_draft_advisory',
  'sca_air_draft_maximum', 'sca_air_draft_advisory', 'sca_loa_maximum',
  'sca_imo_required', 'sca_flag_state_required', 'sca_vessel_type_required',
  'sca_transit_direction_required', 'sca_convoy_preference_required',
  'sca_master_name_required', 'sca_crew_count_required',
  'sca_dg_class_required', 'sca_issc_required', 'sca_vessel_security_level',
  'sca_isps_72h', 'sca_isps_48h', 'sca_isps_24h', 'sca_last_10_ports',
  'sca_bwm_cert_required', 'sca_bwm_standard_required',
  'sca_sopep_plan_reference', 'sca_sopep_expiry',
  'sca_tonnage_cert_issuing_authority',
  'sca_lithium_battery_class_un3480', 'sca_lithium_battery_class_un3481',
  'sca_lithium_battery_class_un3090', 'sca_lithium_battery_class_un3091',
]);

/**
 * Run supplemental checks from DB rules that are NOT already covered by
 * hard-coded validators. Handles rule_type='required' and 'threshold'.
 * This is the extension point: operators add rules via admin, they run here.
 */
function applySupplementalDbRules(filingData, dbRules, docType) {
  const supplemental = [];
  const data = filingData;
  const d = data.document_data || {};

  for (const rule of dbRules) {
    // Skip if already handled by hard-coded validator
    if (HARD_CODED_RULE_KEYS.has(rule.rule_key)) continue;
    // Skip if this rule doesn't apply to the current document type
    let appliesTo = rule.applies_to;
    if (typeof appliesTo === 'string') {
      try { appliesTo = JSON.parse(appliesTo); } catch { appliesTo = [appliesTo]; }
    }
    if (Array.isArray(appliesTo) && !appliesTo.includes(docType)) continue;

    const severity = rule.severity === 'error' ? 'fail' : rule.severity === 'warning' ? 'warning' : 'pass';

    if (rule.rule_type === 'required') {
      const field = rule.required_field;
      const val = data[field] != null ? data[field] : d[field];
      const isPresent = val != null && val !== '' && val !== false;
      supplemental.push(check(
        rule.rule_key,
        isPresent ? 'pass' : severity,
        rule.rule_name,
        isPresent ? (rule.pass_message || `${field} provided.`) : (rule.fail_message || `${field} is required.`),
        rule.description || rule.rule_name
      ));
    } else if (rule.rule_type === 'threshold' && rule.threshold_value != null) {
      const field = rule.threshold_field || rule.required_field;
      if (!field) continue;
      const raw = data[field] != null ? data[field] : d[field];
      const val = parseFloat(raw);
      if (isNaN(val)) continue;

      const threshold = parseFloat(rule.threshold_value);
      let passes;
      switch (rule.threshold_op) {
        case '>=': passes = val >= threshold; break;
        case '<=': passes = val <= threshold; break;
        case '>':  passes = val > threshold;  break;
        case '<':  passes = val < threshold;  break;
        case '=':  passes = val === threshold; break;
        default:   passes = true;
      }
      supplemental.push(check(
        rule.rule_key,
        passes ? 'pass' : severity,
        rule.rule_name,
        passes ? (rule.pass_message || `${field} OK.`) : (rule.fail_message || `${field} failed threshold check.`),
        rule.description || rule.rule_name
      ));
    }
  }

  return supplemental;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Build categorized validation result
// (Same shape as Panama validator for frontend compatibility)
// ─────────────────────────────────────────────────────────────────────────────

function buildCategorizedResult(checks) {
  const passed   = checks.filter(c => c.status === 'pass').length;
  const failed   = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  const overallStatus = failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed';

  return {
    canal: 'suez',
    overall_status:  overallStatus,
    total_checks:    checks.length,
    passed_checks:   passed,
    failed_checks:   failed,
    warning_checks:  warnings,
    checklist:       checks,
    // Structured for frontend error display
    critical_errors: checks.filter(c => c.status === 'fail'),
    warnings_list:   checks.filter(c => c.status === 'warning'),
    passed_list:     checks.filter(c => c.status === 'pass'),
  };
}

function check(id, status, name, message, requirement) {
  return { id, status, name, message, requirement };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: SCA Transit Application
// ─────────────────────────────────────────────────────────────────────────────

function validateTransitApplication(data, limits = SCA_LIMITS) {
  const checks = [];
  const d = data.document_data || {};

  // ── Vessel Identification ──────────────────────────────────────────────────

  checks.push(
    data.vessel_name && data.vessel_name.trim().length >= 2
      ? check('vessel_name', 'pass', 'Vessel Name', 'Vessel name provided.', 'SCA transit application requires vessel name.')
      : check('vessel_name', 'fail', 'Vessel Name', 'Vessel name is required.', 'SCA transit application requires vessel name.')
  );

  const imoValid = data.imo_number && /^\d{7}$/.test(data.imo_number.replace(/^IMO\s*/i, ''));
  checks.push(
    imoValid
      ? check('imo_number', 'pass', 'IMO Number', 'IMO number format valid (7 digits).', 'SCA requires valid 7-digit IMO number.')
      : check('imo_number', 'fail', 'IMO Number', 'IMO number must be exactly 7 digits. Example: 9876543.', 'SCA requires valid 7-digit IMO number.')
  );

  checks.push(
    data.flag_state && data.flag_state.length === 2
      ? check('flag_state', 'pass', 'Flag State', `Flag state (${data.flag_state}) provided.`, 'SCA requires ISO 3166-1 alpha-2 flag state code.')
      : check('flag_state', 'fail', 'Flag State', 'Flag state is required. Use ISO 3166-1 alpha-2 code (e.g., PA, LR, MH).', 'SCA requires valid flag state.')
  );

  if (data.vessel_type) {
    checks.push(
      VALID_VESSEL_TYPES.includes(data.vessel_type)
        ? check('vessel_type', 'pass', 'Vessel Type', `Vessel type "${data.vessel_type}" is valid.`, 'SCA requires valid vessel type for convoy assignment.')
        : check('vessel_type', 'fail', 'Vessel Type', `"${data.vessel_type}" is not a recognized SCA vessel type.`, 'Use a standard IMO vessel type classification.')
    );
  } else {
    checks.push(check('vessel_type', 'fail', 'Vessel Type', 'Vessel type is required for SCA convoy and toll calculation.', 'SCA requires vessel type.'));
  }

  // ── Dimensional Limits ────────────────────────────────────────────────────

  if (data.loa) {
    if (data.loa > limits.maxLOA) {
      checks.push(check('loa', 'fail', 'Length Overall (LOA)',
        `LOA ${data.loa}m exceeds SCA maximum of ${limits.maxLOA}m. Special SCA approval required.`,
        `SCA max LOA: ${limits.maxLOA}m. Vessels over limit need special convoy arrangements.`));
    } else {
      checks.push(check('loa', 'pass', 'Length Overall (LOA)',
        `LOA ${data.loa}m within SCA maximum (${limits.maxLOA}m).`,
        `SCA max LOA: ${limits.maxLOA}m.`));
    }
  }

  if (data.beam) {
    if (data.beam > limits.maxBeam) {
      checks.push(check('beam', 'fail', 'Beam',
        `Beam ${data.beam}m exceeds SCA maximum of ${limits.maxBeam}m. This vessel cannot transit the Suez Canal.`,
        `SCA max beam: ${limits.maxBeam}m (post-2015 expansion).`));
    } else {
      checks.push(check('beam', 'pass', 'Beam',
        `Beam ${data.beam}m within SCA maximum (${limits.maxBeam}m).`,
        `SCA max beam: ${limits.maxBeam}m.`));
    }
  }

  // SCA requires separate forward and aft draft readings
  const hasForwardDraft = data.draft_forward != null;
  const hasAftDraft     = data.draft_aft != null;

  if (!hasForwardDraft || !hasAftDraft) {
    checks.push(check('draft_readings', 'fail', 'Forward/Aft Draft Readings',
      `${!hasForwardDraft ? 'Forward draft' : 'Aft draft'} missing. SCA requires BOTH forward and aft draft readings — a single mean draft is not accepted.`,
      'SCA requires separate forward and aft draft readings for trim assessment and convoy assignment.'));
  } else {
    const maxFiledDraft = Math.max(data.draft_forward, data.draft_aft);
    if (maxFiledDraft > limits.maxDraft) {
      checks.push(check('draft_readings', 'fail', 'Draft (Forward/Aft)',
        `Maximum draft ${maxFiledDraft}m exceeds SCA hard limit of ${limits.maxDraft}m (62 feet). Special SCA authority approval required.`,
        `SCA maximum permissible draft: ${limits.maxDraft}m.`));
    } else if (maxFiledDraft > limits.advisoryDraft) {
      checks.push(check('draft_readings', 'warning', 'Draft (Forward/Aft)',
        `Maximum draft ${maxFiledDraft}m exceeds SCA advisory limit (~${limits.advisoryDraft}m). Convoy slot availability may be restricted. Verify current SCA Notice to Mariners for actual advisory draft.`,
        `SCA advisory draft: ~${limits.advisoryDraft}m (varies seasonally).`));
    } else {
      checks.push(check('draft_readings', 'pass', 'Draft (Forward/Aft)',
        `Forward ${data.draft_forward}m / Aft ${data.draft_aft}m — within SCA limits.`,
        'SCA requires separate forward/aft draft readings.'));
    }
  }

  // Air draft check (El-Ferdan Railway Bridge)
  if (data.air_draft != null) {
    if (data.air_draft > limits.maxAirDraft) {
      checks.push(check('air_draft', 'fail', 'Air Draft (El-Ferdan Bridge)',
        `Air draft ${data.air_draft}m exceeds El-Ferdan Railway Bridge clearance of ${limits.maxAirDraft}m. Bridge swing must be scheduled with SCA.`,
        `El-Ferdan Railway Bridge clearance: ${limits.maxAirDraft}m.`));
    } else if (data.air_draft > limits.advisoryAirDraft) {
      checks.push(check('air_draft', 'warning', 'Air Draft (El-Ferdan Bridge)',
        `Air draft ${data.air_draft}m approaches El-Ferdan Railway Bridge limit (${limits.maxAirDraft}m). Advance SCA coordination and bridge swing scheduling required.`,
        `Advisory air draft limit: ${limits.advisoryAirDraft}m.`));
    } else {
      checks.push(check('air_draft', 'pass', 'Air Draft (El-Ferdan Bridge)',
        `Air draft ${data.air_draft}m within El-Ferdan Railway Bridge clearance.`,
        `El-Ferdan Railway Bridge clearance: ${limits.maxAirDraft}m.`));
    }
  }

  // ── SCNT Tonnage ─────────────────────────────────────────────────────────

  if (data.scnt == null) {
    checks.push(check('scnt', 'fail', 'Suez Canal Net Tonnage (SCNT)',
      'SCNT is required for SCA toll calculation. This is distinct from Gross Tonnage (GT) and Panama\'s PC/UMS system. Obtain an SCNT certificate from your classification society.',
      'SCA toll calculation is based on SCNT, not GT.'));
  } else if (data.scnt <= 0) {
    checks.push(check('scnt', 'fail', 'Suez Canal Net Tonnage (SCNT)',
      `SCNT value ${data.scnt} is invalid. Must be a positive number.`,
      'SCNT must be a positive value from a valid SCNT certificate.'));
  } else {
    // Sanity check: SCNT should be 30-90% of GT
    if (data.gross_tonnage && data.gross_tonnage > 0) {
      const ratio = data.scnt / data.gross_tonnage;
      if (ratio < 0.30) {
        checks.push(check('scnt', 'warning', 'Suez Canal Net Tonnage (SCNT)',
          `SCNT (${data.scnt}) is unusually low relative to GT (${data.gross_tonnage}) — ratio ${(ratio * 100).toFixed(1)}%. Verify this is SCNT and not ITC Net Tonnage (NT), which is a different measure.`,
          'SCNT is typically 55-85% of GT. Very low ratios may indicate data entry error.'));
      } else {
        checks.push(check('scnt', 'pass', 'Suez Canal Net Tonnage (SCNT)',
          `SCNT ${data.scnt} (${(ratio * 100).toFixed(1)}% of GT ${data.gross_tonnage}) — within expected range.`,
          'SCNT valid for toll calculation.'));
      }
    } else {
      checks.push(check('scnt', 'pass', 'Suez Canal Net Tonnage (SCNT)',
        `SCNT ${data.scnt} provided.`,
        'SCNT valid for toll calculation.'));
    }
  }

  // ── ETA / Pre-Arrival Notice ──────────────────────────────────────────────

  if (d.eta) {
    const etaDate = new Date(d.eta);
    const now = new Date();
    const hoursUntilETA = (etaDate - now) / (1000 * 60 * 60);

    if (hoursUntilETA < limits.minEtaHours) {
      checks.push(check('eta', 'fail', 'ETA Pre-Arrival Notice',
        `ETA is ${hoursUntilETA < 0 ? 'in the past' : `only ${hoursUntilETA.toFixed(0)} hours from now`}. SCA requires minimum ${limits.minEtaHours}-hour pre-arrival notice. Filing will be rejected.`,
        `SCA minimum pre-arrival notice: ${limits.minEtaHours} hours.`));
    } else if (hoursUntilETA < limits.advisoryEtaHours) {
      checks.push(check('eta', 'warning', 'ETA Pre-Arrival Notice',
        `ETA is ${hoursUntilETA.toFixed(0)} hours from now. Meets SCA minimum (${limits.minEtaHours}h) but less than recommended ${limits.advisoryEtaHours}h — convoy assignment may be limited.`,
        `SCA recommends ${limits.advisoryEtaHours}-hour advance notice for convoy placement.`));
    } else {
      checks.push(check('eta', 'pass', 'ETA Pre-Arrival Notice',
        `ETA ${etaDate.toUTCString()} — ${hoursUntilETA.toFixed(0)} hours from now. Meets SCA ${limits.advisoryEtaHours}h recommendation.`,
        'SCA pre-arrival ETA requirement satisfied.'));
    }
  } else {
    checks.push(check('eta', 'fail', 'ETA Pre-Arrival Notice',
      'ETA (Estimated Time of Arrival) is required for SCA transit application.',
      'SCA requires ETA at Port Said or Suez anchorage.'));
  }

  // ── Transit Direction ─────────────────────────────────────────────────────

  if (d.transit_direction) {
    checks.push(
      ['northbound', 'southbound'].includes(d.transit_direction)
        ? check('transit_direction', 'pass', 'Transit Direction', `Transit direction: ${d.transit_direction}.`, 'SCA requires northbound or southbound declaration.')
        : check('transit_direction', 'fail', 'Transit Direction', `"${d.transit_direction}" is not valid. Must be "northbound" or "southbound".`, 'SCA requires transit direction.')
    );
  } else {
    checks.push(check('transit_direction', 'fail', 'Transit Direction',
      'Transit direction (northbound or southbound) is required.',
      'SCA convoy assignment depends on transit direction.'));
  }

  // ── Convoy Preference ─────────────────────────────────────────────────────

  if (d.convoy_preference) {
    checks.push(
      VALID_CONVOY_PREFERENCES.includes(d.convoy_preference)
        ? check('convoy_preference', 'pass', 'Convoy Preference', `Convoy preference: "${d.convoy_preference}".`, 'SCA convoy assignment requires preference declaration.')
        : check('convoy_preference', 'fail', 'Convoy Preference', `"${d.convoy_preference}" is not a valid convoy option. Use: ${VALID_CONVOY_PREFERENCES.join(', ')}.`, 'SCA requires valid convoy preference.')
    );
  } else {
    checks.push(check('convoy_preference', 'fail', 'Convoy Preference',
      `Convoy preference is required. Options: ${VALID_CONVOY_PREFERENCES.join(', ')}.`,
      'SCA operates convoy system — vessels must declare preference.'));
  }

  // ── Master and Crew ───────────────────────────────────────────────────────

  if (!d.master_name || !d.master_name.trim()) {
    checks.push(check('master_name', 'fail', 'Master Name', 'Master (Captain) name is required for SCA transit application.', 'SCA FAL Form 5 requirement.'));
  } else {
    checks.push(check('master_name', 'pass', 'Master Name', `Master: ${d.master_name}.`, 'Master name provided.'));
  }

  if (d.crew_count == null) {
    checks.push(check('crew_count', 'warning', 'Crew Count', 'Crew count not specified. Required for SCA FAL Form 5.', 'SCA requires total persons on board count.'));
  } else if (d.crew_count < 1) {
    checks.push(check('crew_count', 'fail', 'Crew Count', 'Crew count must be at least 1.', 'Minimum crew required for transit.'));
  } else {
    checks.push(check('crew_count', 'pass', 'Crew Count', `${d.crew_count} crew member(s) declared.`, 'Crew count provided.'));
  }

  // ── Dangerous Goods ───────────────────────────────────────────────────────

  if (d.has_dangerous_goods === true) {
    const dgClass = d.dangerous_goods_class;
    if (!dgClass) {
      checks.push(check('dg_class', 'fail', 'Dangerous Goods Classification',
        'Dangerous goods declared but IMDG class not specified. Class is required for SCA DG assessment.',
        'SCA requires IMDG class for all DG cargo.'));
    } else if (SCA_RESTRICTED_DG_CLASSES[dgClass]) {
      const restriction = SCA_RESTRICTED_DG_CLASSES[dgClass];
      checks.push(check('dg_class', 'fail', 'Dangerous Goods — Restricted Class',
        `Class ${dgClass} cargo: ${restriction.notes}`,
        'SCA has special requirements for certain DG classes.'));
    } else {
      checks.push(check('dg_class', 'pass', 'Dangerous Goods Classification',
        `IMDG Class ${dgClass} declared. Ensure cargo declaration includes UN number, packing group, EMS code, and segregation requirements.`,
        'DG class declared.'));
    }
  } else {
    checks.push(check('dg_declaration', 'pass', 'Dangerous Goods Declaration',
      'No dangerous goods declared.',
      'DG status declared.'));
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez Crew Manifest
// ─────────────────────────────────────────────────────────────────────────────

function validateCrewManifest(data) {
  const checks = [];
  const d = data.document_data || {};
  const crewMembers = d.crew_members || [];

  // Vessel identification
  checks.push(
    data.imo_number
      ? check('imo_number', 'pass', 'IMO Number', 'IMO number provided for crew manifest.', 'Links crew manifest to vessel.')
      : check('imo_number', 'fail', 'IMO Number', 'IMO number required on crew manifest.', 'SCA FAL Form 5 requirement.')
  );

  // Crew members must exist
  if (!crewMembers.length) {
    checks.push(check('crew_members', 'fail', 'Crew Members',
      'No crew members listed. Crew manifest must contain at least the Master.',
      'SCA FAL Form 5 requires all persons on board.'));
    return buildCategorizedResult(checks);
  }

  checks.push(check('crew_members', 'pass', 'Crew Members',
    `${crewMembers.length} crew member(s) listed.`,
    'Crew manifest populated.'));

  // Master must be present
  const hasMaster = crewMembers.some(c => c.rank && c.rank.toLowerCase() === 'master');
  checks.push(
    hasMaster
      ? check('master_present', 'pass', 'Master Listed', 'Master (Captain) found in crew manifest.', 'SCA requires Master to be explicitly listed.')
      : check('master_present', 'fail', 'Master Listed', 'Master (Captain) not found. At least one crew member must have rank "master".', 'SCA FAL Form 5: Master must be listed.')
  );

  // Per-crew validation
  let yellowFeverDeclarationMissing = false;
  let stcwMissingCount = 0;
  const OFFICER_RANKS = ['master', 'chief_officer', 'chief_engineer', 'second_engineer', 'second_officer', 'third_officer'];

  crewMembers.forEach((member, i) => {
    const idx = i + 1;

    if (!member.name || !member.name.trim()) {
      checks.push(check(`crew_${idx}_name`, 'fail', `Crew #${idx}: Full Name`,
        `Crew member #${idx} is missing a name.`, 'SCA requires full legal name for each crew member.'));
    }

    if (!member.nationality) {
      checks.push(check(`crew_${idx}_nationality`, 'fail', `Crew #${idx}: Nationality`,
        `Crew member #${idx} (${member.name || 'unnamed'}) nationality not provided.`,
        'SCA FAL Form 5 requires nationality (ISO 3166-1 alpha-2).'));
    }

    if (!member.doc_number) {
      checks.push(check(`crew_${idx}_doc`, 'fail', `Crew #${idx}: Document Number`,
        `Crew member #${idx} (${member.name || 'unnamed'}) travel document number missing.`,
        'Passport or seaman book number required for Egyptian port health entry.'));
    }

    if (!member.dob) {
      checks.push(check(`crew_${idx}_dob`, 'warning', `Crew #${idx}: Date of Birth`,
        `Crew member #${idx} (${member.name || 'unnamed'}) date of birth not provided.`,
        'Required by Egyptian health authorities.'));
    }

    // STCW check for key officers
    const rankLower = (member.rank || '').toLowerCase();
    if (OFFICER_RANKS.includes(rankLower)) {
      if (!member.stcw_expiry) {
        stcwMissingCount++;
      }
    }

    // Yellow fever declaration flag
    if (member.yellow_fever_cert === undefined || member.yellow_fever_cert === null) {
      yellowFeverDeclarationMissing = true;
    }
  });

  if (stcwMissingCount > 0) {
    checks.push(check('stcw_certs', 'warning', 'STCW Certificates — Key Officers',
      `${stcwMissingCount} officer(s) missing STCW certificate expiry date. SCA verifies STCW currency for Master, Chief Officer, Chief Engineer, and Second Engineer at boarding. Expired STCW = transit denial.`,
      'STCW certificates must be current for key officers.'));
  } else {
    checks.push(check('stcw_certs', 'pass', 'STCW Certificates — Key Officers',
      'STCW certificate expiry documented for key officers.',
      'STCW compliance checked.'));
  }

  if (yellowFeverDeclarationMissing) {
    checks.push(check('yellow_fever', 'warning', 'Yellow Fever Certificate Declaration',
      'Yellow fever certificate status not declared for all crew. Egyptian health authorities require a valid yellow card for crew arriving from sub-Saharan Africa or South America (yellow fever endemic countries).',
      'Different from Panama — Egypt enforces its own WHO health requirements.'));
  } else {
    checks.push(check('yellow_fever', 'pass', 'Yellow Fever Certificate Declaration',
      'Yellow fever status declared for crew.',
      'Egyptian health authority requirement satisfied.'));
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez Cargo Declaration (IMDG Amendment 42-24)
// ─────────────────────────────────────────────────────────────────────────────

function validateCargoDeclaration(data) {
  const checks = [];
  const d = data.document_data || {};

  // Bill of Lading
  checks.push(
    d.bl_number
      ? check('bl_number', 'pass', 'Bill of Lading Number', `B/L number: ${d.bl_number}.`, 'Required for laden vessel.')
      : check('bl_number', 'warning', 'Bill of Lading Number', 'Bill of lading number not provided. Required for all laden vessels.', 'SCA cargo declaration requires B/L for laden transits.')
  );

  // Cargo description
  checks.push(
    d.cargo_description
      ? check('cargo_description', 'pass', 'Cargo Description', 'Cargo description provided.', 'Required on SCA cargo declaration.')
      : check('cargo_description', 'fail', 'Cargo Description', 'Cargo description is required.', 'SCA cargo declaration requires cargo description.')
  );

  // DG requirements
  const dgItems = d.dg_requirements || [];

  if (dgItems.length > 0) {
    checks.push(check('dg_declared', 'pass', 'Dangerous Goods',
      `${dgItems.length} DG item(s) declared.`,
      'DG items will be validated against IMDG Amendment 42-24.'));

    dgItems.forEach((item, i) => {
      const idx = i + 1;
      const unNum = (item.un_number || '').toUpperCase().replace(/\s/g, '');

      // ── IMDG 42-24: Lithium Battery checks ──────────────────────────────
      if (LITHIUM_BATTERY_UN_NUMBERS.has(unNum)) {
        const expectedClass = LITHIUM_BATTERY_IMDG_CLASS;
        const filedClass = (item.imdg_class || '').trim();

        if (filedClass !== expectedClass) {
          checks.push(check(`dg_${idx}_lithium_class`, 'fail',
            `DG #${idx}: ${unNum} — IMDG 42-24 Classification`,
            `${unNum} must be declared as Class ${expectedClass} under IMDG Amendment 42-24 (in force 1 Jan 2025). Filed class "${filedClass || 'not set'}" is incorrect. This is the #1 error at Suez — lithium batteries are routinely misclassified as non-DG.`,
            `IMDG Amendment 42-24 requires ${unNum} as Class 9 DG.`));
        } else {
          checks.push(check(`dg_${idx}_lithium_class`, 'pass',
            `DG #${idx}: ${unNum} — IMDG 42-24 Classification`,
            `${unNum} correctly declared as Class ${expectedClass} per IMDG 42-24.`,
            'IMDG Amendment 42-24 compliance confirmed.'));
        }

        // Watt-hour rating for lithium ion batteries
        if ((unNum === 'UN3480' || unNum === 'UN3481') && !item.watt_hour_rating) {
          checks.push(check(`dg_${idx}_wh_rating`, 'warning',
            `DG #${idx}: ${unNum} — Watt-Hour Rating`,
            `${unNum} watt-hour (Wh) rating not provided. SCA cargo declaration requires Wh rating for lithium ion batteries to confirm threshold applicability (>20 Wh/cell or >100 Wh/battery).`,
            'IMDG 42-24 requires Wh rating for lithium ion batteries.'));
        }
      }

      // ── Restricted DG class checks ────────────────────────────────────
      const dgClass = (item.imdg_class || '').split('.')[0];
      if (SCA_RESTRICTED_DG_CLASSES[item.imdg_class || '']) {
        const restriction = SCA_RESTRICTED_DG_CLASSES[item.imdg_class];
        checks.push(check(`dg_${idx}_restricted`, 'fail',
          `DG #${idx}: Class ${item.imdg_class} — SCA Restricted`,
          `${restriction.notes} Standard cargo declaration is insufficient.`,
          'SCA special approval required for this DG class.'));
      } else if (SCA_RESTRICTED_DG_CLASSES[dgClass]) {
        const restriction = SCA_RESTRICTED_DG_CLASSES[dgClass];
        checks.push(check(`dg_${idx}_restricted`, 'fail',
          `DG #${idx}: Class ${item.imdg_class} — SCA Restricted`,
          `${restriction.notes}`,
          'SCA special approval required.'));
      }

      // ── Packing Group ─────────────────────────────────────────────────
      // Not required for Class 1, 2, 6.2, 7
      const classesNoPG = ['1', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2', '2.1', '2.2', '2.3', '6.2', '7'];
      if (!classesNoPG.includes(item.imdg_class || '') && !item.packing_group) {
        checks.push(check(`dg_${idx}_pg`, 'fail',
          `DG #${idx}: Packing Group`,
          `Packing group not provided for ${unNum || 'item ' + idx}. Required for Class ${item.imdg_class || 'unknown'} under IMDG code.`,
          'Packing group (I, II, or III) required for applicable DG classes.'));
      }

      // ── Proper Shipping Name ──────────────────────────────────────────
      if (!item.proper_shipping_name) {
        checks.push(check(`dg_${idx}_psn`, 'warning',
          `DG #${idx}: Proper Shipping Name`,
          `Proper shipping name not provided for ${unNum || 'item ' + idx}. Recommended for SCA cargo manifest.`,
          'IMDG requires proper shipping name on cargo declaration.'));
      }
    });
  } else {
    checks.push(check('dg_declared', 'pass', 'Dangerous Goods',
      'No dangerous goods declared.',
      'No DG items to validate.'));
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez ISPS Declaration
// ─────────────────────────────────────────────────────────────────────────────

function validateIspsDeclaration(data) {
  const checks = [];
  const d = data.document_data || {};

  // ISSC certificate
  if (!d.issc_expiry) {
    checks.push(check('issc_expiry', 'fail', 'ISSC Certificate Expiry',
      'ISSC (International Ship Security Certificate) expiry date not provided. SCA verifies ISSC at boarding — expired certificate = transit denial.',
      'ISSC must be valid for entire transit.'));
  } else {
    const expiryDate = new Date(d.issc_expiry);
    const now = new Date();
    if (expiryDate < now) {
      checks.push(check('issc_expiry', 'fail', 'ISSC Certificate Expiry',
        `ISSC expired on ${expiryDate.toDateString()}. Renew immediately — expired ISSC = transit denial.`,
        'ISSC must be current.'));
    } else {
      const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry < 30) {
        checks.push(check('issc_expiry', 'warning', 'ISSC Certificate Expiry',
          `ISSC expires in ${daysUntilExpiry.toFixed(0)} days. Renew before next transit.`,
          'ISSC must be valid for entire transit.'));
      } else {
        checks.push(check('issc_expiry', 'pass', 'ISSC Certificate Expiry',
          `ISSC valid until ${expiryDate.toDateString()} (${daysUntilExpiry.toFixed(0)} days remaining).`,
          'ISSC current.'));
      }
    }
  }

  // Vessel security level
  const vsl = d.vessel_security_level;
  if (!vsl) {
    checks.push(check('security_level', 'fail', 'Vessel Security Level',
      'Vessel security level (1, 2, or 3) not declared. ISPS Code Part A/5.2 requires declaration.',
      'Security level required for SCA ISPS notification.'));
  } else {
    checks.push(check('security_level', 'pass', 'Vessel Security Level',
      `Security Level ${vsl} declared.`,
      'Security level compliant with ISPS Code Part A/5.2.'));
  }

  // Three-stage ISPS notifications
  const notifs = d.isps_notifications || {};
  ['72h', '48h', '24h'].forEach(stage => {
    if (!notifs[stage] || notifs[stage].status !== 'sent') {
      const isFirst = stage === '72h';
      checks.push(check(`isps_${stage}`, isFirst ? 'fail' : 'warning',
        `ISPS ${stage} Pre-Arrival Notification`,
        `${stage} ISPS notification not sent. SCA requires pre-arrival security notifications at 72h, 48h, and 24h before arrival.`,
        `SCA ISPS requirement: ${stage} notification before arrival at Port Said or Suez.`));
    } else {
      checks.push(check(`isps_${stage}`, 'pass',
        `ISPS ${stage} Pre-Arrival Notification`,
        `${stage} ISPS notification sent${notifs[stage].sca_reference ? ` (SCA ref: ${notifs[stage].sca_reference})` : ''}.`,
        'SCA ISPS notification requirement met.'));
    }
  });

  // Last 10 port calls
  const portCalls = d.last_10_ports || [];
  if (portCalls.length < 10) {
    checks.push(check('last_10_ports', 'warning', 'Last 10 Port Calls',
      `Only ${portCalls.length} port call(s) provided. SCA prefers last 10 — provide all available, or document why fewer exist (new vessel, recent drydock).`,
      'SCA ISPS submission should include last 10 port calls.'));
  } else {
    checks.push(check('last_10_ports', 'pass', 'Last 10 Port Calls',
      `${portCalls.length} port call(s) documented.`,
      'Port call history meets SCA ISPS requirement.'));
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez SOPEP
// ─────────────────────────────────────────────────────────────────────────────

function validateSopep(data) {
  const checks = [];
  const d = data.document_data || {};

  // Oil capacity threshold (same as Panama: 400 MT)
  if (d.oil_capacity_mt != null) {
    if (d.oil_capacity_mt >= 400) {
      checks.push(check('oil_capacity', 'pass', 'SOPEP Threshold — Oil Capacity',
        `Oil capacity ${d.oil_capacity_mt} MT meets SOPEP threshold (≥400 MT). SOPEP document required.`,
        'SOPEP required for vessels with ≥400 MT combined oil capacity.'));
    } else {
      checks.push(check('oil_capacity', 'warning', 'SOPEP Threshold — Oil Capacity',
        `Oil capacity ${d.oil_capacity_mt} MT is below 400 MT SOPEP threshold. Verify this figure includes both fuel and cargo oil — SOPEP may still be required.`,
        'SOPEP threshold: 400 MT combined oil capacity.'));
    }
  }

  // Plan reference
  checks.push(
    d.plan_reference
      ? check('plan_reference', 'pass', 'SOPEP Plan Reference', `Plan reference: ${d.plan_reference}.`, 'SOPEP plan reference documented.')
      : check('plan_reference', 'fail', 'SOPEP Plan Reference', 'SOPEP plan reference number is required.', 'SCA requires SOPEP plan reference for verification.')
  );

  // Expiry date
  if (!d.expiry_date && !d.plan_expiry_date) {
    checks.push(check('plan_expiry', 'fail', 'SOPEP Plan Expiry Date',
      'SOPEP expiry/review date not provided. SCA verifies SOPEP currency at boarding.',
      'SOPEP must cite current Egyptian environmental regulations.'));
  } else {
    const expiry = new Date(d.expiry_date || d.plan_expiry_date);
    if (expiry < new Date()) {
      checks.push(check('plan_expiry', 'fail', 'SOPEP Plan Expiry Date',
        `SOPEP expired on ${expiry.toDateString()}. Resubmit to flag administration for reapproval.`,
        'Expired SOPEP: transit denial risk.'));
    } else {
      checks.push(check('plan_expiry', 'pass', 'SOPEP Plan Expiry Date',
        `SOPEP valid until ${expiry.toDateString()}.`,
        'SOPEP plan current.'));
    }
  }

  // Authorised person
  checks.push(
    d.authorized_person_name
      ? check('authorized_person', 'pass', 'Authorized Person', `Authorized person: ${d.authorized_person_name}.`, 'Authorized person documented.')
      : check('authorized_person', 'warning', 'Authorized Person', 'Authorized person name not provided. SCA and Egyptian EPA may require this for emergency response coordination.', 'Include authorized SOPEP contact.')
  );

  // Note: Panama PCSOPEP requires ACP-domiciled authorized person; Suez does NOT have this specific requirement
  checks.push(check('suez_vs_panama_sopep', 'pass', 'Suez SOPEP — Not Panama PCSOPEP',
    'Filing identified as Suez SOPEP. Note: Panama PCSOPEP is NOT accepted by SCA. Suez SOPEP must cite Egyptian Law 4/1994 and relevant MARPOL Annexes.',
    'Suez and Panama oil pollution plans are separate documents.'));

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez Ballast Water Management
// ─────────────────────────────────────────────────────────────────────────────

function validateBallastWater(data) {
  const checks = [];
  const d = data.document_data || {};

  // IBWMC certificate
  checks.push(
    d.bwm_cert_number
      ? check('ibwmc', 'pass', 'International Ballast Water Management Certificate (IBWMC)',
          `IBWMC cert number: ${d.bwm_cert_number}.`,
          'IBWMC required by Egypt (BWM Convention party).')
      : check('ibwmc', 'fail', 'International Ballast Water Management Certificate (IBWMC)',
          'IBWMC certificate number not provided. Egypt is a BWM Convention signatory — SCA and Egyptian port state control verify IBWMC validity.',
          'BWM Convention compliance mandatory for Suez transit.')
  );

  // BWM standard
  if (d.exchange_compliance) {
    checks.push(
      VALID_BWM_STANDARDS.includes(d.exchange_compliance)
        ? check('bwm_standard', 'pass', 'Ballast Water Management Standard',
            `BWM standard: ${d.exchange_compliance}.${d.exchange_compliance === 'D-1' ? ' Note: D-2 treatment system preferred by SCA.' : ''}`,
            'BWM standard declared.')
        : check('bwm_standard', 'fail', 'Ballast Water Management Standard',
            `"${d.exchange_compliance}" is not a valid BWM standard. Use: ${VALID_BWM_STANDARDS.join(', ')}.`,
            'BWM standard must be D-1, D-2, or exemption.')
    );
  } else {
    checks.push(check('bwm_standard', 'fail', 'Ballast Water Management Standard',
      `Ballast water management standard not declared. Options: ${VALID_BWM_STANDARDS.join(', ')}.`,
      'BWM standard declaration required.'));
  }

  // Certificate expiry
  if (d.cert_expiry) {
    const expiry = new Date(d.cert_expiry);
    checks.push(
      expiry < new Date()
        ? check('bwm_cert_expiry', 'fail', 'BWM Certificate Expiry',
            `BWM certificate expired ${expiry.toDateString()}. Renew before transit.`,
            'Valid IBWMC required.')
        : check('bwm_cert_expiry', 'pass', 'BWM Certificate Expiry',
            `BWM certificate valid until ${expiry.toDateString()}.`,
            'IBWMC current.')
    );
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR: Suez Tonnage Certificate (SCNT)
// ─────────────────────────────────────────────────────────────────────────────

function validateTonnageCertificate(data) {
  const checks = [];
  const d = data.document_data || {};

  // SCNT value
  const scnt = d.scnt || data.scnt;
  if (!scnt || scnt <= 0) {
    checks.push(check('scnt_value', 'fail', 'SCNT Value',
      'Suez Canal Net Tonnage (SCNT) not provided or invalid. This is the basis for SCA toll calculation — it is distinct from Gross Tonnage (GT) and Panama\'s PC/UMS tonnage.',
      'SCNT required for SCA toll calculation.'));
  } else {
    checks.push(check('scnt_value', 'pass', 'SCNT Value',
      `SCNT: ${scnt}.`,
      'SCNT value provided.'));

    // Sanity ratio check
    const gt = d.gt || data.gross_tonnage;
    if (gt && gt > 0) {
      const ratio = scnt / gt;
      checks.push(
        ratio < 0.30
          ? check('scnt_ratio', 'warning', 'SCNT/GT Ratio',
              `SCNT ${scnt} / GT ${gt} = ${(ratio * 100).toFixed(1)}% — unusually low. Verify this is SCNT and not ITC Net Tonnage (NT), which is a different measure. Wrong tonnage = incorrect toll calculation.`,
              'SCNT is typically 55–85% of GT.')
          : check('scnt_ratio', 'pass', 'SCNT/GT Ratio',
              `SCNT/GT ratio: ${(ratio * 100).toFixed(1)}% — within expected range.`,
              'SCNT/GT ratio plausible.')
      );
    }
  }

  // Certificate number
  checks.push(
    d.suez_cert_number || d.cert_number
      ? check('cert_number', 'pass', 'SCNT Certificate Number',
          `Certificate number: ${d.suez_cert_number || d.cert_number}.`,
          'SCNT certificate reference documented.')
      : check('cert_number', 'warning', 'SCNT Certificate Number',
          'SCNT certificate number not provided. Recommended for SCA verification.',
          'Provide SCNT certificate number for audit trail.')
  );

  // Issuing authority
  if (d.issuing_authority) {
    const approved = SCNT_APPROVED_SOCIETIES.some(s =>
      d.issuing_authority.toLowerCase().includes(s.toLowerCase())
    );
    checks.push(
      approved
        ? check('issuing_authority', 'pass', 'SCNT Certificate Issuing Authority',
            `Issuing authority "${d.issuing_authority}" is an SCA-approved classification society.`,
            'SCNT certificate issuer approved.')
        : check('issuing_authority', 'warning', 'SCNT Certificate Issuing Authority',
            `"${d.issuing_authority}" is not in the standard list of SCA-approved classification societies. Verify with SCA agent that this issuer is accepted.`,
            'SCNT must be certified by SCA or approved classification society.')
    );
  } else {
    checks.push(check('issuing_authority', 'fail', 'SCNT Certificate Issuing Authority',
      'Issuing authority not specified. SCNT must be certified by SCA directly or an SCA-approved classification society (Lloyd\'s Register, DNV, ABS, ClassNK, BV, RINA, etc.).',
      'SCNT issuing authority required.'));
  }

  return buildCategorizedResult(checks);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT: Route to correct validator by document_type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Suez Canal filing.
 *
 * @param {Object} filingData - The filing record (from filings table)
 * @param {Array}  [dbRules=[]] - Active rows from suez_validation_rules table.
 *                               Used to override hard-coded SCA_LIMITS thresholds
 *                               and to run supplemental admin-defined rules.
 * @returns {Object} Validation result with overall_status, checklist, categorized errors
 */
function validateSuezFiling(filingData, dbRules = []) {
  if (!filingData) {
    throw new Error('Filing data is required');
  }

  // Guard: only validate Suez filings
  if (filingData.canal && filingData.canal !== 'suez') {
    throw new Error(`suez-validator received a ${filingData.canal} canal filing. Use the canal-appropriate validator.`);
  }

  // Build effective limits: DB rules can override hard-coded SCA_LIMITS
  const effectiveLimits = buildEffectiveLimits(dbRules);

  // Default to sca_transit_application when document_type is not specified
  // (e.g. general compliance check from the Validator page or external API callers)
  const docType = filingData.document_type || 'sca_transit_application';

  let result;
  switch (docType) {
    case 'sca_transit_application':
      result = validateTransitApplication(filingData, effectiveLimits);
      break;
    case 'suez_crew_manifest':
      result = validateCrewManifest(filingData);
      break;
    case 'suez_cargo_declaration':
      result = validateCargoDeclaration(filingData);
      break;
    case 'suez_isps_declaration':
      result = validateIspsDeclaration(filingData);
      break;
    case 'suez_sopep':
      result = validateSopep(filingData);
      break;
    case 'suez_ballast_water':
      result = validateBallastWater(filingData);
      break;
    case 'suez_tonnage_certificate':
      result = validateTonnageCertificate(filingData);
      break;
    // Additional document types supported in the filing UI — fall back to
    // transit application checks as the common dimensional/ETA baseline.
    case 'suez_dangerous_goods':
    case 'suez_pilotage':
    case 'suez_scnt_tonnage':
    case 'suez_convoy_scheduling':
      result = validateTransitApplication(filingData, effectiveLimits);
      break;
    default:
      throw new Error(`Unknown Suez document type: "${docType}". Valid types: sca_transit_application, suez_crew_manifest, suez_cargo_declaration, suez_isps_declaration, suez_sopep, suez_ballast_water, suez_tonnage_certificate`);
  }

  // Apply supplemental checks from DB rules not covered by hard-coded validators.
  // This is the data-driven extension point: new rules added via admin run here
  // without any code change required.
  const supplemental = applySupplementalDbRules(filingData, dbRules, docType);
  if (supplemental.length > 0) {
    result.checklist.push(...supplemental);
    result.total_checks    = result.checklist.length;
    result.passed_checks   = result.checklist.filter(c => c.status === 'pass').length;
    result.failed_checks   = result.checklist.filter(c => c.status === 'fail').length;
    result.warning_checks  = result.checklist.filter(c => c.status === 'warning').length;
    result.overall_status  = result.failed_checks > 0 ? 'failed' : result.warning_checks > 0 ? 'warning' : 'passed';
    result.critical_errors = result.checklist.filter(c => c.status === 'fail');
    result.warnings_list   = result.checklist.filter(c => c.status === 'warning');
    result.passed_list     = result.checklist.filter(c => c.status === 'pass');
  }

  return result;
}

/**
 * Calculate estimated SCA transit toll.
 *
 * Uses SCNT and vessel category for base calculation.
 * Note: Actual SCA invoices use IMF SDR/USD rate at payment date.
 *
 * @param {number} scnt - Suez Canal Net Tonnage
 * @param {string} vesselCategory - Vessel type/category
 * @param {number} [sdrToUsd=1.33] - SDR to USD exchange rate (approximate)
 * @returns {Object} Toll estimate with SDR and USD amounts
 */
function estimateSuezToll(scnt, vesselCategory, sdrToUsd = 1.33) {
  if (!scnt || scnt <= 0) {
    return { error: 'Valid SCNT required for toll calculation.' };
  }

  // Simplified rate table (use suez_fee_tiers DB table for production)
  const BASE_RATES = {
    container:      scnt <= 5000 ? 7.50 : scnt <= 15000 ? 7.20 : scnt <= 40000 ? 6.90 : 6.50,
    tanker:         scnt <= 5000 ? 8.20 : scnt <= 20000 ? 7.80 : 7.20,
    bulk_carrier:   scnt <= 5000 ? 5.80 : 5.50,
    lng_carrier:    9.50,
    lpg_carrier:    8.50,
    general_cargo:  scnt <= 5000 ? 5.20 : 4.80,
    ro_ro:          6.80,
    passenger:      3.00,
    chemical_tanker: 7.50,
    other:          5.00,
  };

  const MINIMUM_TOLLS_SDR = {
    container: 10000, tanker: 12000, lng_carrier: 20000, passenger: 5000,
    ro_ro: 10000, general_cargo: 6000, bulk_carrier: 8000,
  };

  const category = vesselCategory || 'other';
  const rate = BASE_RATES[category] || BASE_RATES.other;
  const calculatedSdr = scnt * rate;
  const minimumSdr = MINIMUM_TOLLS_SDR[category] || 0;
  const totalSdr = Math.max(calculatedSdr, minimumSdr);
  const totalUsd = totalSdr * sdrToUsd;

  return {
    scnt,
    vessel_category:     category,
    base_rate_sdr:       rate,
    calculated_sdr:      Math.round(calculatedSdr),
    minimum_toll_sdr:    minimumSdr || null,
    total_sdr:           Math.round(totalSdr),
    total_usd_estimate:  Math.round(totalUsd),
    sdr_rate_used:       sdrToUsd,
    disclaimer:          'Estimate only. SCA invoices at IMF SDR/USD rate on payment date. Rebates (up to 75%) may apply based on vessel class and transit frequency programs.',
  };
}

module.exports = {
  validateSuezFiling,
  validateTransitApplication,
  validateCrewManifest,
  validateCargoDeclaration,
  validateIspsDeclaration,
  validateSopep,
  validateBallastWater,
  validateTonnageCertificate,
  estimateSuezToll,
  buildEffectiveLimits,
  applySupplementalDbRules,
  SCA_LIMITS,
  LITHIUM_BATTERY_UN_NUMBERS: [...LITHIUM_BATTERY_UN_NUMBERS],
  SCA_RESTRICTED_DG_CLASSES,
};
