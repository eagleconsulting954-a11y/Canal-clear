/**
 * services/ais-provider.js — AIS provider orchestrator and polling scheduler.
 *
 * Owns: provider selection, position ingestion loop, IMO-to-vessel linking.
 * Does NOT own: mock data generation (ais-mock-provider.js), SQL (db/ais-positions.js),
 *               route handling, or provider-specific API integration.
 *
 * === Adding a Real Provider ===
 * 1. Create `services/ais-adapters/<provider>.js` implementing the adapter interface:
 *
 *   module.exports = {
 *     name: 'marinetraffic',   // must match ais_provider_config.provider
 *     async fetchPositions(apiKey) {
 *       // Returns Array<PositionObject>:
 *       // { imo_number, vessel_name, mmsi, latitude, longitude,
 *       //   speed_knots, heading, course, nav_status, timestamp }
 *     }
 *   };
 *
 * 2. Register in the ADAPTERS map below.
 * 3. Update ais_provider_config.provider via POST /api/ais/provider/config.
 * No other changes required.
 */

const {
  insertPosition,
  upsertVesselTrack,
  getProviderConfig,
  pruneOldPositions,
  resolveVesselIds,
} = require('../db/ais-positions');
const mockProvider = require('./ais-mock-provider');

// ── Registered adapters ───────────────────────────────────────────────────────
// Add real provider adapters here as they're built.
const ADAPTERS = {
  mock: {
    name: 'mock',
    async fetchPositions(_apiKey, elapsedMinutes) {
      return mockProvider.generatePositionUpdates(elapsedMinutes);
    },
  },
  // Future adapters (uncomment + implement to activate):
  // marinetraffic: require('./ais-adapters/marinetraffic'),
  // vesselfinder:  require('./ais-adapters/vesselfinder'),
  // spire:         require('./ais-adapters/spire'),
};

// ── Polling loop state ────────────────────────────────────────────────────────
let _pool = null;
let _timer = null;
let _lastTickAt = null;
let _tickCount = 0;
let _running = false;

/**
 * Run a single ingestion tick:
 * 1. Fetch positions from active provider
 * 2. Link to existing vessels table by IMO
 * 3. Persist each position + upsert track summary
 * 4. Prune positions older than 72h
 */
async function _tick() {
  if (!_pool || _running) return;
  _running = true;

  try {
    const config = await getProviderConfig(_pool);
    if (!config || !config.enabled) {
      _running = false;
      return;
    }

    const adapter = ADAPTERS[config.provider];
    if (!adapter) {
      console.error(`[AIS] Unknown provider: ${config.provider}`);
      _running = false;
      return;
    }

    // Elapsed minutes since last tick (for simulation accuracy)
    const elapsedMinutes = _lastTickAt
      ? (Date.now() - _lastTickAt) / 60000
      : 5;
    _lastTickAt = Date.now();

    const positions = await adapter.fetchPositions(config.api_key, elapsedMinutes);

    // Resolve vessel_ids from vessels table by IMO (batch lookup via db layer)
    const imoList = [...new Set(positions.map((p) => p.imo_number))];
    const imoToVesselId = await resolveVesselIds(_pool, imoList);

    // Persist each position and upsert track summary
    let saved = 0;
    for (const pos of positions) {
      pos.vessel_id = imoToVesselId[pos.imo_number] ?? null;
      await insertPosition(_pool, pos);
      await upsertVesselTrack(_pool, pos);
      saved++;
    }

    // Prune positions older than 72h (keep table lean)
    const pruned = await pruneOldPositions(_pool, 72);

    _tickCount++;
    console.log(
      `[AIS] Tick #${_tickCount}: saved ${saved} positions, pruned ${pruned} old records (provider: ${config.provider})`
    );
  } catch (err) {
    console.error('[AIS] Tick error:', err.message);
  } finally {
    _running = false;
  }
}

/**
 * Start the AIS polling scheduler.
 * @param {object} pool - pg Pool instance
 * @param {number} [overridePollSec] - override poll_interval_sec from DB config
 */
async function startAisScheduler(pool, overridePollSec) {
  _pool = pool;

  // Run an immediate tick on startup to populate the tables
  await _tick();

  // Schedule recurring ticks — re-read interval from DB on each reschedule
  // so admin changes to poll_interval_sec take effect without restart.
  async function scheduleNext() {
    const config = await getProviderConfig(pool).catch(() => null);
    const intervalSec = overridePollSec ?? config?.poll_interval_sec ?? 300;

    _timer = setTimeout(async () => {
      await _tick();
      scheduleNext();
    }, intervalSec * 1000);
  }

  await scheduleNext();
  console.log('[AIS] Polling scheduler started');
}

/**
 * Stop the polling scheduler. Primarily for clean shutdown in tests.
 */
function stopAisScheduler() {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
  console.log('[AIS] Polling scheduler stopped');
}

/**
 * Force an immediate tick outside the normal schedule.
 * Used by the admin endpoint to manually trigger a refresh.
 */
async function forceTick() {
  return _tick();
}

module.exports = {
  startAisScheduler,
  stopAisScheduler,
  forceTick,
  ADAPTERS, // exported for admin introspection
};
