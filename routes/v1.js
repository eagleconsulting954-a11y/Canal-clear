/**
 * routes/v1.js — Public TMS integration API (v1).
 *
 * Owns: POST/GET /api/v1/vessels, POST /api/v1/voyages, POST /api/v1/crew,
 *       GET /api/v1/voyages, POST /api/v1/webhook.
 * Does NOT own: API key management (routes/v1-keys.js), user auth (middleware/auth.js).
 *
 * All endpoints require Bearer API key auth (middleware/apiKeyAuth.js).
 */

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');

const { requireApiKey }           = require('../middleware/apiKeyAuth');
const { validateVesselPayload, validateVoyagePayload, validateCrewPayload, applyFieldMapping } = require('../services/inbound-validator');
const { upsertInboundVessel, getInboundVessel, upsertInboundVoyage, listInboundVoyages, insertCrewMembers } = require('../db/inbound-data');
const { logWebhook, updateWebhookLog, listWebhookMappings } = require('../db/webhook-logs');

// All v1 endpoints require a valid API key
router.use(requireApiKey);

// ── Vessels ──────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/vessels
 * Create or update vessel particulars by IMO number.
 *
 * Body:
 *   imo          string  REQUIRED — 7-digit IMO number
 *   vessel_name  string
 *   flag         string  — ISO 3166-1 alpha-2 flag state (e.g. "PA", "LR", "MH")
 *   gross_tonnage  number
 *   net_tonnage    number
 *   loa            number — length overall in metres
 *   beam           number — beam in metres
 *   draft          number — maximum draft in metres
 *   vessel_class   string — classification society class notation
 *   vessel_type    string — e.g. "bulk_carrier", "tanker", "container"
 *   call_sign      string
 *   mmsi           string — 9-digit MMSI
 */
router.post('/vessels', async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  const { valid, errors } = validateVesselPayload(req.body);
  if (!valid) {
    return res.status(422).json({
      success: false,
      error: 'validation_failed',
      message: 'Payload failed validation',
      errors,
    });
  }

  try {
    const vessel = await upsertInboundVessel(pool, userId, {
      imo_number:    req.body.imo,
      vessel_name:   req.body.vessel_name,
      flag:          req.body.flag,
      gross_tonnage: req.body.gross_tonnage,
      net_tonnage:   req.body.net_tonnage,
      loa:           req.body.loa,
      beam:          req.body.beam,
      draft:         req.body.draft,
      vessel_class:  req.body.vessel_class,
      vessel_type:   req.body.vessel_type,
      call_sign:     req.body.call_sign,
      mmsi:          req.body.mmsi,
    }, 'api');

    return res.status(200).json({ success: true, vessel });
  } catch (err) {
    console.error('[v1/vessels POST]', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Failed to store vessel' });
  }
});

/**
 * GET /api/v1/vessels/:imo
 * Retrieve vessel data by IMO number.
 */
router.get('/vessels/:imo', async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  try {
    const vessel = await getInboundVessel(pool, userId, req.params.imo);
    if (!vessel) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Vessel IMO ${req.params.imo} not found for this API key`,
      });
    }
    return res.json({ success: true, vessel });
  } catch (err) {
    console.error('[v1/vessels GET]', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Lookup failed' });
  }
});

// ── Voyages ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/voyages
 * Create or update voyage data.
 *
 * Body:
 *   vessel_imo   string  REQUIRED — 7-digit IMO
 *   voyage_ref   string  — TMS voyage number (used as upsert key)
 *   origin       string  — departure port (UN/LOCODE or name)
 *   destination  string  — arrival port
 *   eta          string  — ISO 8601 datetime
 *   etd          string  — ISO 8601 datetime
 *   cargo_type   string  — e.g. "bulk", "crude_oil", "containers"
 *   cargo_quantity  number — in metric tons
 *   waterway     string  — one of: panama, suez, bosporus, malacca, cape
 */
router.post('/voyages', async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  const { valid, errors } = validateVoyagePayload(req.body);
  if (!valid) {
    return res.status(422).json({ success: false, error: 'validation_failed', message: 'Payload failed validation', errors });
  }

  try {
    const voyage = await upsertInboundVoyage(pool, userId, req.body, 'api');
    return res.status(200).json({ success: true, voyage });
  } catch (err) {
    console.error('[v1/voyages POST]', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Failed to store voyage' });
  }
});

/**
 * GET /api/v1/voyages
 * List voyages. Optional filters: ?vessel_imo=&limit=&offset=
 */
router.get('/voyages', async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;
  const { vessel_imo, limit = 50, offset = 0 } = req.query;

  try {
    const voyages = await listInboundVoyages(pool, userId, {
      vessel_imo: vessel_imo || null,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
      offset: parseInt(offset, 10) || 0,
    });
    return res.json({ success: true, count: voyages.length, voyages });
  } catch (err) {
    console.error('[v1/voyages GET]', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Lookup failed' });
  }
});

// ── Crew ─────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/crew
 * Create or update crew manifest for a vessel.
 *
 * Body:
 *   vessel_imo  string   REQUIRED
 *   voyage_ref  string   — associate with a voyage
 *   crew        object[] REQUIRED — array of:
 *     full_name    string  REQUIRED
 *     nationality  string  — ISO 3166-1 alpha-2
 *     rank         string  — e.g. "Master", "Chief Officer"
 *     cert_number  string  — STCW certificate number
 *     cert_type    string  — e.g. "STCW", "GMDSS"
 *     cert_expiry  string  — YYYY-MM-DD
 */
router.post('/crew', async (req, res) => {
  const pool = req.app.locals.pool;
  const userId = req.user.id;

  const { valid, errors } = validateCrewPayload(req.body);
  if (!valid) {
    return res.status(422).json({ success: false, error: 'validation_failed', message: 'Payload failed validation', errors });
  }

  try {
    const count = await insertCrewMembers(
      pool, userId, req.body.vessel_imo, req.body.voyage_ref || null, req.body.crew, 'api'
    );
    return res.status(200).json({ success: true, crew_members_stored: count });
  } catch (err) {
    console.error('[v1/crew POST]', err.message);
    return res.status(500).json({ success: false, error: 'server_error', message: 'Failed to store crew' });
  }
});

// ── Webhook receiver ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/webhook
 * Generic webhook receiver. Accepts any JSON payload.
 * Optional query: ?source=veson&mapping_id=1
 *
 * Flow:
 *  1. Log raw payload
 *  2. Apply field mapping template if mapping_id provided
 *  3. Attempt to ingest as vessel/voyage/crew based on mapped fields
 *  4. Return delivery ID for debugging
 */
router.post('/webhook', async (req, res) => {
  const pool   = req.app.locals.pool;
  const userId = req.user.id;
  const source = req.query.source || req.body._source || 'unknown';
  const mappingId = req.query.mapping_id ? parseInt(req.query.mapping_id, 10) : null;

  // Mask full headers for log (avoid leaking auth)
  const safeHeaders = { ...req.headers };
  delete safeHeaders.authorization;

  // Log the raw delivery first
  let logRow;
  try {
    logRow = await logWebhook(pool, {
      user_id:    userId,
      api_key_id: req.apiKey ? req.apiKey.id : null,
      source_name: source,
      method:     req.method,
      headers:    safeHeaders,
      payload:    req.body,
      status:     'received',
    });
  } catch (err) {
    console.error('[v1/webhook] log error:', err.message);
    // Don't block the response — still return an ID
    return res.status(202).json({
      success: true,
      delivery_id: crypto.randomUUID(),
      status: 'received',
      note: 'Logging failed — payload not persisted',
    });
  }

  // Apply mapping template if requested
  let mapped = req.body;
  let resolvedMappingId = null;
  try {
    if (mappingId) {
      const mappings = await listWebhookMappings(pool, userId);
      const template = mappings.find(m => m.id === mappingId && m.is_active);
      if (template) {
        mapped = applyFieldMapping(req.body, template.mapping);
        resolvedMappingId = template.id;
      }
    }
  } catch (err) {
    console.error('[v1/webhook] mapping error:', err.message);
  }

  // Auto-ingest: vessel if imo present, voyage if vessel_imo + origin/destination
  const ingestedEntities = {};
  let ingestStatus = 'mapped';

  try {
    // Vessel
    const imoCandidate = mapped.imo || mapped.vessel_imo;
    if (imoCandidate) {
      const { validateVesselPayload: vv } = require('../services/inbound-validator');
      const vResult = vv({ ...mapped, imo: imoCandidate });
      if (vResult.valid) {
        const vessel = await upsertInboundVessel(pool, userId, {
          imo_number:   imoCandidate,
          vessel_name:  mapped.vessel_name,
          flag:         mapped.flag,
          gross_tonnage: mapped.gross_tonnage,
          net_tonnage:   mapped.net_tonnage,
          loa:           mapped.loa,
          beam:          mapped.beam,
          draft:         mapped.draft,
          vessel_class:  mapped.vessel_class,
          vessel_type:   mapped.vessel_type,
          call_sign:     mapped.call_sign,
          mmsi:          mapped.mmsi,
        }, 'webhook', String(logRow.id));
        ingestedEntities.vessel = vessel.imo_number;
      }
    }

    // Voyage
    if (mapped.vessel_imo && (mapped.origin || mapped.destination || mapped.eta)) {
      const vResult = validateVoyagePayload(mapped);
      if (vResult.valid) {
        const voyage = await upsertInboundVoyage(pool, userId, mapped, 'webhook', String(logRow.id));
        ingestedEntities.voyage = voyage.id;
      }
    }

    ingestStatus = 'ingested';
  } catch (err) {
    ingestStatus = 'error';
    await updateWebhookLog(pool, logRow.id, {
      status: 'error',
      mapped_entities: ingestedEntities,
      mapping_id: resolvedMappingId,
      error_detail: err.message,
    }).catch(() => {});

    return res.status(202).json({
      success: true,
      delivery_id: logRow.id,
      status: 'error',
      message: 'Payload received but ingestion failed: ' + err.message,
    });
  }

  // Update log with final status
  await updateWebhookLog(pool, logRow.id, {
    status: ingestStatus,
    mapped_entities: ingestedEntities,
    mapping_id: resolvedMappingId,
  }).catch(() => {});

  return res.status(202).json({
    success: true,
    delivery_id: logRow.id,
    status: ingestStatus,
    ingested: ingestedEntities,
  });
});

module.exports = router;
