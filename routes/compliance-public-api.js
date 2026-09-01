const express = require('express');
const router = express.Router();
const { requireComplianceApiKey } = require('../middleware/compliance-api-auth');

router.get('/v1/vessels/:id/passport', requireComplianceApiKey('passport:read'), async (req, res) => {
  try {
    const p = req.app.locals.pool;
    const userId = req.complianceApi.userId;
    const vesselId = Number(req.params.id);
    const vesselQ = await p.query(`SELECT id,name,imo,flag,type,gt,nt,loa,beam,max_draft,class_society FROM vessels WHERE id=$1 AND user_id=$2 AND status!='deleted'`, [vesselId, userId]);
    if (!vesselQ.rows[0]) return res.status(404).json({ success: false, message: 'Vessel not found' });
    const [profileQ, docsQ] = await Promise.all([
      p.query(`SELECT imo,profile_version,identity,particulars,ownership,operational,authority_identifiers,verification_state,verified_fields,updated_at FROM compliance_vessel_profiles WHERE user_id=$1 AND vessel_id=$2`, [userId, vesselId]),
      p.query(`SELECT id,document_type,document_name,issued_at,expires_at,issuer,review_state,source_hash FROM compliance_documents WHERE user_id=$1 AND vessel_id=$2 AND status='active' ORDER BY expires_at NULLS LAST`, [userId, vesselId])
    ]);
    res.json({ success: true, vessel: vesselQ.rows[0], passport: profileQ.rows[0] || null, documents: docsQ.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/v1/voyages/:id/readiness', requireComplianceApiKey('voyage:read'), async (req, res) => {
  try {
    const p = req.app.locals.pool;
    const userId = req.complianceApi.userId;
    const voyageId = Number(req.params.id);
    const voyageQ = await p.query(`SELECT cv.id,cv.voyage_ref,cv.vessel_id,cv.origin,cv.destination,cv.eta,cv.etd,cv.route,cv.readiness_score,cv.readiness_state,cv.compiled_at,v.name vessel_name,v.imo FROM compliance_voyages cv JOIN vessels v ON v.id=cv.vessel_id WHERE cv.id=$1 AND cv.user_id=$2`, [voyageId, userId]);
    if (!voyageQ.rows[0]) return res.status(404).json({ success: false, message: 'Voyage not found' });
    const reqQ = await p.query(`SELECT authority_code,waterway,requirement_key,title,status,severity,missing_fields,missing_documents,source_provenance,due_at FROM voyage_requirements WHERE voyage_id=$1 ORDER BY authority_code,severity,title`, [voyageId]);
    res.json({ success: true, voyage: voyageQ.rows[0], requirements: reqQ.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/v1/regulations/changes', requireComplianceApiKey('regulations:read'), async (req, res) => {
  try {
    const { authority, waterway, since } = req.query;
    const params = [];
    const where = [`rc.review_state='approved'`];
    if (authority) { params.push(String(authority).toUpperCase()); where.push(`rc.authority_code=$${params.length}`); }
    if (waterway) { params.push(String(waterway).toLowerCase()); where.push(`LOWER(rc.waterway)=$${params.length}`); }
    if (since) { params.push(String(since)); where.push(`rc.detected_at>=$${params.length}::timestamptz`); }
    const q = await req.app.locals.pool.query(`SELECT rc.id,rc.authority_code,rc.waterway,rc.change_type,rc.summary,rc.impact,rc.detected_at,rc.effective_at,rs.title source_title,rs.source_url,rs.version_label FROM regulatory_changes rc LEFT JOIN regulatory_sources rs ON rs.id=rc.source_id WHERE ${where.join(' AND ')} ORDER BY rc.detected_at DESC LIMIT 500`, params);
    res.json({ success: true, changes: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/v1/authorities/:authority/requirements', requireComplianceApiKey('regulations:read'), async (req, res) => {
  try {
    const authority = String(req.params.authority).toUpperCase();
    const q = await req.app.locals.pool.query(`SELECT rr.authority_code,rr.waterway,rr.rule_key,rr.title,rr.description,rr.severity,rr.predicate,rr.required_fields,rr.required_document_types,rr.validation,rr.interpretation_state,rr.effective_from,rr.effective_to,rr.version,rs.title source_title,rs.source_url,rs.version_label source_version,rs.last_verified_at FROM regulatory_rules rr LEFT JOIN regulatory_sources rs ON rs.id=rr.source_id WHERE rr.authority_code=$1 AND rr.active=true ORDER BY rr.waterway,rr.rule_key`, [authority]);
    res.json({ success: true, authority, rules: q.rows, guardrail: 'Official authority publications remain controlling where any discrepancy exists.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
