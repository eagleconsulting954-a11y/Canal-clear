/**
 * VUMPA Filing Validator
 *
 * Validates vessel documentation against current ACP (Autoridad del Canal de Panama)
 * requirements for pre-arrival filing through the Maritime Single Window (VUMPA).
 *
 * Based on ACP Notice to Shipping N-1-2026 and VUMPA filing requirements.
 */

// Panama Canal dimensional limits (Neo-Panamax locks)
const NEO_PANAMAX_LIMITS = {
  maxLOA: 366,      // meters (1,200 ft)
  maxBeam: 51.25,   // meters (168.2 ft)
  maxDraft: 15.24,  // meters TFW (50.0 ft)
  maxAirDraft: 57.91 // meters (190 ft) - Bridge of the Americas clearance
};

// Original Panamax locks limits
const PANAMAX_LIMITS = {
  maxLOA: 294.13,   // meters (965 ft)
  maxBeam: 32.31,   // meters (106 ft)
  maxDraft: 12.04,  // meters TFW (39.5 ft)
};

// Valid vessel types per ACP classification
const VALID_VESSEL_TYPES = [
  'bulk_carrier', 'container', 'tanker', 'lng_carrier', 'lpg_carrier',
  'vehicle_carrier', 'general_cargo', 'reefer', 'cruise', 'ro_ro',
  'chemical_tanker', 'offshore', 'tug', 'yacht', 'naval', 'other'
];

// Valid cargo types
const VALID_CARGO_TYPES = [
  'containerized', 'dry_bulk', 'liquid_bulk', 'break_bulk', 'vehicles',
  'refrigerated', 'livestock', 'passengers', 'ballast_only', 'lng', 'lpg',
  'chemicals', 'crude_oil', 'petroleum_products', 'other'
];

// Dangerous goods IMDG classes
const VALID_DG_CLASSES = [
  '1', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6',
  '2', '2.1', '2.2', '2.3',
  '3', '4', '4.1', '4.2', '4.3',
  '5', '5.1', '5.2', '6', '6.1', '6.2',
  '7', '8', '9'
];

// Valid flag states (ISO 3166-1 alpha-2 subset of major maritime flags)
const MAJOR_FLAG_STATES = [
  'PA', 'LR', 'MH', 'HK', 'SG', 'BS', 'MT', 'CY', 'IM', 'BM',
  'GB', 'NO', 'DK', 'GR', 'JP', 'CN', 'KR', 'US', 'DE', 'IT',
  'NL', 'FR', 'BE', 'ES', 'PT', 'BR', 'AG', 'VU', 'KN', 'MV',
  'TO', 'TV', 'PW', 'BZ', 'BB', 'GI', 'JE', 'KY', 'TC', 'VG',
  'DM', 'VC', 'LC', 'GD', 'AI', 'MS', 'TT', 'CO', 'MX', 'CL',
  'PE', 'EC', 'AR', 'UY', 'PH', 'IN', 'TH', 'MY', 'ID', 'VN',
  'TW', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IL', 'TR', 'UA',
  'RU', 'PL', 'SE', 'FI', 'EE', 'LV', 'LT', 'HR', 'SI', 'RO',
  'BG', 'CZ', 'SK', 'HU', 'AT', 'CH', 'AU', 'NZ', 'FJ', 'PG',
  'ZA', 'NG', 'GH', 'KE', 'TZ', 'EG', 'MA', 'TN', 'LY', 'DZ'
];

const TRANSIT_DIRECTIONS = ['northbound', 'southbound'];

/**
 * Build categorized validation result with error levels
 * @param {Array} checks - All validation checks
 * @returns {Object} Validation result with categorized errors
 */
function buildCategorizedResult(checks) {
  const passed = checks.filter(c => c.status === 'pass').length;
  const failed = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  // Categorize errors for frontend display
  const critical = checks.filter(c => c.status === 'fail');
  const nonCritical = checks.filter(c => c.status === 'warning');
  const success = checks.filter(c => c.status === 'pass');

  const overallStatus = failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed';

  return {
    overall_status: overallStatus,
    total_checks: checks.length,
    passed_checks: passed,
    failed_checks: failed,
    warning_checks: warnings,
    checklist: checks,
    // Categorized for frontend
    categories: {
      critical: critical.map(c => ({ id: c.id, name: c.name, message: c.message, requirement: c.requirement })),
      warnings: nonCritical.map(c => ({ id: c.id, name: c.name, message: c.message, requirement: c.requirement })),
      passed: success.map(c => ({ id: c.id, name: c.name, message: c.message }))
    }
  };
}

/**
 * Run full VUMPA validation on vessel data with optimized checks
 * @param {Object} data - Vessel and cargo information
 * @returns {Object} Validation result with categorized checklist
 */
function validateVUMPA(data) {
  const checks = [];

  // === CRITICAL CHECKS (Run first, collect all failures) ===
  // These checks block transit
  checks.push(validateIMO(data.imo_number));
  checks.push(validateVesselName(data.vessel_name));
  checks.push(validateETA(data.eta));

  // === SECTION 1: VESSEL IDENTIFICATION ===
  checks.push(validateFlagState(data.flag_state));
  checks.push(validateVesselType(data.vessel_type));

  // === SECTION 2: VESSEL DIMENSIONS ===
  checks.push(validateLOA(data.loa, data.vessel_type));
  checks.push(validateBeam(data.beam, data.vessel_type));
  checks.push(validateDraft(data.draft));
  checks.push(validateGrossTonnage(data.gross_tonnage));

  // === SECTION 3: CARGO INFORMATION ===
  checks.push(validateCargoType(data.cargo_type, data.vessel_type));
  checks.push(...validateDangerousGoods(data.has_dangerous_goods, data.dangerous_goods_class, data.cargo_type));

  // === SECTION 4: TRANSIT DETAILS ===
  checks.push(validateTransitDirection(data.transit_direction));
  checks.push(validateBookingNumber(data.booking_number));

  // === SECTION 5: DOCUMENTATION REQUIREMENTS ===
  checks.push(...validateDocumentationRequirements(data));

  // === SECTION 6: LOCK FITNESS ===
  checks.push(...validateLockFitness(data));

  // Build categorized result
  return buildCategorizedResult(checks);
}

// === INDIVIDUAL VALIDATORS ===

function validateIMO(imo) {
  const check = {
    id: 'imo_number',
    category: 'Vessel Identification',
    name: 'IMO Number',
    requirement: 'Valid 7-digit IMO number required per VUMPA Section 1.1'
  };

  if (!imo || imo.trim() === '') {
    return { ...check, status: 'fail', message: 'IMO number is required for all transit vessels' };
  }

  // IMO number: 7 digits, sometimes prefixed with "IMO"
  const cleaned = imo.replace(/^IMO\s*/i, '').trim();

  if (!/^\d{7}$/.test(cleaned)) {
    return { ...check, status: 'fail', message: `"${imo}" is not a valid format. Must be 7 digits (e.g., 9074729)` };
  }

  // IMO check digit validation (Lloyds algorithm)
  const digits = cleaned.split('').map(Number);
  const checksum = digits[0]*7 + digits[1]*6 + digits[2]*5 + digits[3]*4 + digits[4]*3 + digits[5]*2;
  if (checksum % 10 !== digits[6]) {
    return { ...check, status: 'fail', message: `IMO ${cleaned} fails check digit validation. Verify the number with Lloyd's Register.` };
  }

  return { ...check, status: 'pass', message: `IMO ${cleaned} is valid` };
}

function validateVesselName(name) {
  const check = {
    id: 'vessel_name',
    category: 'Vessel Identification',
    name: 'Vessel Name',
    requirement: 'Full vessel name as registered, per VUMPA Section 1.2'
  };

  if (!name || name.trim() === '') {
    return { ...check, status: 'fail', message: 'Vessel name is required' };
  }

  if (name.trim().length < 2) {
    return { ...check, status: 'fail', message: 'Vessel name must be at least 2 characters' };
  }

  if (name.trim().length > 100) {
    return { ...check, status: 'warning', message: 'Vessel name exceeds typical length. Verify name matches registration.' };
  }

  return { ...check, status: 'pass', message: `Vessel "${name.trim()}" accepted` };
}

function validateFlagState(flag) {
  const check = {
    id: 'flag_state',
    category: 'Vessel Identification',
    name: 'Flag State',
    requirement: 'ISO 3166-1 flag state code, per VUMPA Section 1.3'
  };

  if (!flag || flag.trim() === '') {
    return { ...check, status: 'fail', message: 'Flag state is required for ACP pre-arrival declaration' };
  }

  const cleaned = flag.trim().toUpperCase();

  if (cleaned.length !== 2) {
    return { ...check, status: 'fail', message: 'Flag state must be a 2-letter ISO country code (e.g., PA, LR, MH)' };
  }

  if (!MAJOR_FLAG_STATES.includes(cleaned)) {
    return { ...check, status: 'warning', message: `Flag state "${cleaned}" is uncommon. Verify code is correct. ACP may require additional documentation.` };
  }

  return { ...check, status: 'pass', message: `Flag state ${cleaned} recognized` };
}

function validateVesselType(type) {
  const check = {
    id: 'vessel_type',
    category: 'Vessel Identification',
    name: 'Vessel Type',
    requirement: 'ACP vessel classification per toll schedule, VUMPA Section 1.4'
  };

  if (!type || type.trim() === '') {
    return { ...check, status: 'fail', message: 'Vessel type is required for toll calculation and lock assignment' };
  }

  if (!VALID_VESSEL_TYPES.includes(type)) {
    return { ...check, status: 'fail', message: `"${type}" is not a recognized ACP vessel classification. Valid types: ${VALID_VESSEL_TYPES.join(', ')}` };
  }

  return { ...check, status: 'pass', message: `Vessel type "${type}" accepted` };
}

function validateLOA(loa, vesselType) {
  const check = {
    id: 'loa',
    category: 'Vessel Dimensions',
    name: 'Length Overall (LOA)',
    requirement: 'LOA in meters, must not exceed Neo-Panamax limit of 366m'
  };

  if (loa === undefined || loa === null || loa === '') {
    return { ...check, status: 'fail', message: 'LOA is required for lock assignment and booking validation' };
  }

  const val = parseFloat(loa);
  if (isNaN(val) || val <= 0) {
    return { ...check, status: 'fail', message: 'LOA must be a positive number in meters' };
  }

  if (val > NEO_PANAMAX_LIMITS.maxLOA) {
    return { ...check, status: 'fail', message: `LOA ${val}m exceeds maximum Canal limit of ${NEO_PANAMAX_LIMITS.maxLOA}m. Vessel cannot transit.` };
  }

  if (val > PANAMAX_LIMITS.maxLOA) {
    return { ...check, status: 'warning', message: `LOA ${val}m exceeds Panamax locks limit (${PANAMAX_LIMITS.maxLOA}m). Must use Neo-Panamax (Agua Clara / Cocoli) locks.` };
  }

  if (val < 8) {
    return { ...check, status: 'warning', message: `LOA ${val}m is very small. Vessels under 20m may need special transit arrangements.` };
  }

  return { ...check, status: 'pass', message: `LOA ${val}m within Canal limits` };
}

function validateBeam(beam, vesselType) {
  const check = {
    id: 'beam',
    category: 'Vessel Dimensions',
    name: 'Beam (Breadth)',
    requirement: 'Beam in meters, must not exceed Neo-Panamax limit of 51.25m'
  };

  if (beam === undefined || beam === null || beam === '') {
    return { ...check, status: 'fail', message: 'Beam is required for lock assignment and booking validation' };
  }

  const val = parseFloat(beam);
  if (isNaN(val) || val <= 0) {
    return { ...check, status: 'fail', message: 'Beam must be a positive number in meters' };
  }

  if (val > NEO_PANAMAX_LIMITS.maxBeam) {
    return { ...check, status: 'fail', message: `Beam ${val}m exceeds maximum Canal limit of ${NEO_PANAMAX_LIMITS.maxBeam}m. Vessel cannot transit.` };
  }

  if (val > PANAMAX_LIMITS.maxBeam) {
    return { ...check, status: 'warning', message: `Beam ${val}m exceeds Panamax locks limit (${PANAMAX_LIMITS.maxBeam}m). Must use Neo-Panamax locks.` };
  }

  return { ...check, status: 'pass', message: `Beam ${val}m within Canal limits` };
}

function validateDraft(draft) {
  const check = {
    id: 'draft',
    category: 'Vessel Dimensions',
    name: 'Draft (Tropical Fresh Water)',
    requirement: 'Maximum draft in meters TFW, must not exceed 15.24m (Neo-Panamax)'
  };

  if (draft === undefined || draft === null || draft === '') {
    return { ...check, status: 'fail', message: 'Draft is required. ACP applies draft restrictions based on Gatun Lake levels.' };
  }

  const val = parseFloat(draft);
  if (isNaN(val) || val <= 0) {
    return { ...check, status: 'fail', message: 'Draft must be a positive number in meters' };
  }

  if (val > NEO_PANAMAX_LIMITS.maxDraft) {
    return { ...check, status: 'fail', message: `Draft ${val}m exceeds Neo-Panamax limit of ${NEO_PANAMAX_LIMITS.maxDraft}m TFW. Vessel cannot transit at this draft.` };
  }

  if (val > PANAMAX_LIMITS.maxDraft) {
    return { ...check, status: 'warning', message: `Draft ${val}m exceeds Panamax locks limit (${PANAMAX_LIMITS.maxDraft}m). Must use Neo-Panamax locks.` };
  }

  // Current draft restriction advisory (simulated - would be real-time in production)
  if (val > 13.41) {
    return { ...check, status: 'warning', message: `Draft ${val}m is near current advisory limit. Check ACP Advisory to Shipping for latest draft restrictions due to Gatun Lake water levels.` };
  }

  return { ...check, status: 'pass', message: `Draft ${val}m within Canal limits` };
}

function validateGrossTonnage(gt) {
  const check = {
    id: 'gross_tonnage',
    category: 'Vessel Dimensions',
    name: 'Gross Tonnage (GT)',
    requirement: 'Required for toll calculation per ACP toll schedule'
  };

  if (gt === undefined || gt === null || gt === '') {
    return { ...check, status: 'warning', message: 'Gross tonnage recommended for toll estimation. Not providing may delay processing.' };
  }

  const val = parseFloat(gt);
  if (isNaN(val) || val <= 0) {
    return { ...check, status: 'fail', message: 'Gross tonnage must be a positive number' };
  }

  if (val > 250000) {
    return { ...check, status: 'warning', message: `GT ${val.toLocaleString()} is exceptionally high. Verify against vessel registration.` };
  }

  return { ...check, status: 'pass', message: `GT ${val.toLocaleString()} accepted` };
}

function validateCargoType(cargoType, vesselType) {
  const check = {
    id: 'cargo_type',
    category: 'Cargo Information',
    name: 'Cargo Type',
    requirement: 'Cargo classification per VUMPA cargo manifest, Section 3.1'
  };

  if (!cargoType || cargoType.trim() === '') {
    return { ...check, status: 'fail', message: 'Cargo type is required. Use "ballast_only" if vessel is in ballast.' };
  }

  if (!VALID_CARGO_TYPES.includes(cargoType)) {
    return { ...check, status: 'fail', message: `"${cargoType}" is not a valid cargo type. Valid types: ${VALID_CARGO_TYPES.join(', ')}` };
  }

  // Cross-validate cargo vs vessel type
  if (vesselType === 'tanker' && !['liquid_bulk', 'crude_oil', 'petroleum_products', 'chemicals', 'ballast_only'].includes(cargoType)) {
    return { ...check, status: 'warning', message: `Cargo type "${cargoType}" is unusual for a tanker vessel. Verify cargo declaration.` };
  }

  if (vesselType === 'container' && cargoType !== 'containerized' && cargoType !== 'ballast_only') {
    return { ...check, status: 'warning', message: `Cargo type "${cargoType}" is unusual for a container vessel. Verify cargo declaration.` };
  }

  if (vesselType === 'lng_carrier' && cargoType !== 'lng' && cargoType !== 'ballast_only') {
    return { ...check, status: 'warning', message: `LNG carrier should declare cargo type as "lng" or "ballast_only".` };
  }

  return { ...check, status: 'pass', message: `Cargo type "${cargoType}" accepted` };
}

function validateDangerousGoods(hasDG, dgClass, cargoType) {
  const checks = [];

  const dgCheck = {
    id: 'dangerous_goods_declaration',
    category: 'Cargo Information',
    name: 'Dangerous Goods Declaration',
    requirement: 'IMDG Code compliance per VUMPA Section 3.2 and ACP OP Notice N-3-2026'
  };

  if (hasDG === undefined || hasDG === null) {
    checks.push({ ...dgCheck, status: 'fail', message: 'Dangerous goods declaration is mandatory. Must declare Yes or No.' });
    return checks;
  }

  if (!hasDG) {
    checks.push({ ...dgCheck, status: 'pass', message: 'No dangerous goods declared' });

    // Warn if cargo type suggests DG
    if (['chemicals', 'lng', 'lpg', 'crude_oil', 'petroleum_products'].includes(cargoType)) {
      checks.push({
        id: 'dg_cargo_mismatch',
        category: 'Cargo Information',
        name: 'DG / Cargo Cross-Check',
        requirement: 'Cargo type suggests dangerous goods classification may apply',
        status: 'warning',
        message: `Cargo type "${cargoType}" typically requires dangerous goods declaration. Verify IMDG classification.`
      });
    }

    return checks;
  }

  // DG declared = true
  checks.push({ ...dgCheck, status: 'pass', message: 'Dangerous goods declared - additional documentation required' });

  // Validate DG class
  const classCheck = {
    id: 'dg_class',
    category: 'Cargo Information',
    name: 'IMDG Dangerous Goods Class',
    requirement: 'Valid IMDG class required when dangerous goods are declared'
  };

  if (!dgClass || dgClass.trim() === '') {
    checks.push({ ...classCheck, status: 'fail', message: 'IMDG class is required when dangerous goods are declared' });
  } else if (!VALID_DG_CLASSES.includes(dgClass.trim())) {
    checks.push({ ...classCheck, status: 'fail', message: `"${dgClass}" is not a valid IMDG class. Valid classes: ${VALID_DG_CLASSES.join(', ')}` });
  } else {
    checks.push({ ...classCheck, status: 'pass', message: `IMDG Class ${dgClass} accepted` });

    // Class-specific warnings
    if (dgClass.startsWith('1')) {
      checks.push({
        id: 'dg_explosives_notice',
        category: 'Cargo Information',
        name: 'Explosives Transit Restriction',
        requirement: 'ACP OP Notice for Class 1 dangerous goods',
        status: 'warning',
        message: 'Class 1 (Explosives) requires advance ACP Maritime Security approval. Allow minimum 72-hour processing.'
      });
    }

    if (dgClass === '7') {
      checks.push({
        id: 'dg_radioactive_notice',
        category: 'Cargo Information',
        name: 'Radioactive Materials Notice',
        requirement: 'ACP OP Notice for Class 7 dangerous goods',
        status: 'warning',
        message: 'Class 7 (Radioactive) requires ANAM certification and ACP advance approval. Contact ACP Dangerous Goods Division.'
      });
    }
  }

  return checks;
}

function validateTransitDirection(direction) {
  const check = {
    id: 'transit_direction',
    category: 'Transit Details',
    name: 'Transit Direction',
    requirement: 'Northbound (Atlantic to Pacific) or Southbound per VUMPA Section 4.1'
  };

  if (!direction || direction.trim() === '') {
    return { ...check, status: 'fail', message: 'Transit direction is required for slot assignment' };
  }

  if (!TRANSIT_DIRECTIONS.includes(direction.toLowerCase())) {
    return { ...check, status: 'fail', message: `"${direction}" is invalid. Must be "northbound" or "southbound".` };
  }

  return { ...check, status: 'pass', message: `Transit direction: ${direction}` };
}

function validateBookingNumber(booking) {
  const check = {
    id: 'booking_number',
    category: 'Transit Details',
    name: 'ACP Booking/Reservation Number',
    requirement: 'Transit reservation number from ACP booking system'
  };

  if (!booking || booking.trim() === '') {
    return { ...check, status: 'warning', message: 'No booking number provided. Vessel will be assigned to open queue (potentially 3-7 day wait).' };
  }

  // ACP booking numbers are typically alphanumeric, 6-15 chars
  const cleaned = booking.trim().toUpperCase();
  if (cleaned.length < 4 || cleaned.length > 20) {
    return { ...check, status: 'warning', message: `Booking number "${cleaned}" has unusual length. Verify with ACP Admeasurement Office.` };
  }

  return { ...check, status: 'pass', message: `Booking number ${cleaned} recorded` };
}

function validateETA(eta) {
  const check = {
    id: 'eta',
    category: 'Transit Details',
    name: 'Estimated Time of Arrival',
    requirement: 'ETA at Canal anchorage, minimum 96 hours advance per VUMPA Section 4.3'
  };

  if (!eta) {
    return { ...check, status: 'fail', message: 'ETA is required. VUMPA pre-arrival filing must be submitted minimum 96 hours before arrival.' };
  }

  const etaDate = new Date(eta);
  if (isNaN(etaDate.getTime())) {
    return { ...check, status: 'fail', message: 'Invalid date format for ETA' };
  }

  const now = new Date();
  const hoursUntilArrival = (etaDate - now) / (1000 * 60 * 60);

  if (hoursUntilArrival < 0) {
    return { ...check, status: 'fail', message: 'ETA is in the past. Cannot submit pre-arrival filing for past dates.' };
  }

  if (hoursUntilArrival < 96) {
    return { ...check, status: 'fail', message: `ETA is ${Math.round(hoursUntilArrival)} hours away. VUMPA requires minimum 96-hour advance filing. Expedited processing may apply.` };
  }

  if (hoursUntilArrival < 120) {
    return { ...check, status: 'warning', message: `ETA is ${Math.round(hoursUntilArrival)} hours away. Filing within 96-120 hours may have limited amendment opportunities.` };
  }

  return { ...check, status: 'pass', message: `ETA accepted. ${Math.round(hoursUntilArrival)} hours until arrival.` };
}

function validateDocumentationRequirements(data) {
  const checks = [];

  // Crew list
  checks.push({
    id: 'crew_list',
    category: 'Documentation',
    name: 'Crew List (FAL Form 5)',
    requirement: 'Complete crew list with passport details required per VUMPA Section 5.1',
    status: 'warning',
    message: 'Crew list must be submitted before transit. Ensure all crew passport numbers and nationalities are included.'
  });

  // Ship stores declaration
  checks.push({
    id: 'stores_declaration',
    category: 'Documentation',
    name: 'Ship Stores Declaration (FAL Form 3)',
    requirement: 'Declaration of stores including alcohol and tobacco per VUMPA Section 5.2',
    status: 'warning',
    message: 'Ship stores declaration required. Must list all bonded stores, weapons, and narcotics (medical).'
  });

  // Maritime Health Declaration
  checks.push({
    id: 'health_declaration',
    category: 'Documentation',
    name: 'Maritime Declaration of Health',
    requirement: 'Health declaration per International Health Regulations, VUMPA Section 5.3',
    status: 'warning',
    message: 'Maritime health declaration mandatory. Must be signed by ship master within 24 hours of arrival.'
  });

  // PCSOPEP
  checks.push({
    id: 'pcsopep',
    category: 'Documentation',
    name: 'PCSOPEP (Panama Canal SOPEP)',
    requirement: 'Valid Shipboard Oil Pollution Emergency Plan for Canal transit',
    status: 'warning',
    message: 'Valid PCSOPEP certificate required. Must be current and endorsed for Panama Canal waters. Check expiry date.'
  });

  // ISPS Code compliance
  checks.push({
    id: 'isps_compliance',
    category: 'Documentation',
    name: 'ISSC (International Ship Security Certificate)',
    requirement: 'Valid ISSC per ISPS Code, VUMPA Section 5.5',
    status: 'warning',
    message: 'Valid ISSC required. Security level must be transmitted 96 hours prior to arrival.'
  });

  // Dangerous goods specific docs
  if (data.has_dangerous_goods) {
    checks.push({
      id: 'dg_manifest',
      category: 'Documentation',
      name: 'Dangerous Goods Manifest',
      requirement: 'Detailed DG manifest per IMDG Code and ACP OP Notice N-3-2026',
      status: 'warning',
      message: 'Dangerous goods manifest required with stowage plan, MSDS for each product, and emergency contact procedures.'
    });
  }

  // Tonnage certificate
  checks.push({
    id: 'tonnage_certificate',
    category: 'Documentation',
    name: 'International Tonnage Certificate (ITC 69)',
    requirement: 'Required for ACP toll calculation',
    status: 'warning',
    message: 'ITC 69 certificate required for toll assessment. ACP uses PC/UMS Net Tonnage for toll calculation.'
  });

  return checks;
}

function validateLockFitness(data) {
  const checks = [];
  const loa = parseFloat(data.loa);
  const beam = parseFloat(data.beam);
  const draft = parseFloat(data.draft);

  if (isNaN(loa) || isNaN(beam) || isNaN(draft)) {
    return checks; // Dimension checks already handle missing values
  }

  // Determine which locks the vessel can use
  const fitsPanamax = loa <= PANAMAX_LIMITS.maxLOA && beam <= PANAMAX_LIMITS.maxBeam && draft <= PANAMAX_LIMITS.maxDraft;
  const fitsNeoPanamax = loa <= NEO_PANAMAX_LIMITS.maxLOA && beam <= NEO_PANAMAX_LIMITS.maxBeam && draft <= NEO_PANAMAX_LIMITS.maxDraft;

  if (!fitsNeoPanamax) {
    checks.push({
      id: 'lock_fitness',
      category: 'Lock Assignment',
      name: 'Canal Transit Feasibility',
      requirement: 'Vessel must fit within Neo-Panamax lock chambers',
      status: 'fail',
      message: 'Vessel dimensions exceed all Panama Canal lock limits. Cannot transit the Canal.'
    });
    return checks;
  }

  if (fitsPanamax) {
    checks.push({
      id: 'lock_fitness',
      category: 'Lock Assignment',
      name: 'Lock Assignment',
      requirement: 'Vessel must fit within available lock chambers',
      status: 'pass',
      message: `Vessel fits both Panamax (Gatun/Pedro Miguel/Miraflores) and Neo-Panamax (Agua Clara/Cocoli) locks. More scheduling flexibility.`
    });
  } else {
    checks.push({
      id: 'lock_fitness',
      category: 'Lock Assignment',
      name: 'Lock Assignment',
      requirement: 'Vessel must fit within available lock chambers',
      status: 'pass',
      message: `Vessel dimensions require Neo-Panamax locks only (Agua Clara/Cocoli). Limited to expanded lock schedule.`
    });
  }

  // Tug requirements
  if (loa > 200 || beam > 32) {
    checks.push({
      id: 'tug_requirement',
      category: 'Lock Assignment',
      name: 'Tug Assistance Requirement',
      requirement: 'ACP tug requirements based on vessel dimensions',
      status: 'pass',
      message: `Vessel dimensions (LOA: ${loa}m, Beam: ${beam}m) will require tug assistance. ACP assigns tugs at scheduling.`
    });
  }

  return checks;
}

module.exports = {
  validateVUMPA,
  VALID_VESSEL_TYPES,
  VALID_CARGO_TYPES,
  VALID_DG_CLASSES,
  TRANSIT_DIRECTIONS,
  NEO_PANAMAX_LIMITS,
  PANAMAX_LIMITS
};
