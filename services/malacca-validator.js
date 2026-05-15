/**
 * malacca-validator.js — Strait of Malacca & Singapore (STRAITREP/MASTERPLAN) compliance validator
 *
 * Owns: all STRAITREP + MASTERPLAN form validation logic for Malacca / Singapore Strait transits.
 * Does NOT own: database access, filing CRUD, PDF generation, or vessel lookup.
 *
 * Regulatory basis:
 *  - IMO Resolution A.982(24): Mandatory Ship Reporting System for the Straits of Malacca and Singapore (STRAITREP)
 *  - 1977 Malacca-Singapore co-operative mechanism; updated MASTERPLAN 2008
 *  - COLREGS Rule 10 (traffic separation schemes)
 *  - IMO Resolution MSC.73(69): Deep-water route through the Strait of Malacca
 *  - Tioman vessel routing (LOA >250m or draft >15m) — mandatory deep-draft lane
 *  - Tanker/LNG restrictions: pre-notification to Malaysian/Indonesian Maritime Authority
 *  - VHF reporting: Ch. 73 (primary) / Ch. 16 (distress) — mandatory for vessels ≥300 GT
 *  - Minimum under-keel clearance: 3.5m (deepest channel ~27m at low water for deep-draft route)
 *  - Speed restriction near Singapore: 12 knots (Singapore Strait west of 103°51'E)
 */

// ── Malacca Strait Dimensional Limits ─────────────────────────────────────────

const MLC_LIMITS = {
  minGT:             300,    // GT — STRAITREP reporting required above this
  maxDraft:          21.0,   // meters — absolute safe limit (under-keel clearance 3.5m in deep-draft route)
  advisoryDraft:     15.0,   // meters — triggers deep-draft route + authority pre-notification
  deepDraftLOA:      250,    // meters — LOA threshold for deep-draft Tioman route requirement
  maxLOA:            400,    // meters — practical soft limit; >400m requires special VTS coordination
  speedLimit:        12,     // knots — speed limit in Singapore Strait west of 103°51'E
  advisorySpeed:     10,     // knots — recommended in congested waters / poor visibility
  minCrewBridge:     3,      // persons — minimum bridge watch in confined straits
  minEtaHours:       12,     // hours — minimum pre-arrival STRAITREP notice
  advisoryEtaHours:  24,     // hours — recommended for tankers and large vessels
  hazmatEtaHours:    48,     // hours — mandatory for Class 1, 2, 7 hazmat cargo
};

// ── Hazmat classes requiring 48h advance notice ───────────────────────────────
const MLC_HAZMAT_RESTRICTED = new Set(['1', '2', '7']);
const MLC_HAZMAT_ADVISORY   = new Set(['3', '4', '5.1', '5.2', '6.1', '8']);

// ── Valid vessel types ─────────────────────────────────────────────────────────
const VALID_VESSEL_TYPES = [
  'bulk_carrier', 'container', 'tanker', 'lng_carrier', 'lpg_carrier',
  'vehicle_carrier', 'general_cargo', 'reefer', 'cruise', 'ro_ro',
  'chemical_tanker', 'offshore', 'tug', 'yacht', 'other',
];

// ── STRAITREP reporting zones ──────────────────────────────────────────────────
// North sector: One Fathom Bank VTS; South sector: VTIS Singapore
const MALACCA_PORTS = [
  'port klang', 'klang', 'penang', 'george town', 'langkawi', 'lumut',
  'kuala terengganu', 'kuantan', 'mersing', 'tanjung pelepas', 'johor',
  'pasir gudang', 'butterworth',
];
const SINGAPORE_PORTS = ['singapore', 'jurong', 'sembawang', 'tuas'];
const INDONESIA_PORTS = ['batam', 'bintan', 'dumai', 'belawan', 'medan', 'pekanbaru'];
const SUEZ_CONNECTING_PORTS = [
  'colombo', 'mumbai', 'chennai', 'dubai', 'abu dhabi', 'jeddah',
  'port klang', 'singapore', 'jakarta', 'surabaya',
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

  const score = failed === 0 && warnings === 0
    ? 100
    : Math.max(0, Math.round(100 - (failed * 15) - (warnings * 5)));

  return {
    canal,
    overall_status:  failed > 0 ? 'failed' : warnings > 0 ? 'warning' : 'passed',
    compliance_score: score,
    total_checks:    checks.length,
    passed_checks:   passed,
    failed_checks:   failed,
    warning_checks:  warnings,
    checklist:       checks,
    critical_errors: checks.filter(c => c.status === 'fail'),
    warnings_list:   checks.filter(c => c.status === 'warning'),
    passed_list:     checks.filter(c => c.status === 'pass'),
    categories: {
      critical: checks.filter(c => c.status === 'fail'),
      warnings: checks.filter(c => c.status === 'warning'),
      passed:   checks.filter(c => c.status === 'pass'),
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN VALIDATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a Malacca Strait STRAITREP filing.
 *
 * @param {object} filing - form fields from the Malacca demo form
 * @returns {object} validation result with checklist, score, categories
 */
function validateMalaccaFiling(filing) {
  const checks = [];

  // ── 1. IMO number ───────────────────────────────────────────────────────────
  if (!filing.imo_number) {
    checks.push(check('imo_required', 'fail', 'IMO Number',
      'IMO number is required for STRAITREP reporting.',
      'IMO Resolution A.982(24) — STRAITREP mandatory field'));
  } else if (!/^\d{7}$/.test(filing.imo_number.replace(/^IMO\s*/i, '').trim())) {
    checks.push(check('imo_format', 'fail', 'IMO Number Format',
      'IMO number must be exactly 7 digits.',
      'IMO standard format: 7-digit unique identifier'));
  } else {
    checks.push(check('imo_valid', 'pass', 'IMO Number',
      'IMO number format valid.', ''));
  }

  // ── 2. Vessel name ──────────────────────────────────────────────────────────
  if (!filing.vessel_name || String(filing.vessel_name).trim().length < 2) {
    checks.push(check('vessel_name_required', 'fail', 'Vessel Name',
      'Vessel name is required for all STRAITREP submissions.',
      'STRAITREP section A — vessel identification'));
  } else if (String(filing.vessel_name).trim().length > 100) {
    checks.push(check('vessel_name_length', 'fail', 'Vessel Name Length',
      'Vessel name must be under 100 characters.',
      'STRAITREP field length limit'));
  } else {
    checks.push(check('vessel_name_valid', 'pass', 'Vessel Name',
      'Vessel name provided.', ''));
  }

  // ── 3. Flag state ───────────────────────────────────────────────────────────
  if (!filing.flag_state) {
    checks.push(check('flag_required', 'fail', 'Flag State',
      'Flag state is required for STRAITREP identification.',
      'STRAITREP section A — flag state mandatory'));
  } else {
    checks.push(check('flag_valid', 'pass', 'Flag State',
      'Flag state provided.', ''));
  }

  // ── 4. Vessel type ──────────────────────────────────────────────────────────
  if (!filing.vessel_type) {
    checks.push(check('vessel_type_required', 'fail', 'Vessel Type',
      'Vessel type is required.',
      'STRAITREP mandatory field — determines routing requirements'));
  } else {
    checks.push(check('vessel_type_valid', 'pass', 'Vessel Type',
      'Vessel type declared.', ''));
  }

  // ── 5. Gross tonnage / STRAITREP threshold ──────────────────────────────────
  const gt = parseFloat(filing.gross_tonnage);
  if (!gt || gt <= 0) {
    checks.push(check('gt_required', 'fail', 'Gross Tonnage',
      'Gross tonnage is required.',
      'STRAITREP mandatory — vessels ≥300 GT must participate'));
  } else if (gt < MLC_LIMITS.minGT) {
    checks.push(check('gt_below_straitrep', 'warning', 'STRAITREP Threshold',
      `GT ${gt.toLocaleString()} is below the 300 GT STRAITREP threshold. Voluntary reporting recommended.`,
      'IMO A.982(24) — mandatory reporting for vessels ≥300 GT'));
  } else {
    checks.push(check('gt_straitrep_required', 'pass', 'STRAITREP Reporting',
      `GT ${gt.toLocaleString()} — STRAITREP mandatory participation confirmed.`, ''));
  }

  // ── 6. LOA limits and deep-draft routing ────────────────────────────────────
  const loa = parseFloat(filing.loa);
  if (!loa || loa <= 0) {
    checks.push(check('loa_required', 'fail', 'Length Overall (LOA)',
      'LOA is required for routing determination.',
      'Tioman deep-water route required for LOA >250m'));
  } else if (loa > MLC_LIMITS.maxLOA) {
    checks.push(check('loa_vts_coordination', 'fail', 'LOA — VTS Coordination Required',
      `LOA ${loa}m exceeds 400m. Special coordination with STRAITREP VTS mandatory before transit.`,
      'VTIS One Fathom Bank / VTIS Singapore — prior approval for oversized vessels'));
  } else if (loa > MLC_LIMITS.deepDraftLOA) {
    checks.push(check('loa_deep_draft_route', 'warning', 'Deep-Draft Route Required',
      `LOA ${loa}m exceeds 250m. Vessels must use the designated Tioman deep-water route. Coordinate with One Fathom Bank VTS.`,
      'IMO MSC.73(69) — deep-water route through Malacca Strait for large vessels'));
  } else {
    checks.push(check('loa_ok', 'pass', 'Length Overall (LOA)',
      `LOA ${loa}m within standard routing limits.`, ''));
  }

  // ── 7. Draft limits ─────────────────────────────────────────────────────────
  const draft = parseFloat(filing.draft);
  if (!draft || draft <= 0) {
    checks.push(check('draft_required', 'fail', 'Maximum Draft',
      'Draft is required for safety clearance calculation.',
      'Malacca Strait — minimum under-keel clearance 3.5m'));
  } else if (draft > MLC_LIMITS.maxDraft) {
    checks.push(check('draft_exceeds_limit', 'fail', 'Draft Exceeds Maximum',
      `Draft ${draft}m exceeds the ${MLC_LIMITS.maxDraft}m safe navigation limit. Under-keel clearance would be below 3.5m on the deep-draft route.`,
      'IMO MSC.73(69) — deep-draft route maximum draft ~21m at LAT'));
  } else if (draft > MLC_LIMITS.advisoryDraft) {
    checks.push(check('draft_deep_draft_pre_notify', 'warning', 'Deep-Draft Pre-Notification',
      `Draft ${draft}m exceeds 15m. Pre-notification to Malaysian and Indonesian Maritime Authorities required. Use Tioman deep-draft lane.`,
      'MASTERPLAN 2008 — pre-notification mandatory for draft >15m'));
  } else {
    checks.push(check('draft_ok', 'pass', 'Draft',
      `Draft ${draft}m within safe navigation limits.`, ''));
  }

  // ── 8. STRAITREP ETA / pre-arrival notice ──────────────────────────────────
  const hasHazmat = !!(filing.has_dangerous_goods);
  const hasDGClass = filing.dangerous_goods_class;
  const dgRestricted = hasDGClass && MLC_HAZMAT_RESTRICTED.has(String(hasDGClass));

  if (!filing.estimated_arrival) {
    checks.push(check('eta_required', 'fail', 'ETA Required',
      'Estimated time of arrival (ETA) is required for STRAITREP.',
      'STRAITREP section B — ETA to One Fathom Bank / Singapore mandatory'));
  } else {
    const etaMs  = new Date(filing.estimated_arrival).getTime();
    const nowMs  = Date.now();
    const hoursAhead = (etaMs - nowMs) / (1000 * 60 * 60);

    if (hoursAhead < 0) {
      checks.push(check('eta_past', 'fail', 'ETA in the Past',
        'Estimated arrival time is in the past. STRAITREP requires advance notice.',
        'STRAITREP — notice must be filed before vessel enters reporting zone'));
    } else if (dgRestricted && hoursAhead < MLC_LIMITS.hazmatEtaHours) {
      checks.push(check('eta_hazmat_window', 'fail', 'Hazmat 48h Pre-Arrival Notice',
        `ETA is only ${Math.round(hoursAhead)}h away. Class ${hasDGClass} cargo requires 48h advance STRAITREP notification to authorities.`,
        'MASTERPLAN 2008 — restricted hazmat requires 48h advance notice'));
    } else if (hoursAhead < MLC_LIMITS.minEtaHours) {
      checks.push(check('eta_short_notice', 'fail', 'Insufficient Pre-Arrival Notice',
        `ETA is only ${Math.round(hoursAhead)}h away. Minimum 12h STRAITREP pre-arrival notice required.`,
        'STRAITREP — 12h minimum advance reporting window'));
    } else if (hoursAhead < MLC_LIMITS.advisoryEtaHours) {
      checks.push(check('eta_advisory', 'warning', 'ETA Lead Time Advisory',
        `${Math.round(hoursAhead)}h notice. 24h advance notice recommended for tankers and large vessels.`,
        'MASTERPLAN 2008 — 24h advisory for tankers/large vessels'));
    } else {
      checks.push(check('eta_ok', 'pass', 'STRAITREP Pre-Arrival Notice',
        `${Math.round(hoursAhead)}h advance notice — meets mandatory STRAITREP requirements.`, ''));
    }
  }

  // ── 9. Crew count — bridge watch ───────────────────────────────────────────
  const crew = parseInt(filing.crew_count);
  if (!crew || crew < 1) {
    checks.push(check('crew_required', 'fail', 'Crew Count',
      'Crew count is required.',
      'SOLAS — minimum manning certificate must be met'));
  } else if (crew < MLC_LIMITS.minCrewBridge) {
    checks.push(check('crew_bridge_watch', 'fail', 'Bridge Watch — Minimum 3',
      `${crew} crew declared. Malacca Strait requires minimum 3-person bridge watch in confined waters.`,
      'SOLAS / VTS recommendation — 3-person bridge watch in high-density traffic zone'));
  } else {
    checks.push(check('crew_ok', 'pass', 'Crew / Bridge Watch',
      `${crew} crew — bridge watch requirements met.`, ''));
  }

  // ── 10. Hazardous cargo declarations ───────────────────────────────────────
  if (hasHazmat) {
    if (!hasDGClass) {
      checks.push(check('dg_class_required', 'fail', 'DG Class Required',
        'Dangerous goods class must be declared when hazardous cargo is present.',
        'IMDG Code — class declaration mandatory for DG cargo'));
    } else if (dgRestricted) {
      checks.push(check('dg_restricted_prenotify', 'fail', 'Restricted DG — 48h Pre-Notification',
        `IMDG Class ${hasDGClass} cargo in Malacca Strait requires 48h advance notification to Malaysian Maritime Enforcement Agency (MMEA) and Indonesian Maritime Authority.`,
        'MASTERPLAN 2008 — Class 1, 2, 7 DG require authority pre-approval'));
    } else if (MLC_HAZMAT_ADVISORY.has(String(hasDGClass))) {
      checks.push(check('dg_advisory', 'warning', 'DG — Enhanced Monitoring Required',
        `Class ${hasDGClass} cargo — declare in STRAITREP and maintain VHF Ch. 73 watch. Follow IMDG segregation requirements.`,
        'STRAITREP — DG cargo must be declared in notification message'));
    } else {
      checks.push(check('dg_declared', 'pass', 'Hazardous Cargo Declaration',
        `Class ${hasDGClass} declared in STRAITREP.`, ''));
    }
  } else {
    checks.push(check('dg_none', 'pass', 'Hazardous Cargo',
      'No dangerous goods — standard STRAITREP applies.', ''));
  }

  // ── 11. Speed compliance ────────────────────────────────────────────────────
  const speed = parseFloat(filing.speed_knots);
  if (speed && speed > MLC_LIMITS.speedLimit) {
    checks.push(check('speed_exceeds_limit', 'fail', 'Speed Limit Exceeded',
      `Speed ${speed} knots exceeds the 12-knot limit in Singapore Strait west of 103°51'E.`,
      'Port of Singapore Authority — 12-knot speed restriction'));
  } else if (speed && speed > MLC_LIMITS.advisorySpeed && (loa > 300 || (draft && draft > 12))) {
    checks.push(check('speed_advisory_large', 'warning', 'Speed Advisory — Large Vessel',
      `Speed ${speed} knots. Vessels >300m LOA or draft >12m recommended to maintain ≤10 knots in congested strait sections.`,
      'STRAITREP VTS advisory — large vessel speed recommendation'));
  } else if (speed && speed > 0) {
    checks.push(check('speed_ok', 'pass', 'Speed Compliance',
      `Speed ${speed} knots within limits.`, ''));
  }

  // ── 12. Transit direction ───────────────────────────────────────────────────
  if (!filing.transit_direction) {
    checks.push(check('direction_required', 'fail', 'Transit Direction',
      'Transit direction (eastbound/westbound) is required for traffic separation compliance.',
      'COLREGS Rule 10 — TSS lane assignment depends on direction'));
  } else {
    checks.push(check('direction_ok', 'pass', 'Transit Direction',
      `${filing.transit_direction.charAt(0).toUpperCase() + filing.transit_direction.slice(1)} transit declared.`, ''));
  }

  // ── 13. VHF watch confirmation ──────────────────────────────────────────────
  if (gt >= MLC_LIMITS.minGT) {
    if (filing.vhf_watch === false || filing.vhf_watch === 'false') {
      checks.push(check('vhf_watch_required', 'fail', 'VHF Ch. 73 Watch',
        'Continuous VHF Ch. 73 watch is mandatory for vessels ≥300 GT throughout the strait.',
        'IMO A.982(24) — STRAITREP VHF Ch. 73 continuous monitoring required'));
    } else {
      checks.push(check('vhf_watch_ok', 'pass', 'VHF Watch',
        'VHF Ch. 73 / Ch. 16 watch maintained — STRAITREP compliant.', ''));
    }
  }

  // ── 14. Pilotage ────────────────────────────────────────────────────────────
  // Malacca Strait pilotage is not mandatory (unlike Bosporus), but strongly recommended for:
  // - LOA > 300m
  // - Draft > 15m
  // - First-time transits
  if (loa > 300 || (draft && draft > MLC_LIMITS.advisoryDraft)) {
    const pilotBooked = filing.pilotage_booked;
    if (pilotBooked === false || pilotBooked === 'false') {
      checks.push(check('pilotage_recommended', 'warning', 'Pilotage — Strongly Recommended',
        `For vessels with LOA ${loa ? loa + 'm' : '>300m'} or draft >15m, licensed Malacca Strait pilot is strongly recommended.`,
        'MASTERPLAN 2008 — voluntary pilotage for large/deep-draft vessels'));
    } else {
      checks.push(check('pilotage_ok', 'pass', 'Pilotage',
        'Pilotage arranged for large/deep-draft transit.', ''));
    }
  }

  // ── 15. ISPS / security check ───────────────────────────────────────────────
  if (!filing.isps_compliant && filing.isps_compliant !== undefined) {
    checks.push(check('isps_required', 'fail', 'ISPS Security Level',
      'ISPS compliance declaration required. Malacca Strait is a high-security zone (MARSEC Level 1 minimum).',
      'ISPS Code — Chapter XI-2 SOLAS security compliance mandatory'));
  } else if (filing.isps_compliant) {
    checks.push(check('isps_ok', 'pass', 'ISPS Security Compliance',
      'ISPS security declaration confirmed.', ''));
  }

  return buildResult('malacca', checks);
}

module.exports = { validateMalaccaFiling, MLC_LIMITS, VALID_VESSEL_TYPES };
