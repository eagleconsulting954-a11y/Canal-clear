/**
 * services/ais-mock-provider.js — Mock AIS data generator.
 *
 * Owns: simulation of 25 vessels on realistic shipping routes toward the 5 canals.
 * Does NOT own: database writes (caller does that), route handling, provider switching.
 *
 * Generates positions every 5 minutes (configurable). Vessels move at 12–16 knots
 * on great-circle approximations toward canal waypoints. Simulates vessels at
 * various distances: 96h out, 48h, 24h, and actively transiting.
 */

// ── Canal entry coordinates ───────────────────────────────────────────────────
const CANAL_WAYPOINTS = {
  panama:   { lat:  8.9942, lon: -79.5667, name: 'Panama Canal (Balboa)' },
  suez:     { lat: 30.0444, lon:  32.5498, name: 'Suez Canal (Port Said)' },
  bosporus: { lat: 41.1451, lon:  29.0695, name: 'Bosphorus Strait (Istanbul)' },
  malacca:  { lat:  1.3521, lon: 103.8198, name: 'Strait of Malacca (Singapore)' },
  cape:     { lat: -34.358, lon:  18.4739, name: 'Cape of Good Hope' },
};

// ── Haversine distance (nm) ───────────────────────────────────────────────────
function distanceNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Bearing from A to B (degrees) ────────────────────────────────────────────
function bearingTo(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// ── Move a point toward a target by `distNm` nautical miles ──────────────────
function moveToward(lat, lon, targetLat, targetLon, distNm) {
  const R = 3440.065;
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const bearing = toRad(bearingTo(lat, lon, targetLat, targetLon));
  const d = distNm / R;
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(bearing)
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2)
    );
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

// ── Vessel fleet definition ───────────────────────────────────────────────────
// Each vessel has a target canal, initial position, speed, and type.
// Distances chosen to simulate: ~96h out, ~48h, ~24h, transiting.
// At 14 knots: 96h = ~1344 nm | 48h = ~672 nm | 24h = ~336 nm | transiting < 50 nm
const VESSEL_FLEET = [
  // ── Panama Canal approaches ────────────────────────────────────────────────
  {
    imo: '9123456',
    name: 'MV PACIFIC GUARDIAN',
    mmsi: '338012345',
    type: 'Container',
    flag: 'PA',
    targetCanal: 'panama',
    // ~96h out, approaching from Pacific (west of Panama)
    startLat:  8.99,
    startLon: -94.8,
    speedKnots: 14.2,
    navStatus: 'underway',
  },
  {
    imo: '9234567',
    name: 'MT ANDEAN SPIRIT',
    mmsi: '357034567',
    type: 'Tanker',
    flag: 'PA',
    targetCanal: 'panama',
    // ~48h out, Atlantic approach
    startLat:  9.5,
    startLon: -74.5,
    speedKnots: 13.5,
    navStatus: 'underway',
  },
  {
    imo: '9345678',
    name: 'MV COLON BRIDGE',
    mmsi: '351045678',
    type: 'General Cargo',
    flag: 'PA',
    targetCanal: 'panama',
    // ~24h out from Atlantic
    startLat:  9.3,
    startLon: -77.1,
    speedKnots: 12.8,
    navStatus: 'underway',
  },
  {
    imo: '9456789',
    name: 'MV MIRAFLORES STAR',
    mmsi: '352056789',
    type: 'Bulk Carrier',
    flag: 'MH',
    targetCanal: 'panama',
    // Actively transiting
    startLat:  9.0,
    startLon: -79.6,
    speedKnots: 6.5,
    navStatus: 'restricted_manoeuvrability',
  },
  {
    imo: '9567890',
    name: 'MV ISLA CONTADORA',
    mmsi: '370067890',
    type: 'Container',
    flag: 'PA',
    targetCanal: 'panama',
    // ~72h out from Pacific
    startLat:  8.5,
    startLon: -89.9,
    speedKnots: 15.1,
    navStatus: 'underway',
  },

  // ── Suez Canal approaches ──────────────────────────────────────────────────
  {
    imo: '9678901',
    name: 'MV MEDITERRANEAN HAWK',
    mmsi: '229078901',
    type: 'Container',
    flag: 'GR',
    targetCanal: 'suez',
    // ~96h from north (Mediterranean)
    startLat:  35.1,
    startLon:  28.9,
    speedKnots: 14.0,
    navStatus: 'underway',
  },
  {
    imo: '9789012',
    name: 'MT ARABIAN TIDE',
    mmsi: '477089012',
    type: 'Tanker',
    flag: 'HK',
    targetCanal: 'suez',
    // ~48h from south (Red Sea)
    startLat:  25.5,
    startLon:  35.2,
    speedKnots: 13.8,
    navStatus: 'underway',
  },
  {
    imo: '9890123',
    name: 'MV NILE PASSAGE',
    mmsi: '672090123',
    type: 'Bulk Carrier',
    flag: 'EG',
    targetCanal: 'suez',
    // ~24h out, Red Sea approach
    startLat:  28.1,
    startLon:  33.0,
    speedKnots: 13.0,
    navStatus: 'underway',
  },
  {
    imo: '9901234',
    name: 'MV PORT SAID TRADER',
    mmsi: '248101234',
    type: 'General Cargo',
    flag: 'MT',
    targetCanal: 'suez',
    // Actively transiting (Suez)
    startLat:  29.8,
    startLon:  32.5,
    speedKnots: 8.0,
    navStatus: 'restricted_manoeuvrability',
  },
  {
    imo: '9012345',
    name: 'MV ISMAILIA EXPRESS',
    mmsi: '338112345',
    type: 'Container',
    flag: 'US',
    targetCanal: 'suez',
    // ~72h from Mediterranean
    startLat:  34.5,
    startLon:  26.5,
    speedKnots: 15.8,
    navStatus: 'underway',
  },

  // ── Bosphorus / Turkish Straits approaches ─────────────────────────────────
  {
    imo: '9112233',
    name: 'MT BLACK SEA VENTURE',
    mmsi: '271112233',
    type: 'Tanker',
    flag: 'TR',
    targetCanal: 'bosporus',
    // ~96h from Black Sea (north)
    startLat:  44.9,
    startLon:  31.5,
    speedKnots: 13.0,
    navStatus: 'underway',
  },
  {
    imo: '9223344',
    name: 'MV AEGEAN VOYAGER',
    mmsi: '240223344',
    type: 'Bulk Carrier',
    flag: 'GR',
    targetCanal: 'bosporus',
    // ~48h from Aegean (south)
    startLat:  38.9,
    startLon:  27.2,
    speedKnots: 12.5,
    navStatus: 'underway',
  },
  {
    imo: '9334455',
    name: 'MV ISTANBUL PASSAGE',
    mmsi: '271334455',
    type: 'General Cargo',
    flag: 'TR',
    targetCanal: 'bosporus',
    // ~24h out, approaching from Marmara
    startLat:  40.7,
    startLon:  28.4,
    speedKnots: 11.8,
    navStatus: 'underway',
  },
  {
    imo: '9445566',
    name: 'MT MONTREUX TRADER',
    mmsi: '212445566',
    type: 'Tanker',
    flag: 'CY',
    targetCanal: 'bosporus',
    // Actively transiting
    startLat:  41.1,
    startLon:  29.0,
    speedKnots: 7.0,
    navStatus: 'restricted_manoeuvrability',
  },

  // ── Strait of Malacca approaches ──────────────────────────────────────────
  {
    imo: '9556677',
    name: 'MV SINGAPORE STAR',
    mmsi: '563556677',
    type: 'Container',
    flag: 'SG',
    targetCanal: 'malacca',
    // ~96h from Indian Ocean (west)
    startLat:  2.5,
    startLon:  93.5,
    speedKnots: 16.0,
    navStatus: 'underway',
  },
  {
    imo: '9667788',
    name: 'MT STRAITS PIONEER',
    mmsi: '525667788',
    type: 'Tanker',
    flag: 'MY',
    targetCanal: 'malacca',
    // ~48h from west (Indian Ocean)
    startLat:  3.1,
    startLon:  97.8,
    speedKnots: 14.5,
    navStatus: 'underway',
  },
  {
    imo: '9778899',
    name: 'MV PENANG TRADER',
    mmsi: '525778899',
    type: 'Bulk Carrier',
    flag: 'MY',
    targetCanal: 'malacca',
    // ~24h out, approaching from west
    startLat:  3.8,
    startLon: 100.1,
    speedKnots: 13.2,
    navStatus: 'underway',
  },
  {
    imo: '9889900',
    name: 'MV SUNDA STRAIT RUNNER',
    mmsi: '525889900',
    type: 'General Cargo',
    flag: 'ID',
    targetCanal: 'malacca',
    // ~72h, coming from South China Sea (east)
    startLat:  1.5,
    startLon: 109.8,
    speedKnots: 12.0,
    navStatus: 'underway',
  },
  {
    imo: '9990011',
    name: 'MT MALACCA HORIZON',
    mmsi: '563990011',
    type: 'Tanker',
    flag: 'SG',
    targetCanal: 'malacca',
    // Actively transiting
    startLat:  1.8,
    startLon: 103.5,
    speedKnots: 9.0,
    navStatus: 'restricted_manoeuvrability',
  },

  // ── Cape of Good Hope approaches ──────────────────────────────────────────
  {
    imo: '9100122',
    name: 'MV CAPE CONDOR',
    mmsi: '655100122',
    type: 'Container',
    flag: 'ZA',
    targetCanal: 'cape',
    // ~96h from east (Indian Ocean approach)
    startLat: -32.0,
    startLon:  31.5,
    speedKnots: 14.8,
    navStatus: 'underway',
  },
  {
    imo: '9200233',
    name: 'MT AGULHAS SPIRIT',
    mmsi: '655200233',
    type: 'Tanker',
    flag: 'ZA',
    targetCanal: 'cape',
    // ~48h from south-east
    startLat: -35.5,
    startLon:  24.8,
    speedKnots: 13.6,
    navStatus: 'underway',
  },
  {
    imo: '9300344',
    name: 'MV DURBAN PASSAGE',
    mmsi: '655300344',
    type: 'Bulk Carrier',
    flag: 'ZA',
    targetCanal: 'cape',
    // ~24h from east
    startLat: -33.9,
    startLon:  21.0,
    speedKnots: 12.2,
    navStatus: 'underway',
  },
  {
    imo: '9400455',
    name: 'MV SOUTHERN CROSS',
    mmsi: '655400455',
    type: 'General Cargo',
    flag: 'ZA',
    targetCanal: 'cape',
    // ~72h from Atlantic (north-west)
    startLat: -30.2,
    startLon:  10.5,
    speedKnots: 13.9,
    navStatus: 'underway',
  },
  {
    imo: '9500566',
    name: 'MT TABLE BAY WIND',
    mmsi: '655500566',
    type: 'Tanker',
    flag: 'ZA',
    targetCanal: 'cape',
    // Actively rounding the Cape
    startLat: -34.4,
    startLon:  18.5,
    speedKnots: 10.5,
    navStatus: 'underway',
  },
];

// ── In-memory state — vessel positions, updated each tick ────────────────────
// Keyed by IMO number.
const _state = {};

function _initState() {
  for (const vessel of VESSEL_FLEET) {
    _state[vessel.imo] = {
      lat: vessel.startLat,
      lon: vessel.startLon,
      speedKnots: vessel.speedKnots,
      // Add slight speed variation
      baseSpeed: vessel.speedKnots,
    };
  }
}
_initState();

// ── Compute canal distances + ETAs for a position ────────────────────────────
function computeCanalMetrics(lat, lon, speedKnots) {
  const metrics = {};
  for (const [canal, wp] of Object.entries(CANAL_WAYPOINTS)) {
    const dist = distanceNm(lat, lon, wp.lat, wp.lon);
    metrics[`dist_${canal}_nm`] = Math.round(dist * 10) / 10;
    // ETA in hours — null if drifting (speed < 1 kt)
    metrics[`eta_${canal}_h`] =
      speedKnots >= 1
        ? Math.round((dist / speedKnots) * 10) / 10
        : null;
  }
  return metrics;
}

// ── Generate a noise value in range [-range, +range] ─────────────────────────
function jitter(range) {
  return (Math.random() * 2 - 1) * range;
}

/**
 * Advance all vessel positions by `elapsedMinutes` of simulated time.
 * Returns array of position update objects ready for DB insert.
 *
 * @param {number} elapsedMinutes - minutes elapsed since last tick (default 5)
 * @returns {Array<object>}
 */
function generatePositionUpdates(elapsedMinutes = 5) {
  const updates = [];
  const now = new Date();

  for (const vessel of VESSEL_FLEET) {
    const s = _state[vessel.imo];
    const target = CANAL_WAYPOINTS[vessel.targetCanal];

    // Speed varies ±0.5 knots per tick (realistic sea-state variation)
    s.speedKnots = Math.max(
      4,
      Math.min(18, s.baseSpeed + jitter(0.5))
    );

    const distTravelled = (s.speedKnots * elapsedMinutes) / 60;

    // Move toward target canal; once within 20 nm, orbit slowly (vessel anchored/transiting)
    const currentDist = distanceNm(s.lat, s.lon, target.lat, target.lon);

    if (currentDist <= 20) {
      // Simulate slow transiting manoeuvre — drift in small circle
      s.lat += jitter(0.02);
      s.lon += jitter(0.02);
    } else {
      // Great-circle move toward canal
      const { lat: newLat, lon: newLon } = moveToward(
        s.lat, s.lon, target.lat, target.lon, distTravelled
      );
      s.lat = newLat + jitter(0.001); // tiny GPS noise
      s.lon = newLon + jitter(0.001);
    }

    const heading = Math.round(bearingTo(s.lat, s.lon, target.lat, target.lon));
    const canalMetrics = computeCanalMetrics(s.lat, s.lon, s.speedKnots);

    updates.push({
      imo_number: vessel.imo,
      vessel_name: vessel.name,
      mmsi: vessel.mmsi,
      vessel_id: null, // linked later by IMO lookup
      latitude: Math.round(s.lat * 1e6) / 1e6,
      longitude: Math.round(s.lon * 1e6) / 1e6,
      speed_knots: Math.round(s.speedKnots * 10) / 10,
      heading,
      course: heading, // COG ≈ heading for deep-sea vessels
      nav_status: vessel.navStatus,
      source: 'mock',
      timestamp: now,
      ...canalMetrics,
    });
  }

  return updates;
}

/**
 * Get current snapshot of all vessel positions without advancing state.
 * Useful for the initial seed or API requests between ticks.
 */
function getCurrentSnapshot() {
  return generatePositionUpdates(0);
}

/**
 * Get the list of IMO numbers this mock provider tracks.
 */
function getTrackedImos() {
  return VESSEL_FLEET.map((v) => v.imo);
}

/**
 * Get vessel metadata by IMO.
 */
function getVesselMeta(imo) {
  return VESSEL_FLEET.find((v) => v.imo === imo) ?? null;
}

module.exports = {
  generatePositionUpdates,
  getCurrentSnapshot,
  getTrackedImos,
  getVesselMeta,
  computeCanalMetrics,
  CANAL_WAYPOINTS,
  VESSEL_FLEET,
};
