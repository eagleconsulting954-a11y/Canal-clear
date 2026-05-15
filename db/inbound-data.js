/**
 * db/inbound-data.js — SQL query functions for inbound TMS data.
 *
 * Owns: CRUD for inbound_vessels, inbound_voyages, inbound_crews.
 * Does NOT own: validation logic (services/inbound-validator.js), pool construction.
 *
 * Upsert on (user_id, imo_number) for vessels — last write wins, source tracked.
 */

/**
 * Upsert a vessel record. Returns the stored row.
 */
async function upsertInboundVessel(pool, userId, fields, source = 'api', sourceRef = null) {
  const {
    imo_number, vessel_name, flag, gross_tonnage, net_tonnage,
    loa, beam, draft, vessel_class, vessel_type, call_sign, mmsi,
  } = fields;

  const result = await pool.query(`
    INSERT INTO inbound_vessels (
      user_id, imo_number, vessel_name, flag, gross_tonnage, net_tonnage,
      loa, beam, draft, vessel_class, vessel_type, call_sign, mmsi,
      source, source_ref, raw_payload, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
    ON CONFLICT (user_id, imo_number) DO UPDATE SET
      vessel_name   = COALESCE(EXCLUDED.vessel_name, inbound_vessels.vessel_name),
      flag          = COALESCE(EXCLUDED.flag, inbound_vessels.flag),
      gross_tonnage = COALESCE(EXCLUDED.gross_tonnage, inbound_vessels.gross_tonnage),
      net_tonnage   = COALESCE(EXCLUDED.net_tonnage, inbound_vessels.net_tonnage),
      loa           = COALESCE(EXCLUDED.loa, inbound_vessels.loa),
      beam          = COALESCE(EXCLUDED.beam, inbound_vessels.beam),
      draft         = COALESCE(EXCLUDED.draft, inbound_vessels.draft),
      vessel_class  = COALESCE(EXCLUDED.vessel_class, inbound_vessels.vessel_class),
      vessel_type   = COALESCE(EXCLUDED.vessel_type, inbound_vessels.vessel_type),
      call_sign     = COALESCE(EXCLUDED.call_sign, inbound_vessels.call_sign),
      mmsi          = COALESCE(EXCLUDED.mmsi, inbound_vessels.mmsi),
      source        = EXCLUDED.source,
      source_ref    = EXCLUDED.source_ref,
      raw_payload   = EXCLUDED.raw_payload,
      updated_at    = NOW()
    RETURNING *
  `, [
    userId, imo_number, vessel_name || null, flag || null,
    gross_tonnage || null, net_tonnage || null,
    loa || null, beam || null, draft || null,
    vessel_class || null, vessel_type || null, call_sign || null, mmsi || null,
    source, sourceRef || null, JSON.stringify(fields),
  ]);
  return result.rows[0];
}

/**
 * Get a vessel by IMO for a user.
 */
async function getInboundVessel(pool, userId, imoNumber) {
  const result = await pool.query(`
    SELECT * FROM inbound_vessels
    WHERE user_id = $1 AND imo_number = $2
  `, [userId, imoNumber]);
  return result.rows[0] || null;
}

/**
 * Insert or update a voyage. Uses (user_id, vessel_imo, voyage_ref) as dedup key when voyage_ref provided.
 */
async function upsertInboundVoyage(pool, userId, fields, source = 'api', sourceRef = null) {
  const {
    vessel_imo, voyage_ref, origin, destination,
    eta, etd, cargo_type, cargo_quantity, waterway,
  } = fields;

  // If voyage_ref supplied, upsert; otherwise always insert
  if (voyage_ref) {
    const result = await pool.query(`
      INSERT INTO inbound_voyages (
        user_id, vessel_imo, voyage_ref, origin, destination,
        eta, etd, cargo_type, cargo_quantity, waterway,
        source, source_ref, raw_payload, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
      ON CONFLICT (user_id, vessel_imo, voyage_ref) DO UPDATE SET
        origin        = COALESCE(EXCLUDED.origin, inbound_voyages.origin),
        destination   = COALESCE(EXCLUDED.destination, inbound_voyages.destination),
        eta           = COALESCE(EXCLUDED.eta, inbound_voyages.eta),
        etd           = COALESCE(EXCLUDED.etd, inbound_voyages.etd),
        cargo_type    = COALESCE(EXCLUDED.cargo_type, inbound_voyages.cargo_type),
        cargo_quantity= COALESCE(EXCLUDED.cargo_quantity, inbound_voyages.cargo_quantity),
        waterway      = COALESCE(EXCLUDED.waterway, inbound_voyages.waterway),
        source        = EXCLUDED.source,
        source_ref    = EXCLUDED.source_ref,
        raw_payload   = EXCLUDED.raw_payload,
        updated_at    = NOW()
      RETURNING *
    `, [
      userId, vessel_imo, voyage_ref, origin || null, destination || null,
      eta || null, etd || null, cargo_type || null, cargo_quantity || null, waterway || null,
      source, sourceRef || null, JSON.stringify(fields),
    ]);
    return result.rows[0];
  }

  // No voyage_ref — plain insert
  const result = await pool.query(`
    INSERT INTO inbound_voyages (
      user_id, vessel_imo, voyage_ref, origin, destination,
      eta, etd, cargo_type, cargo_quantity, waterway,
      source, source_ref, raw_payload, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
    RETURNING *
  `, [
    userId, vessel_imo, null, origin || null, destination || null,
    eta || null, etd || null, cargo_type || null, cargo_quantity || null, waterway || null,
    source, sourceRef || null, JSON.stringify(fields),
  ]);
  return result.rows[0];
}

/**
 * List voyages for a user (with optional vessel_imo filter).
 */
async function listInboundVoyages(pool, userId, { vessel_imo, limit = 50, offset = 0 } = {}) {
  const params = [userId, limit, offset];
  let filter = '';
  if (vessel_imo) {
    params.push(vessel_imo);
    filter = `AND vessel_imo = $${params.length}`;
  }
  const result = await pool.query(`
    SELECT * FROM inbound_voyages
    WHERE user_id = $1 ${filter}
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, params);
  return result.rows;
}

/**
 * Bulk insert crew members for a vessel/voyage. Returns count inserted.
 */
async function insertCrewMembers(pool, userId, vesselImo, voyageRef, members, source = 'api', sourceRef = null) {
  if (!members || members.length === 0) return 0;
  let inserted = 0;
  for (const m of members) {
    await pool.query(`
      INSERT INTO inbound_crews (
        user_id, vessel_imo, voyage_ref, full_name, nationality,
        rank, cert_number, cert_type, cert_expiry,
        source, source_ref, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
    `, [
      userId, vesselImo, voyageRef || null,
      m.full_name || m.name || 'Unknown',
      m.nationality || null,
      m.rank || null,
      m.cert_number || null,
      m.cert_type || null,
      m.cert_expiry || null,
      source, sourceRef || null,
    ]);
    inserted++;
  }
  return inserted;
}

/**
 * List recent inbound activity (all entity types combined) for the activity feed.
 */
async function listRecentActivity(pool, userId, limit = 50) {
  const result = await pool.query(`
    SELECT 'vessel' AS entity_type, id, imo_number AS ref, vessel_name AS name,
           source, created_at AS occurred_at, updated_at
    FROM inbound_vessels WHERE user_id = $1
    UNION ALL
    SELECT 'voyage' AS entity_type, id, vessel_imo AS ref, COALESCE(voyage_ref, destination) AS name,
           source, created_at AS occurred_at, updated_at
    FROM inbound_voyages WHERE user_id = $1
    UNION ALL
    SELECT 'crew' AS entity_type, id, vessel_imo AS ref, full_name AS name,
           source, created_at AS occurred_at, updated_at
    FROM inbound_crews WHERE user_id = $1
    ORDER BY occurred_at DESC
    LIMIT $2
  `, [userId, limit]);
  return result.rows;
}

module.exports = {
  upsertInboundVessel,
  getInboundVessel,
  upsertInboundVoyage,
  listInboundVoyages,
  insertCrewMembers,
  listRecentActivity,
};
