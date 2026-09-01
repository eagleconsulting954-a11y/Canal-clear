const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

function db(req) { return req.app.locals.pool; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function getPath(obj, path) {
  return String(path || '').split('.').filter(Boolean).reduce((acc, key) => acc == null ? undefined : acc[key], obj);
}
function ruleApplies(predicate, ctx) {
  if (!predicate || Object.keys(predicate).length === 0) return true;
  if (predicate.all) return asArray(predicate.all).every(p => ruleApplies(p, ctx));
  if (predicate.any) return asArray(predicate.any).some(p => ruleApplies(p, ctx));
  if (predicate.not) return !ruleApplies(predicate.not, ctx);
  const actual = getPath(ctx, predicate.field);
  if ('equals' in predicate) return String(actual ?? '').toLowerCase() === String(predicate.equals ?? '').toLowerCase();
  if ('in' in predicate) return asArray(predicate.in).map(v => String(v).toLowerCase()).includes(String(actual ?? '').toLowerCase());
  if ('exists' in predicate) return predicate.exists ? actual !== undefined && actual !== null && actual !== '' : actual === undefined || actual === null || actual === '';
  if ('gte' in predicate) return Number(actual) >= Number(predicate.gte);
  if ('lte' in predicate) return Number(actual) <= Number(predicate.lte);
  return true;
}
function readinessState(score, critical) {
  if (critical > 0) return 'critical_exception';
  if (score >= 95) return 'ready';
  if (score >= 70) return 'review_required';
  return 'insufficient_evidence';
}

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const p = db(req);
    const [voyages, docs, reviews, changes, partners] = await Promise.all([
      p.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE readiness_state='ready')::int ready,
        COUNT(*) FILTER (WHERE readiness_state='critical_exception')::int critical,
        COALESCE(ROUND(AVG(readiness_score)),0)::int avg_score
        FROM compliance_voyages WHERE user_id=$1`, [userId]),
      p.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at < NOW() + INTERVAL '30 days')::int expiring
        FROM compliance_documents WHERE user_id=$1 AND status='active'`, [userId]),
      p.query(`SELECT COUNT(*)::int open FROM compliance_review_queue WHERE user_id=$1 AND status='open'`, [userId]),
      p.query(`SELECT COUNT(*)::int pending FROM regulatory_changes WHERE review_state='pending'`),
      p.query(`SELECT authority_code, authority_name, stage, next_action, next_action_at FROM authority_partnerships ORDER BY authority_code`)
    ]);
    res.json({ success: true, voyages: voyages.rows[0], documents: docs.rows[0], reviews: reviews.rows[0], regulatory_changes: changes.rows[0], partnerships: partners.rows });
  } catch (err) {
    console.error('[compliance-infrastructure] summary:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/passport/:vesselId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const vesselId = Number(req.params.vesselId);
  try {
    const p = db(req);
    const vessel = await p.query(`SELECT * FROM vessels WHERE id=$1 AND user_id=$2 AND status!='deleted'`, [vesselId, userId]);
    if (!vessel.rows[0]) return res.status(404).json({ success: false, message: 'Vessel not found' });
    const [profile, documents, outcomes] = await Promise.all([
      p.query(`SELECT * FROM compliance_vessel_profiles WHERE user_id=$1 AND vessel_id=$2`, [userId, vesselId]),
      p.query(`SELECT * FROM compliance_documents WHERE user_id=$1 AND vessel_id=$2 AND status!='deleted' ORDER BY expires_at NULLS LAST, created_at DESC`, [userId, vesselId]),
      p.query(`SELECT * FROM compliance_outcomes WHERE user_id=$1 AND vessel_id=$2 ORDER BY occurred_at DESC LIMIT 25`, [userId, vesselId])
    ]);
    res.json({ success: true, vessel: vessel.rows[0], profile: profile.rows[0] || null, documents: documents.rows, outcomes: outcomes.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/passport/:vesselId', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const vesselId = Number(req.params.vesselId);
  const { identity = {}, particulars = {}, ownership = {}, operational = {}, authority_identifiers = {}, verified_fields = {} } = req.body || {};
  try {
    const p = db(req);
    const vessel = await p.query(`SELECT imo FROM vessels WHERE id=$1 AND user_id=$2 AND status!='deleted'`, [vesselId, userId]);
    if (!vessel.rows[0]) return res.status(404).json({ success: false, message: 'Vessel not found' });
    const result = await p.query(`
      INSERT INTO compliance_vessel_profiles(user_id,vessel_id,imo,identity,particulars,ownership,operational,authority_identifiers,verified_fields,verification_state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(user_id,vessel_id) DO UPDATE SET
        imo=EXCLUDED.imo,
        identity=compliance_vessel_profiles.identity || EXCLUDED.identity,
        particulars=compliance_vessel_profiles.particulars || EXCLUDED.particulars,
        ownership=compliance_vessel_profiles.ownership || EXCLUDED.ownership,
        operational=compliance_vessel_profiles.operational || EXCLUDED.operational,
        authority_identifiers=compliance_vessel_profiles.authority_identifiers || EXCLUDED.authority_identifiers,
        verified_fields=compliance_vessel_profiles.verified_fields || EXCLUDED.verified_fields,
        profile_version=compliance_vessel_profiles.profile_version + 1,
        verification_state=EXCLUDED.verification_state,
        updated_at=NOW()
      RETURNING *`, [userId, vesselId, vessel.rows[0].imo, identity, particulars, ownership, operational, authority_identifiers, verified_fields, Object.keys(verified_fields).length ? 'partially_verified' : 'unverified']);
    res.json({ success: true, profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/voyages', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { vessel_id, voyage_ref, origin, destination, eta, etd, cargo = {}, route = [], context = {} } = req.body || {};
  if (!vessel_id) return res.status(400).json({ success: false, message: 'vessel_id is required' });
  try {
    const vessel = await db(req).query(`SELECT id FROM vessels WHERE id=$1 AND user_id=$2 AND status!='deleted'`, [Number(vessel_id), userId]);
    if (!vessel.rows[0]) return res.status(404).json({ success: false, message: 'Vessel not found' });
    const result = await db(req).query(`INSERT INTO compliance_voyages(user_id,vessel_id,voyage_ref,origin,destination,eta,etd,cargo,route,context)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [userId, Number(vessel_id), voyage_ref || null, origin || null, destination || null, eta || null, etd || null, cargo, route, context]);
    res.json({ success: true, voyage: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/voyages', requireAuth, async (req, res) => {
  try {
    const result = await db(req).query(`SELECT cv.*, v.name vessel_name, v.imo FROM compliance_voyages cv LEFT JOIN vessels v ON v.id=cv.vessel_id WHERE cv.user_id=$1 ORDER BY cv.eta NULLS LAST, cv.created_at DESC LIMIT 200`, [req.user.id]);
    res.json({ success: true, voyages: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/voyages/:id/compile', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const voyageId = Number(req.params.id);
  const p = db(req);
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const voyageQ = await client.query(`SELECT cv.*, v.name vessel_name, v.imo, v.flag, v.type, v.gt, v.nt, v.loa, v.beam, v.max_draft, v.class_society FROM compliance_voyages cv JOIN vessels v ON v.id=cv.vessel_id WHERE cv.id=$1 AND cv.user_id=$2`, [voyageId, userId]);
    if (!voyageQ.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Voyage not found' }); }
    const voyage = voyageQ.rows[0];
    const profileQ = await client.query(`SELECT * FROM compliance_vessel_profiles WHERE user_id=$1 AND vessel_id=$2`, [userId, voyage.vessel_id]);
    const docsQ = await client.query(`SELECT * FROM compliance_documents WHERE user_id=$1 AND vessel_id=$2 AND status='active'`, [userId, voyage.vessel_id]);
    const route = asArray(voyage.route).map(x => String(typeof x === 'string' ? x : (x.waterway || x.code || '')).toLowerCase()).filter(Boolean);
    const rulesQ = await client.query(`SELECT rr.*, rs.title source_title, rs.source_url, rs.version_label source_version FROM regulatory_rules rr LEFT JOIN regulatory_sources rs ON rs.id=rr.source_id WHERE rr.active=true AND ($1::text[] IS NULL OR LOWER(rr.waterway)=ANY($1::text[])) AND (rr.effective_from IS NULL OR rr.effective_from<=COALESCE($2::timestamptz,NOW())) AND (rr.effective_to IS NULL OR rr.effective_to>COALESCE($2::timestamptz,NOW())) ORDER BY rr.authority_code, rr.rule_key`, [route.length ? route : null, voyage.eta]);
    const profile = profileQ.rows[0] || {};
    const ctx = { vessel: { name: voyage.vessel_name, imo: voyage.imo, flag: voyage.flag, type: voyage.type, gt: voyage.gt, nt: voyage.nt, loa: voyage.loa, beam: voyage.beam, max_draft: voyage.max_draft, class_society: voyage.class_society, ...(profile.particulars || {}), ...(profile.operational || {}) }, voyage, cargo: voyage.cargo || {}, profile };
    const documents = docsQ.rows;
    const applicable = rulesQ.rows.filter(r => ruleApplies(r.predicate, ctx));
    await client.query(`DELETE FROM voyage_requirements WHERE voyage_id=$1`, [voyageId]);
    let resolved = 0, critical = 0;
    const compiled = [];
    for (const rule of applicable) {
      const reqFields = asArray(rule.required_fields);
      const reqDocs = asArray(rule.required_document_types);
      const missingFields = reqFields.filter(f => { const v = getPath(ctx, f); return v === undefined || v === null || v === ''; });
      const availableDocTypes = new Set(documents.filter(d => !d.expires_at || new Date(d.expires_at) > new Date()).map(d => String(d.document_type).toLowerCase()));
      const missingDocs = reqDocs.filter(d => !availableDocTypes.has(String(d).toLowerCase()));
      const status = missingFields.length || missingDocs.length ? 'unresolved' : 'satisfied';
      if (status === 'satisfied') resolved++; else if (rule.severity === 'critical') critical++;
      const provenance = { source_id: rule.source_id, source_title: rule.source_title, source_url: rule.source_url, source_version: rule.source_version, rule_version: rule.version, interpretation_state: rule.interpretation_state };
      const inserted = await client.query(`INSERT INTO voyage_requirements(voyage_id,rule_id,authority_code,waterway,requirement_key,title,status,severity,missing_fields,missing_documents,source_provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [voyageId, rule.id, rule.authority_code, rule.waterway, rule.rule_key, rule.title, status, rule.severity, JSON.stringify(missingFields), JSON.stringify(missingDocs), provenance]);
      compiled.push(inserted.rows[0]);
    }
    const score = applicable.length ? Math.round((resolved / applicable.length) * 100) : 0;
    const state = readinessState(score, critical);
    await client.query(`UPDATE compliance_voyages SET readiness_score=$1, readiness_state=$2, compiled_at=NOW(), updated_at=NOW() WHERE id=$3`, [score, state, voyageId]);
    const hash = crypto.createHash('sha256').update(JSON.stringify({ voyageId, ctx, rules: applicable.map(r => [r.id, r.version]) })).digest('hex');
    await client.query(`INSERT INTO compliance_evidence_ledger(user_id,vessel_id,voyage_id,event_type,actor_type,input_hash,result,evidence_refs) VALUES($1,$2,$3,'voyage.compiled','system',$4,$5,$6)`, [userId, voyage.vessel_id, voyageId, hash, { score, state, applicable_rules: applicable.length, satisfied: resolved, critical }, documents.map(d => d.id)]);
    if (state === 'critical_exception') await client.query(`INSERT INTO compliance_review_queue(user_id,entity_type,entity_id,reason,risk_level,context) VALUES($1,'voyage',$2,'critical_compliance_exception','high',$3)`, [userId, voyageId, { score, critical }]);
    await client.query('COMMIT');
    res.json({ success: true, readiness: { score, state, applicable_rules: applicable.length, satisfied: resolved, critical }, requirements: compiled });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[compliance-infrastructure] compile:', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/voyages/:id/requirements', requireAuth, async (req, res) => {
  try {
    const ownership = await db(req).query(`SELECT id FROM compliance_voyages WHERE id=$1 AND user_id=$2`, [Number(req.params.id), req.user.id]);
    if (!ownership.rows[0]) return res.status(404).json({ success: false, message: 'Voyage not found' });
    const result = await db(req).query(`SELECT * FROM voyage_requirements WHERE voyage_id=$1 ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'required' THEN 1 ELSE 2 END, authority_code, title`, [Number(req.params.id)]);
    res.json({ success: true, requirements: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/rules', requireAuth, async (req, res) => {
  try {
    const { authority, waterway, active = 'true' } = req.query;
    const params = [];
    const where = [];
    if (authority) { params.push(String(authority)); where.push(`rr.authority_code=$${params.length}`); }
    if (waterway) { params.push(String(waterway)); where.push(`LOWER(rr.waterway)=LOWER($${params.length})`); }
    if (active !== 'all') { params.push(active === 'true'); where.push(`rr.active=$${params.length}`); }
    const q = await db(req).query(`SELECT rr.*, rs.title source_title, rs.source_url, rs.version_label source_version, rs.last_verified_at FROM regulatory_rules rr LEFT JOIN regulatory_sources rs ON rs.id=rr.source_id ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY rr.authority_code, rr.waterway, rr.rule_key, rr.version DESC LIMIT 500`, params);
    res.json({ success: true, rules: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/changes', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT rc.*, rs.title source_title, rs.source_url FROM regulatory_changes rc LEFT JOIN regulatory_sources rs ON rs.id=rc.source_id ORDER BY rc.detected_at DESC LIMIT 200`);
    res.json({ success: true, changes: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/adapters', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT authority_code, waterway, adapter_key, display_name, submission_mode, status, capabilities, updated_at FROM authority_adapters ORDER BY authority_code`);
    res.json({ success: true, adapters: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/partnerships', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT * FROM authority_partnerships ORDER BY authority_code`);
    res.json({ success: true, partnerships: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;