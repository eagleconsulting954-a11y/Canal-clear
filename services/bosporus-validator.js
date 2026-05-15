/**
 * bosporus-validator.js — Bosporus / Turkish Straits SP-1 compliance validator
 *
 * Owns: all SP-1 form validation logic for Turkish Straits transits.
 * Does NOT own: database access, filing CRUD, PDF generation, or vessel lookup.
 *
 * Regulatory basis:
 *  - Turkish Straits Vessel Traffic Services (VTS) SP-1 pre-arrival notification
 *  - 1936 Montreux Convention (vessel type / tonnage caps for warships; commercial unrestricted)
 *  - Turkish Straits Maritime Traffic Regulations (OG 28-11-1998, updated 2003)
 *  - LOA >200m: MANDATORY daytime-only transit + advance scheduling
 *  - Hazmat: IMDG Classes 1, 2.3, 3, 5.1, 6.2, 7 require 48h advance notice + TK authority approval
 *  - Pilotage: MANDATORY for vessels LOA >150m or GT >10,000
 *  - Draft limit: max ~15.5m loaded (channel depth 18m, safety margin applied)
 *  - Minimum pre-arrival notice: 24h (48h recommended for hazmat / oversized)
 */

// ── Turkish Straits Dimensional Limits ────────────────────────────────────────

const BSP_LIMITS = {
  maxLOA:              350,    // meters — no hard cap for commercial, but >350m needs special arrangement
  advisoryLOA:         200,    // meters — daytime-only + advance scheduling above this
  pilotMandatoryLOA:   150,    // meters — pilotage mandatory LOA threshold
  pilotMandatoryGT:    10000,  // GT — pilotage mandatory GT threshold
  maxDraft:            15.5,   // meters — practical loaded limit (channel 18m, safety margin applied)
  advisoryDraft:       14.5,   // meters — advisory limit before authority notification recommended
  minEtaHours:         24,     // hours — minimum pre-arrival notice (hard)
  advisoryEtaHours:    48,     // hours — recommended for hazmat / oversized
  hazmatEtaHours:      48,     // hours — mandatory minimum for hazmat cargo
};

// ── Hazmat classes requiring 48h advance notice and Turkish authority approval ─

const BSP_HAZMAT_CLASSES_RESTRICTED = new Set(['1', '2.3', '3', '5.1', '6.2', '7']);

// Sub-divisions of Class 1 requiring explicit flag
const BSP_EXPLOSIVES_SUBDIVISIONS = new Set(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);

// ── Valid vessel types (match vessel-lookup.js and frontend select values) ────

const VALID_VESSEL_TYPES = [
  'bulk_carrier', 'container', 'tanker', 'lng_carrier', 'lpg_carrier',
  'vehicle_carrier', 'general_cargo', 'reefer', 'cruise', 'ro_ro',
  'chemical_tanker', 'offshore', 'tug', 'yacht', 'naval', 'other',
];

// ── Geographic port sense-check ────────────────────────────────────────────────
// Northbound: Black Sea ports → Mediterranean. Southbound: Mediterranean → Black Sea.
// Only a light heuristic — the authoritative check is the operator's declaration.

const BLACK_SEA_PORT_HINTS = [
  'odessa', 'constanta', 'novorossiysk', 'batumi', 'poti', 'varna',
  'burgas', 'trabzon', 'samsun', 'zonguldak', 'sevastopol', 'kerch',
  'illichivsk', 'mykolaiv', 'kherson', 'reni', 'izmail', 'sulina',
  'mangalia', 'midia', 'kavkaz', 'temryuk', 'taman', 'feodosiya',
];

const MEDITERRANEAN_PORT_HINTS = [
  'istanbul', 'izmir', 'mersin', 'iskenderun', 'piraeus', 'athens',
  'thessaloniki', 'bari', 'trieste', 'venice', 'genoa', 'marseille',
  'barcelona', 'valencia', 'algeciras', 'naples', 'palermo', 'taranto',
  'alexandria', 'port said', 'haifa', 'ashdod', 'limassol', 'beirut',
  'latakia', 'tripoli', 'tunis', 'annaba', 'oran', 'casablanca',
  'marmara', 'gebze', 'dilovasi', 'derince', 'bandirma', 'gemlik',
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function check(id, status, name, message, requirement) {
  return { id, status, name, message, requirement };
}

function buildResult(canal, checks) {
  const passed   = checks.filter(c => c.status === 'pass').length;
  const failed   = checks.filter(c => c.status === 'fail').length;
  const warnings = checks.filter(c => c.status === 'warning').length;

  return {
    canal,
    overall_status:  failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed',
    total_checks:    checks.length,
    passed_checks:   passed,
    failed_checks:   failed,
    warning_checks:  warnings,
    checklist:       checks,
    critical_errors: checks.filter(c => c.status === 'fail'),
    warnings_list:   checks.filter(c => c.status === 'warning'),
    passed_list:     checks.filter(c => c.status === 'pass'),
  };
}

/**
 * Classify a port name as black_sea, mediterranean, or unknown.
 * Used for port sequence sense-check only — not authoritative.
 */
function classifyPort(portName) {
  if (!portName) return 'unknown';
  const lower = portName.toLowerCase();
  if (BLACK_SEA_PORT_HINTS.some(h => lower.includes(h))) return 'black_sea';
  if (MEDITERRANEAN_PORT_HINTS.some(h => lower.includes(h))) return 'mediterranean';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 1: IMO Checksum
// ─────────────────────────────────────────────────────────────────────────────

function validateIMO(data) {
  const raw = (data.imo_number || '').replace(/^IMO\s*/i, '').trim();

  if (!raw) {
    return check('imo_number', 'fail', 'IMO Number',
      'IMO number is required for SP-1 pre-arrival notification.',
      'Turkish VTS requires 7-digit IMO number on all SP-1 forms.');
  }

  if (!/^\d{7}$/.test(raw)) {
    return check('imo_number', 'fail', 'IMO Number',
      `"${raw}" is not a valid IMO number. Must be exactly 7 digits (e.g., 9876543).`,
      'Turkish VTS requires valid 7-digit IMO number.');
  }

  // Luhn-style checksum: weights 7,6,5,4,3,2 on first 6 digits; last digit = check digit
  const d = raw.split('').map(Number);
  const sum = d[0]*7 + d[1]*6 + d[2]*5 + d[3]*4 + d[4]*3 + d[5]*2;
  if (sum % 10 !== d[6]) {
    return check('imo_number', 'warning', 'IMO Number',
      `IMO ${raw} — checksum failed. Verify the number is correct; mismatches cause SP-1 rejection.`,
      'IMO checksum (mod-10 of weighted sum) must match check digit.');
  }

  return check('imo_number', 'pass', 'IMO Number',
    `IMO ${raw} — format and checksum valid.`,
    'IMO number requirement satisfied.');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 2: LOA Restriction (>200m daytime-only rule)
// ─────────────────────────────────────────────────────────────────────────────

function validateLOA(data, limits = BSP_LIMITS) {
  const loa = parseFloat(data.loa);

  if (isNaN(loa) || loa <= 0) {
    return check('loa', 'fail', 'Length Overall (LOA)',
      'LOA is required. Turkish VTS uses LOA for transit scheduling and daytime-transit rules.',
      'LOA must be declared on SP-1 form.');
  }

  if (loa > limits.maxLOA) {
    return check('loa', 'fail', 'Length Overall (LOA)',
      `LOA ${loa}m exceeds ${limits.maxLOA}m — special Turkish Straits authority arrangement required. Contact TBSS (Türk Boğazları Seyir Hizmetleri) directly.`,
      `Vessels >350m require advance authority coordination.`);
  }

  if (loa > limits.advisoryLOA) {
    const d = data.document_data || {};
    const requestedDaytime = d.daytime_transit_requested === true;
    return check('loa', requestedDaytime ? 'warning' : 'fail', 'Length Overall (LOA) — Daytime Transit Rule',
      `LOA ${loa}m exceeds 200m. Turkish Maritime Traffic Regulations MANDATE daytime-only transit and advance scheduling for vessels >200m. ${!requestedDaytime ? 'Daytime transit has not been requested — SP-1 will be rejected.' : 'Daytime transit requested — confirm scheduling slot with TBSS.'}`,
      'Vessels LOA >200m: daytime-only transit, advance scheduling required (Turkish Straits Maritime Traffic Regulations Art. 20).');
  }

  return check('loa', 'pass', 'Length Overall (LOA)',
    `LOA ${loa}m — within standard transit limits.`,
    `LOA ≤200m: no daytime restriction. LOA ≤${limits.pilotMandatoryLOA}m: pilotage not mandatory on LOA alone.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 3: Draft Restriction (max ~15.5m loaded)
// ─────────────────────────────────────────────────────────────────────────────

function validateDraft(data, limits = BSP_LIMITS) {
  const draft = parseFloat(data.draft);

  if (isNaN(draft) || draft <= 0) {
    return check('draft', 'fail', 'Loaded Draft',
      'Loaded draft is required. TBSS uses draft for channel clearance assessment.',
      'Draft must be declared on SP-1 form.');
  }

  if (draft > limits.maxDraft) {
    return check('draft', 'fail', 'Loaded Draft',
      `Draft ${draft}m exceeds Bosporus practical limit of ${limits.maxDraft}m. Channel depth ~18m with safety margin — vessels drawing more than ${limits.maxDraft}m loaded require special TBSS assessment. Transit may be denied.`,
      `Turkish Straits practical draft limit: ${limits.maxDraft}m loaded.`);
  }

  if (draft > limits.advisoryDraft) {
    return check('draft', 'warning', 'Loaded Draft',
      `Draft ${draft}m is above the advisory limit of ${limits.advisoryDraft}m. Notify TBSS in advance and confirm channel clearance for current tide/weather. Allow extra scheduling time.`,
      `Advisory draft threshold: ${limits.advisoryDraft}m.`);
  }

  return check('draft', 'pass', 'Loaded Draft',
    `Draft ${draft}m — within Bosporus limits.`,
    `Bosporus draft limit: ${limits.maxDraft}m loaded.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 4: Dangerous Goods Declaration
// ─────────────────────────────────────────────────────────────────────────────

function validateDangerousGoods(data) {
  const d = data.document_data || {};
  const hasDG = d.has_dangerous_goods === true;
  const dgClass = data.dangerous_goods_class || d.dangerous_goods_class;

  if (!hasDG) {
    return check('dangerous_goods', 'pass', 'Dangerous Goods Declaration',
      'No dangerous goods declared.',
      'No DG cargo: standard SP-1 submission applies.');
  }

  // DG declared but class missing
  if (!dgClass) {
    return check('dangerous_goods', 'fail', 'Dangerous Goods Classification',
      'Dangerous goods declared but IMDG class not specified. Turkish Straits authority requires DG class, UN number, and quantity on SP-1.',
      'DG class required for TBSS hazmat assessment.');
  }

  // Restricted classes requiring 48h advance + Turkish authority approval
  const baseClass = dgClass.split('.')[0];
  if (BSP_HAZMAT_CLASSES_RESTRICTED.has(dgClass) || BSP_HAZMAT_CLASSES_RESTRICTED.has(baseClass)) {
    const isExplosive = dgClass === '1' || BSP_EXPLOSIVES_SUBDIVISIONS.has(dgClass);
    return check('dangerous_goods', 'fail', 'Dangerous Goods — Restricted Class',
      `Class ${dgClass} cargo requires ${isExplosive ? '72h' : '48h'} advance notice to Turkish Maritime Authority. ${isExplosive ? 'Explosives require specific escort and daytime-only transit authorization.' : 'TBSS must approve transit before departure.'} Standard 24h SP-1 is insufficient — re-file with extended lead time.`,
      `Turkish Straits restricted DG classes: ${[...BSP_HAZMAT_CLASSES_RESTRICTED].join(', ')} — 48h minimum advance.`);
  }

  return check('dangerous_goods', 'pass', 'Dangerous Goods Classification',
    `IMDG Class ${dgClass} declared. Ensure DG manifest includes UN number, quantity, and IMDG certificate. Stowage per IMDG code.`,
    'DG class declared. Non-restricted class — 24h SP-1 timeline applies.');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 5: Transit Timing (24h min; daytime check for >200m / hazmat)
// ─────────────────────────────────────────────────────────────────────────────

function validateTransitTiming(data, limits = BSP_LIMITS) {
  const checks = [];
  const d = data.document_data || {};
  const eta = data.estimated_arrival || d.eta;

  if (!eta) {
    checks.push(check('eta', 'fail', 'Estimated Transit Date/Time',
      'Estimated arrival (ETA) is required for SP-1 pre-arrival notification.',
      'Turkish VTS requires ETA for transit slot assignment.'));
    return checks;
  }

  const etaDate  = new Date(eta);
  const now      = new Date();
  const hoursOut = (etaDate - now) / (1000 * 60 * 60);
  const hasDG    = d.has_dangerous_goods === true;
  const loa      = parseFloat(data.loa);
  const isOversized = !isNaN(loa) && loa > limits.advisoryLOA;

  // Minimum advance notice
  const minHours     = (hasDG || isOversized) ? limits.hazmatEtaHours : limits.minEtaHours;
  const noticeLabel  = (hasDG || isOversized) ? '48h (hazmat/oversized)' : '24h';

  if (hoursOut < 0) {
    checks.push(check('eta', 'fail', 'ETA — Pre-Arrival Notice',
      'ETA is in the past. File a new SP-1 with a future ETA.',
      `Turkish VTS minimum pre-arrival notice: ${noticeLabel}.`));
  } else if (hoursOut < minHours) {
    checks.push(check('eta', 'fail', 'ETA — Pre-Arrival Notice',
      `ETA is ${hoursOut.toFixed(0)}h from now — below the ${noticeLabel} minimum required. Turkish VTS will reject this SP-1. Re-file with at least ${minHours}h lead time.`,
      `SP-1 must be filed ≥${minHours}h before estimated Bosporus arrival.`));
  } else if (hoursOut < limits.advisoryEtaHours) {
    checks.push(check('eta', 'warning', 'ETA — Pre-Arrival Notice',
      `ETA is ${hoursOut.toFixed(0)}h from now. Meets minimum (${minHours}h) but less than recommended 48h. Transit slot availability may be limited.`,
      'Recommended: 48h advance filing for best slot availability.'));
  } else {
    checks.push(check('eta', 'pass', 'ETA — Pre-Arrival Notice',
      `ETA: ${etaDate.toUTCString()} — ${hoursOut.toFixed(0)}h from now. Meets Turkish VTS ${noticeLabel} requirement.`,
      'Pre-arrival notice requirement satisfied.'));
  }

  // Daytime-only transit check for oversized vessels
  if (isOversized) {
    const etaHour = etaDate.getUTCHours();
    // Turkish local time is UTC+3; daytime window approx 06:00–18:00 local = 03:00–15:00 UTC
    const isDaytime = etaHour >= 3 && etaHour < 15;
    if (!isDaytime) {
      checks.push(check('daytime_transit', 'warning', 'Daytime Transit Compliance (LOA >200m)',
        `ETA hour (UTC ${String(etaHour).padStart(2, '0')}:00) may fall outside Istanbul daytime window (approx 06:00–18:00 local / 03:00–15:00 UTC). Vessels LOA >200m MUST transit during daylight. Verify ETA and adjust if needed.`,
        'Art. 20 Turkish Straits Regulations: LOA >200m = daytime only.'));
    } else {
      checks.push(check('daytime_transit', 'pass', 'Daytime Transit Compliance (LOA >200m)',
        `ETA appears within Istanbul daytime window. Confirm with TBSS slot confirmation.`,
        'Daytime transit requirement plausibly satisfied.'));
    }
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 6: 24h Advance Notification Requirement
// (explicit rule check — distinct from ETA window check above)
// ─────────────────────────────────────────────────────────────────────────────

function validateAdvanceNotification(data) {
  const d = data.document_data || {};
  const notificationSent = d.advance_notification_sent === true;
  const notificationRef  = d.advance_notification_ref;

  if (!notificationSent) {
    return check('advance_notification', 'warning', '24h Advance Notification',
      '24h advance notification to Turkish Maritime Authority not confirmed. Confirm submission and obtain a TBSS pre-arrival acknowledgement reference number.',
      'SP-1 must be submitted ≥24h before Bosporus entry — obtain TBSS acknowledgement.');
  }

  return check('advance_notification', 'pass', '24h Advance Notification',
    `Advance notification confirmed.${notificationRef ? ` TBSS ref: ${notificationRef}.` : ''}`,
    'Turkish VTS advance notification requirement satisfied.');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 7: Crew & Passenger Count
// ─────────────────────────────────────────────────────────────────────────────

function validateCrewPassengers(data) {
  const checks = [];
  const crewCount = parseInt(data.crew_count, 10);
  const passengerCount = parseInt(data.passenger_count, 10);

  if (isNaN(crewCount) || crewCount < 1) {
    checks.push(check('crew_count', 'fail', 'Crew Count',
      'Crew count is required and must be at least 1. Turkish VTS requires total persons on board.',
      'SP-1 requires crew count for FAL Form 5 compliance.'));
  } else if (crewCount > 10000) {
    checks.push(check('crew_count', 'warning', 'Crew Count',
      `Crew count ${crewCount} is unusually high. Verify this is crew only (not total persons on board). For cruise ships, use passenger_count for passengers.`,
      'Crew count must reflect vessel crew, not passengers.'));
  } else {
    checks.push(check('crew_count', 'pass', 'Crew Count',
      `${crewCount} crew member(s) declared.`,
      'Crew count meets SP-1 requirement.'));
  }

  // Passenger count — optional but validated if present
  if (!isNaN(passengerCount)) {
    if (passengerCount < 0) {
      checks.push(check('passenger_count', 'fail', 'Passenger Count',
        'Passenger count cannot be negative.',
        'Passenger count must be 0 or a positive integer.'));
    } else {
      checks.push(check('passenger_count', 'pass', 'Passenger Count',
        `${passengerCount} passenger(s) declared.`,
        'Passenger count valid.'));
    }
  }

  return checks;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 8: Port Sequence (last port / next port sense-check)
// ─────────────────────────────────────────────────────────────────────────────

function validatePortSequence(data) {
  const lastPort       = (data.last_port || '').trim();
  const nextPort       = (data.next_port || '').trim();
  const transitDir     = data.transit_direction;

  if (!lastPort) {
    return check('port_sequence', 'fail', 'Last Port of Call',
      'Last port of call is required on the SP-1 form.',
      'Turkish VTS requires last port for voyage assessment.');
  }

  if (!nextPort) {
    return check('port_sequence', 'fail', 'Next Port of Call',
      'Next port of call is required on the SP-1 form.',
      'Turkish VTS requires next port for voyage assessment.');
  }

  if (!transitDir) {
    return check('port_sequence', 'warning', 'Port Sequence / Transit Direction',
      'Transit direction not declared — cannot verify port sequence makes geographic sense.',
      'SP-1 requires northbound or southbound transit direction declaration.');
  }

  const lastClass = classifyPort(lastPort);
  const nextClass = classifyPort(nextPort);

  // Northbound: last should be Black Sea, next should be Mediterranean (or at least not Black Sea)
  if (transitDir === 'northbound') {
    if (lastClass === 'mediterranean' && nextClass !== 'black_sea') {
      return check('port_sequence', 'warning', 'Port Sequence — Northbound',
        `Northbound transit declared but last port "${lastPort}" appears to be a Mediterranean port. Northbound = Black Sea → Mediterranean. Verify transit direction is correct.`,
        'Northbound: vessel exits Black Sea. Last port should be a Black Sea port.');
    }
    if (nextClass === 'black_sea') {
      return check('port_sequence', 'fail', 'Port Sequence — Northbound',
        `Next port "${nextPort}" appears to be a Black Sea port, but transit direction is northbound (Black Sea → Mediterranean). These cannot both be correct.`,
        'Northbound exits the Black Sea — next port must be outside the Black Sea.');
    }
  }

  // Southbound: last should be Mediterranean, next should be Black Sea
  if (transitDir === 'southbound') {
    if (lastClass === 'black_sea' && nextClass !== 'mediterranean') {
      return check('port_sequence', 'warning', 'Port Sequence — Southbound',
        `Southbound transit declared but last port "${lastPort}" appears to be a Black Sea port. Southbound = Mediterranean → Black Sea. Verify transit direction is correct.`,
        'Southbound: vessel enters the Black Sea. Last port should be Mediterranean.');
    }
    if (nextClass === 'mediterranean') {
      return check('port_sequence', 'fail', 'Port Sequence — Southbound',
        `Next port "${nextPort}" appears to be a Mediterranean port, but transit direction is southbound (Mediterranean → Black Sea). These cannot both be correct.`,
        'Southbound enters the Black Sea — next port must be a Black Sea port.');
    }
  }

  return check('port_sequence', 'pass', 'Port Sequence',
    `Last port: ${lastPort} / Next port: ${nextPort} — sequence plausible for ${transitDir} transit.`,
    'Port sequence consistent with declared transit direction.');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 9: Pilotage Requirement
// ─────────────────────────────────────────────────────────────────────────────

function validatePilotage(data, limits = BSP_LIMITS) {
  const loa = parseFloat(data.loa);
  const gt  = parseFloat(data.gross_tonnage);
  const d   = data.document_data || {};

  const needsByLOA = !isNaN(loa) && loa > limits.pilotMandatoryLOA;
  const needsByGT  = !isNaN(gt)  && gt  > limits.pilotMandatoryGT;
  const pilotageRequired = needsByLOA || needsByGT;

  if (!pilotageRequired) {
    return check('pilotage', 'pass', 'Pilotage Requirement',
      `LOA ${!isNaN(loa) ? loa + 'm' : 'unknown'} / GT ${!isNaN(gt) ? gt : 'unknown'} — pilotage not mandatory (threshold: LOA >${limits.pilotMandatoryLOA}m or GT >${limits.pilotMandatoryGT.toLocaleString()}).`,
      'Pilotage mandatory for LOA >150m or GT >10,000.');
  }

  const pilotBooked = d.pilot_booked === true;
  const reason = needsByLOA ? `LOA ${loa}m >150m` : `GT ${gt} >10,000`;

  if (!pilotBooked) {
    return check('pilotage', 'fail', 'Pilotage — Mandatory',
      `Pilotage is MANDATORY for this vessel (${reason}). Book a licensed Istanbul pilot through TBSS before transit. Failure to take pilot = transit denial.`,
      'Turkish Straits Traffic Regulations: LOA >150m or GT >10,000 = compulsory pilotage.');
  }

  return check('pilotage', 'pass', 'Pilotage — Mandatory',
    `Pilotage booked — requirement satisfied (${reason}).`,
    'Compulsory pilotage confirmed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR 10: Transit Direction Declaration
// ─────────────────────────────────────────────────────────────────────────────

function validateTransitDirection(data) {
  const dir = data.transit_direction || (data.document_data || {}).transit_direction;

  if (!dir) {
    return check('transit_direction', 'fail', 'Transit Direction',
      'Transit direction (northbound or southbound) is required on the SP-1 form.',
      'TBSS VTS requires transit direction for traffic management.');
  }

  if (!['northbound', 'southbound'].includes(dir)) {
    return check('transit_direction', 'fail', 'Transit Direction',
      `"${dir}" is not valid. Must be "northbound" (Black Sea → Mediterranean) or "southbound" (Mediterranean → Black Sea).`,
      'Valid values: northbound, southbound.');
  }

  return check('transit_direction', 'pass', 'Transit Direction',
    `Transit direction: ${dir}.`,
    'Transit direction declared.');
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING: Weighted compliance score 0–100
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate a 0–100 compliance score from a validation result.
 *
 * Weights reflect real-world impact:
 *  - fail on critical checks (LOA daytime, draft limit, hazmat) = heavy penalty
 *  - fail on required fields (IMO, ETA) = medium-heavy penalty
 *  - warnings = small penalty
 */
function calculateComplianceScore(checks) {
  if (!checks || checks.length === 0) return 0;

  // Critical check IDs — failures here are high-penalty
  const CRITICAL_IDS = new Set([
    'loa', 'draft', 'dangerous_goods', 'eta', 'pilotage',
    'imo_number', 'transit_direction', 'port_sequence',
  ]);

  let totalWeight = 0;
  let passedWeight = 0;

  for (const c of checks) {
    const isCritical = CRITICAL_IDS.has(c.id);
    const weight = isCritical ? 15 : 5;
    totalWeight += weight;

    if (c.status === 'pass') {
      passedWeight += weight;
    } else if (c.status === 'warning') {
      passedWeight += weight * 0.5; // half credit
    }
    // fail = 0 credit
  }

  return totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEADLINE TRACKING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate filing deadlines from estimated arrival.
 * Returns ISO strings for deadline_24h and deadline_48h,
 * plus alert times at 12h, 6h, 2h before the 24h deadline.
 *
 * @param {string|Date} estimatedArrival
 * @returns {Object}
 */
function calculateDeadlines(estimatedArrival) {
  if (!estimatedArrival) return null;
  const arrival = new Date(estimatedArrival);
  if (isNaN(arrival.getTime())) return null;

  const MS_PER_HOUR = 60 * 60 * 1000;

  // Hard filing deadline = 24h before arrival
  const deadline24h = new Date(arrival.getTime() - 24 * MS_PER_HOUR);
  // Recommended deadline = 48h before arrival
  const deadline48h = new Date(arrival.getTime() - 48 * MS_PER_HOUR);

  const now = new Date();
  const hoursUntilDeadline = (deadline24h - now) / MS_PER_HOUR;

  // Alert windows
  const alertStatus =
    hoursUntilDeadline < 0     ? 'overdue' :
    hoursUntilDeadline < 2     ? 'critical_2h' :
    hoursUntilDeadline < 6     ? 'warning_6h' :
    hoursUntilDeadline < 12    ? 'warning_12h' :
    'ok';

  return {
    deadline_24h:           deadline24h.toISOString(),
    deadline_48h:           deadline48h.toISOString(),
    hours_until_deadline:   Math.round(hoursUntilDeadline),
    alert_status:           alertStatus,
    filing_overdue:         hoursUntilDeadline < 0,
    recommended_file_by:    deadline48h.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Bosporus SP-1 filing.
 *
 * @param {Object} filingData - Filing record (sp1_filings row or equivalent).
 * @param {Object} [opts={}]  - Options: { limits } to override BSP_LIMITS
 * @returns {Object} Validation result with score, overall_status, checklist
 */
function validateSP1Filing(filingData, opts = {}) {
  if (!filingData) throw new Error('Filing data is required');

  const limits = { ...BSP_LIMITS, ...(opts.limits || {}) };
  const checks = [];

  // 1. IMO checksum
  checks.push(validateIMO(filingData));

  // 2. LOA restriction
  checks.push(validateLOA(filingData, limits));

  // 3. Draft restriction
  checks.push(validateDraft(filingData, limits));

  // 4. Dangerous goods declaration
  checks.push(validateDangerousGoods(filingData));

  // 5 & optional. Transit timing (returns array — may have 1 or 2 checks)
  const timingChecks = validateTransitTiming(filingData, limits);
  checks.push(...timingChecks);

  // 6. Advance notification
  checks.push(validateAdvanceNotification(filingData));

  // 7. Crew & passengers (returns array)
  const crewChecks = validateCrewPassengers(filingData);
  checks.push(...crewChecks);

  // 8. Port sequence
  checks.push(validatePortSequence(filingData));

  // 9. Pilotage requirement
  checks.push(validatePilotage(filingData, limits));

  // 10. Transit direction
  checks.push(validateTransitDirection(filingData));

  const result = buildResult('bosporus', checks);
  result.compliance_score = calculateComplianceScore(checks);

  return result;
}

module.exports = {
  validateSP1Filing,
  validateIMO,
  validateLOA,
  validateDraft,
  validateDangerousGoods,
  validateTransitTiming,
  validateAdvanceNotification,
  validateCrewPassengers,
  validatePortSequence,
  validatePilotage,
  validateTransitDirection,
  calculateComplianceScore,
  calculateDeadlines,
  BSP_LIMITS,
  BSP_HAZMAT_CLASSES_RESTRICTED: [...BSP_HAZMAT_CLASSES_RESTRICTED],
  VALID_VESSEL_TYPES,
};
