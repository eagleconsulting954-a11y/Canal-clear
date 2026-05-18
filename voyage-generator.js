/**
 * services/voyage-generator.js — Voyage route analysis + filing pre-population
 *
 * Owns: waterway detection from port-pair routes, ETA estimation per waypoint,
 *       deadline calculation per waterway, filing data pre-population from vessel + route.
 * Does NOT own: SQL, route handling, PDF generation, or auth.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Waterway geography — approximate latitude/longitude gate crossings
// Used to detect which canals a route crosses based on origin/destination ports
// ─────────────────────────────────────────────────────────────────────────────

const WATERWAY_GATES = {
  panama: {
    lat: 9.0,
    lonRange: [-80.0, -79.0],
    label: 'Panama Canal',
    requiredForms: ['VUMPA', 'PCSOPEP'],
    transitHours: 10,
    deadlineHoursBefore: 96, // 96h pre-arrival notice
  },
  suez: {
    lat: 30.5,
    lonRange: [32.0, 33.0],
    label: 'Suez Canal',
    requiredForms: ['SCA Form', 'SCNT', 'Convoy Booking'],
    transitHours: 16,
    deadlineHoursBefore: 48,
  },
  bosporus: {
    lat: 41.0,
    lonRange: [28.9, 29.2],
    label: 'Bosporus Strait',
    requiredForms: ['SP-1 Form', 'Dangerous Cargo Notice'],
    transitHours: 8,
    deadlineHoursBefore: 24,
  },
  malacca: {
    lat: 2.5,
    lonRange: [99.0, 104.0],
    label: 'Strait of Malacca',
    requiredForms: ['STRAITREP', 'VTIS Pre-Arrival'],
    transitHours: 20,
    deadlineHoursBefore: 24,
  },
  cape: {
    lat: -34.5,
    lonRange: [17.0, 20.0],
    label: 'Cape of Good Hope',
    requiredForms: ['SAMSA ISPS Pre-Arrival'],
    transitHours: 6,
    deadlineHoursBefore: 96,
  },
};

// Major port approximate coordinates for ETA calculation
const PORT_COORDS = {
  'Shanghai':       { lat: 31.2, lon: 121.5 },
  'Singapore':      { lat: 1.3,  lon: 103.8 },
  'Rotterdam':      { lat: 51.9, lon: 4.5   },
  'Hamburg':        { lat: 53.5, lon: 10.0  },
  'Antwerp':        { lat: 51.2, lon: 4.4   },
  'Felixstowe':     { lat: 51.9, lon: 1.3   },
  'Dubai':          { lat: 25.1, lon: 55.2  },
  'Jeddah':         { lat: 21.5, lon: 39.2  },
  'Port Said':      { lat: 31.3, lon: 32.3  },
  'Istanbul':       { lat: 41.0, lon: 29.0  },
  'Novorossiysk':   { lat: 44.7, lon: 37.8  },
  'Odessa':         { lat: 46.5, lon: 30.7  },
  'Colón':          { lat: 9.4,  lon: -79.9 },
  'Balboa':         { lat: 8.9,  lon: -79.6 },
  'Los Angeles':    { lat: 33.7, lon: -118.3},
  'Long Beach':     { lat: 33.8, lon: -118.2},
  'New York':       { lat: 40.7, lon: -74.0 },
  'Houston':        { lat: 29.7, lon: -95.0 },
  'Cape Town':      { lat: -33.9,lon: 18.4  },
  'Port Elizabeth': { lat: -33.9,lon: 25.6  },
  'Durban':         { lat: -29.9,lon: 31.0  },
  'Colombo':        { lat: 6.9,  lon: 79.9  },
  'Mumbai':         { lat: 18.9, lon: 72.8  },
  'Busan':          { lat: 35.1, lon: 129.0 },
  'Yokohama':       { lat: 35.4, lon: 139.6 },
  'Hong Kong':      { lat: 22.3, lon: 114.2 },
  'Guangzhou':      { lat: 23.1, lon: 113.3 },
  'Tianjin':        { lat: 39.0, lon: 117.7 },
  'Kaohsiung':      { lat: 22.6, lon: 120.3 },
  'Port Klang':     { lat: 3.0,  lon: 101.4 },
  'Tanjung Pelepas':{ lat: 1.4,  lon: 103.6 },
  'Piraeus':        { lat: 37.9, lon: 23.7  },
  'Barcelona':      { lat: 41.4, lon: 2.2   },
  'Algeciras':      { lat: 36.1, lon: -5.5  },
  'Valencia':       { lat: 39.5, lon: -0.3  },
  'Genoa':          { lat: 44.4, lon: 8.9   },
};

/**
 * Detect which waterways a route crosses based on origin and destination.
 * Uses simple great-circle path sampling — good enough for demonstration.
 *
 * @param {string} origin - Origin port name
 * @param {string} destination - Destination port name
 * @param {string[]} [manual] - Manually selected waterways (overrides auto-detect if provided)
 * @returns {string[]} Array of waterway keys in transit order
 */
function detectWaterways(origin, destination, manual) {
  if (manual && manual.length > 0) return [...manual];

  const origCoords  = PORT_COORDS[origin]      || guessCoords(origin);
  const destCoords  = PORT_COORDS[destination] || guessCoords(destination);
  if (!origCoords || !destCoords) return [];

  const detected = [];

  // Sample 20 points along the great-circle path
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t   = i / steps;
    const lat = origCoords.lat + (destCoords.lat - origCoords.lat) * t;
    const lon = origCoords.lon + (destCoords.lon - origCoords.lon) * t;

    for (const [key, gate] of Object.entries(WATERWAY_GATES)) {
      if (detected.includes(key)) continue;
      const latMatch = Math.abs(lat - gate.lat) < 4;
      const lonMatch = lon >= gate.lonRange[0] && lon <= gate.lonRange[1];
      if (latMatch && lonMatch) detected.push(key);
    }
  }

  // Sort by approximate longitude order of transit (west→east vs east→west)
  const goingWest = origCoords.lon > destCoords.lon;
  return sortWaterwaysByRoute(detected, goingWest);
}

function guessCoords(portName) {
  // Fuzzy match: try starts-with for known ports
  const lower = portName.toLowerCase();
  for (const [name, coords] of Object.entries(PORT_COORDS)) {
    if (name.toLowerCase().startsWith(lower.slice(0, 4))) return coords;
  }
  return null;
}

function sortWaterwaysByRoute(waterways, goingWest) {
  const ORDER_WEST_TO_EAST = ['panama', 'cape', 'malacca', 'bosporus', 'suez'];
  const ORDER_EAST_TO_WEST = ['suez', 'bosporus', 'malacca', 'cape', 'panama'];
  const order = goingWest ? ORDER_WEST_TO_EAST : ORDER_EAST_TO_WEST;
  return order.filter(w => waterways.includes(w));
}

/**
 * Calculate ETA at each waterway waypoint and filing deadlines.
 *
 * @param {string} origin - Origin port name
 * @param {string} destination - Destination port name
 * @param {Date|string} departureDate - Departure date/time
 * @param {number} speedKt - Vessel speed in knots
 * @param {string[]} waterways - Ordered list of waterways to transit
 * @returns {Object[]} Array of waypoint objects with eta, etd, filing_deadline
 */
function calculateWaypointTimings(origin, destination, departureDate, speedKt, waterways) {
  const departure   = new Date(departureDate);
  const origCoords  = PORT_COORDS[origin]      || { lat: 0, lon: 0 };
  const destCoords  = PORT_COORDS[destination] || { lat: 0, lon: 0 };
  const speed       = speedKt || 14;

  // Build a list of points to traverse: origin → each waterway gate → destination
  const gateCenters = waterways.map(w => ({
    key: w,
    lat: WATERWAY_GATES[w].lat,
    lon: (WATERWAY_GATES[w].lonRange[0] + WATERWAY_GATES[w].lonRange[1]) / 2,
  }));

  const points = [
    { key: 'origin', lat: origCoords.lat, lon: origCoords.lon },
    ...gateCenters,
    { key: 'destination', lat: destCoords.lat, lon: destCoords.lon },
  ];

  const waypoints = [];
  let currentTime = new Date(departure);
  let prevPoint   = points[0];

  for (let i = 1; i < points.length - 1; i++) {
    const gate = points[i];
    const next = points[i + 1];

    // Distance from previous point to this gate (nautical miles)
    const distToGate = haversineNm(prevPoint.lat, prevPoint.lon, gate.lat, gate.lon);
    const hoursToGate = distToGate / speed;
    const eta = new Date(currentTime.getTime() + hoursToGate * 3600000);

    const waterway = gate.key;
    const transitHours = WATERWAY_GATES[waterway].transitHours;
    const etd = new Date(eta.getTime() + transitHours * 3600000);
    const deadlineBefore = WATERWAY_GATES[waterway].deadlineHoursBefore;
    const filingDeadline = new Date(eta.getTime() - deadlineBefore * 3600000);

    // Entry/exit port names
    const portEntry = waterway === 'panama'    ? 'Colón'
                    : waterway === 'suez'      ? 'Port Said'
                    : waterway === 'bosporus'  ? 'Istanbul'
                    : waterway === 'malacca'   ? 'Port Klang'
                    : 'Cape Town';
    const portExit  = waterway === 'panama'    ? 'Balboa'
                    : waterway === 'suez'      ? 'Suez'
                    : waterway === 'bosporus'  ? 'İzmit'
                    : waterway === 'malacca'   ? 'Singapore'
                    : 'Port Elizabeth';

    waypoints.push({
      waterway,
      sequence_order: i - 1,
      port_entry:     portEntry,
      port_exit:      portExit,
      eta:            eta.toISOString(),
      etd:            etd.toISOString(),
      transit_hours:  transitHours,
      filing_deadline: filingDeadline.toISOString(),
      filing_status:  'pending',
      compliance_score: 0,
      filing_data:    buildFilingData(waterway, {}), // empty pre-fill; user completes
    });

    prevPoint   = gate;
    currentTime = etd;
  }

  return waypoints;
}

/**
 * Pre-populate filing_data for a waterway from vessel + voyage context.
 */
function buildFilingData(waterway, vessel) {
  const base = {
    vessel_name:   vessel.vessel_name   || vessel.name   || null,
    imo_number:    vessel.imo_number    || vessel.imo    || null,
    flag_state:    vessel.flag_state    || vessel.flag   || null,
    call_sign:     vessel.call_sign     || vessel.callsign || null,
    mmsi:          vessel.mmsi          || null,
    vessel_type:   vessel.vessel_type   || vessel.type   || null,
    gross_tonnage: vessel.gross_tonnage || vessel.gt     || null,
    net_tonnage:   vessel.net_tonnage   || vessel.nt     || null,
    loa:           vessel.loa           || null,
    beam:          vessel.beam          || null,
    draft:         vessel.draft         || null,
  };

  if (waterway === 'panama') {
    return { ...base, transit_direction: 'northbound', cargo_type: null, booking_ref: null };
  }
  if (waterway === 'suez') {
    return { ...base, convoy_direction: 'northbound', cargo_description: null };
  }
  if (waterway === 'bosporus') {
    return { ...base, transit_direction: 'northbound', dangerous_cargo: false, cargo_class: null };
  }
  if (waterway === 'malacca') {
    return { ...base, transit_direction: 'westbound', speed_through_water: 12, has_dangerous_goods: false };
  }
  if (waterway === 'cape') {
    return { ...base, isps_security_level: 1, has_dangerous_goods: false, crew_count: null, port_of_origin: null, next_port: null };
  }
  return base;
}

/**
 * Haversine distance in nautical miles.
 */
function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in NM
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
           + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

/**
 * Return the human-readable label for a waterway key.
 */
function waterwayLabel(key) {
  return (WATERWAY_GATES[key] || {}).label || key;
}

/**
 * Return required form names for a waterway.
 */
function requiredForms(key) {
  return (WATERWAY_GATES[key] || {}).requiredForms || [];
}

/**
 * Compute overall voyage compliance score (weighted average of waypoint scores).
 */
function computeOverallScore(waypoints) {
  if (!waypoints || waypoints.length === 0) return 0;
  const total = waypoints.reduce((acc, w) => acc + (w.compliance_score || 0), 0);
  return Math.round(total / waypoints.length);
}

module.exports = {
  detectWaterways,
  calculateWaypointTimings,
  buildFilingData,
  computeOverallScore,
  waterwayLabel,
  requiredForms,
  WATERWAY_GATES,
  PORT_COORDS,
};
