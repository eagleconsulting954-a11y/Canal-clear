/**
 * services/geofence-engine.js — Geofence detection engine.
 * Owns: canal approach detection, threshold crossing logic, alert auto-registration.
 * Does NOT own: vessel position data (AIS layer), DB queries (db/geofence.js), email sending.
 *
 * Called every 5 minutes by startup.js. On each tick:
 *   1. Load geofence zones + thresholds
 *   2. Pull latest vessel positions (from AIS layer's vessel_positions table)
 *   3. For each vessel × zone: compute haversine distance, check thresholds
 *   4. On first crossing: record geofence_event + register deadline alert
 *   5. Detect diversions (heading away after threshold crossed)
 */
'use strict';

const {
  getAllZones,
  hasEventFired,
  hasAnyEventFired,
  recordEvent,
  markDiverted,
  linkAlertId,
  fetchLatestVesselPositions,
  lookupVesselUserId,
  findExistingDeadlineId,
} = require('../db/geofence');

const DEFAULT_SPEED_KT = 14;

const FILING_TYPE_MAP = {
  panama:   'VUMPA Pre-Arrival',
  suez:     'SCA Convoy Booking',
  bosporus: 'SP-1 Pre-Arrival',
  malacca:  'STRAITREP Filing',
  cape:     'ISPS Pre-Arrival (SAMSA)',
};

// Threshold columns ordered from largest ring inward (96h → 6h)
const WINDOW_COLUMNS = [
  { window: '96h', col: 'threshold_96h_nm' },
  { window: '72h', col: 'threshold_72h_nm' },
  { window: '48h', col: 'threshold_48h_nm' },
  { window: '24h', col: 'threshold_24h_nm' },
  { window: '12h', col: 'threshold_12h_nm' },
  { window: '6h',  col: 'threshold_6h_nm'  },
];

/**
 * Haversine distance between two lat/lng coordinates, in nautical miles.
 */
function distanceNm(lat1, lng1, lat2, lng2) {
  const R = 3440.065;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimate ETA in hours given distance (nm) and speed (kt).
 */
function etaHours(distNm, speedKt) {
  return distNm / (speedKt > 0 ? speedKt : DEFAULT_SPEED_KT);
}

/**
 * Return true if the vessel's course is broadly toward the canal center (within ±90°).
 * A vessel without course data is assumed to be approaching.
 */
function isHeadingToward(vesselLat, vesselLng, course, canalLat, canalLng) {
  if (course == null) return true;
  const bearing = ((Math.atan2(canalLng - vesselLng, canalLat - vesselLat) * 180) / Math.PI + 360) % 360;
  const diff = Math.abs(bearing - ((course % 360 + 360) % 360));
  return (diff > 180 ? 360 - diff : diff) <= 90;
}

/**
 * Register a deadline alert via the filing_deadlines DB (same process, no HTTP round-trip).
 * Returns the new deadline id, or null on failure.
 */
async function registerDeadlineAlert(pool, { vessel, waterway, distNm, speedKt, userId }) {
  if (!userId) return null;
  const { upsertDeadline } = require('../db/filing-deadlines');
  const etaHrs = etaHours(distNm, speedKt);
  const deadline = new Date(Date.now() + etaHrs * 3600 * 1000).toISOString();
  try {
    const row = await upsertDeadline(pool, {
      userId,
      waterway,
      filingType:       FILING_TYPE_MAP[waterway] || waterway,
      vesselName:       vessel.vessel_name,
      imoNumber:        vessel.imo_number,
      deadlineAt:       deadline,
      filingId:         null,
      filingUrl:        null,
      complianceIssues: [
        `Auto-detected: ${vessel.vessel_name} ~${Math.round(etaHrs)}h from ${waterway} entry`,
      ],
    });
    return row ? row.id : null;
  } catch (err) {
    console.error(`[Geofence] Deadline registration failed for ${vessel.imo_number} → ${waterway}:`, err.message);
    return null;
  }
}

/**
 * Main detection tick. Runs every 5 minutes.
 */
async function runGeofenceTick(pool) {
  const zones = await getAllZones(pool);
  if (!zones.length) return;

  const vessels = await fetchLatestVesselPositions(pool);
  if (!vessels.length) return;

  let triggered = 0;
  let diverted = 0;

  for (const vessel of vessels) {
    const { imo_number, vessel_name, latitude, longitude, speed_knots, course } = vessel;

    for (const zone of zones) {
      const { waterway, center_lat, center_lng } = zone;
      const dist = distanceNm(latitude, longitude, center_lat, center_lng);

      // Diversion detection: was heading toward canal, now heading away
      if (!isHeadingToward(latitude, longitude, course, center_lat, center_lng)) {
        const anyFired = await hasAnyEventFired(pool, imo_number, waterway);
        if (anyFired) {
          await markDiverted(pool, imo_number, waterway);
          diverted++;
        }
        continue; // don't process thresholds for vessel heading away
      }

      for (const { window, col } of WINDOW_COLUMNS) {
        const thresholdNm = zone[col];
        if (!thresholdNm || dist > thresholdNm) continue;

        if (await hasEventFired(pool, imo_number, waterway, window)) continue;

        // New threshold crossing
        const userId = await lookupVesselUserId(pool, imo_number);

        if (!userId) {
          // Not in fleet — record event without alert for visibility
          console.log(`[Geofence] ${imo_number} (${vessel_name}) entered ${window} zone for ${waterway} — not in fleet`);
          await recordEvent(pool, { vesselId: vessel.vessel_id, imoNumber: imo_number, vesselName: vessel_name, waterway, alertWindow: window, distanceNm: dist, alertId: null });
          triggered++;
          continue;
        }

        // Find or create deadline alert
        let alertId = await findExistingDeadlineId(pool, imo_number, waterway);
        if (!alertId) {
          alertId = await registerDeadlineAlert(pool, { vessel, waterway, distNm: dist, speedKt: speed_knots, userId });
          console.log(`[Geofence] ${imo_number} (${vessel_name}) crossed ${window} for ${waterway} at ${Math.round(dist)}nm — deadline alert ${alertId || 'FAILED'}`);
        } else {
          console.log(`[Geofence] ${imo_number} (${vessel_name}) crossed ${window} for ${waterway} at ${Math.round(dist)}nm — linked existing alert ${alertId}`);
        }

        const event = await recordEvent(pool, { vesselId: vessel.vessel_id, imoNumber: imo_number, vesselName: vessel_name, waterway, alertWindow: window, distanceNm: dist, alertId });
        if (event && alertId) await linkAlertId(pool, imo_number, waterway, window, alertId);
        triggered++;
      }
    }
  }

  if (triggered > 0 || diverted > 0) {
    console.log(`[Geofence] Tick complete — ${triggered} alerts triggered, ${diverted} diversions flagged`);
  }
}

module.exports = { runGeofenceTick, distanceNm, etaHours };
