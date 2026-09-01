const express = require('express');
const multer = require('multer');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const bridge = require('../services/compliance-bridge');
const documentIntelligence = require('../services/document-intelligence');

function db(req) { return req.app.locals.pool; }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('text/') || /\.(pdf|txt|csv)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Only PDF and text documents are supported'), ok);
  }
});

router.post('/documents/extract', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'file is required' });
  try {
    const extraction = await documentIntelligence.extractFromBuffer(req.file.buffer, {
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    res.json({
      success: true,
      file: { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype },
      extraction,
    });
  } catch (err) {
    console.error('[compliance-operations] document extraction:', err.message);
    res.status(422).json({ success: false, message: 'Unable to extract document text', detail: err.message });
  }
});

router.post('/documents', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { vessel_id, document_type, document_name, storage_ref, extracted_fields = {}, extraction_confidence = null, issued_at = null, expires_at = null, issuer = null, source_hash = null, review_state = 'pending' } = req.body || {};
  if (!vessel_id || !document_type) return res.status(400).json({ success: false, message: 'vessel_id and document_type are required' });
  try {
    const p = db(req);
    const vessel = await p.query(`SELECT id FROM vessels WHERE id=$1 AND user_id=$2 AND status!='deleted'`, [Number(vessel_id), userId]);
    if (!vessel.rows[0]) return res.status(404).json({ success: false, message: 'Vessel not found' });
    const doc = await bridge.recordDocument(p, {
      userId, vesselId: Number(vessel_id), documentType: document_type, documentName: document_name,
      storageRef: storage_ref, extractedFields: extracted_fields, extractionConfidence: extraction_confidence,
      issuedAt: issued_at, expiresAt: expires_at, issuer, sourceHash: source_hash, reviewState: review_state
    });
    const profileQ = await p.query(`SELECT identity,particulars,ownership,operational,authority_identifiers FROM compliance_vessel_profiles WHERE user_id=$1 AND vessel_id=$2`, [userId, Number(vessel_id)]);
    const profile = profileQ.rows[0] || {};
    const conflicts = await bridge.createFieldConflicts(p, { userId, vesselId: Number(vessel_id), documentId: doc.id, extractedFields: extracted_fields, profile });
    if (conflicts.length) {
      await p.query(`INSERT INTO compliance_review_queue(user_id,entity_type,entity_id,reason,risk_level,context) VALUES($1,'document',$2,'document_field_conflict','medium',$3)`, [userId, doc.id, { conflict_count: conflicts.length }]);
    }
    res.json({ success: true, document: doc, conflicts });
  } catch (err) {
    console.error('[compliance-operations] document ingest:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/documents/:id/conflicts', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT cfe.* FROM compliance_document_field_events cfe JOIN compliance_documents cd ON cd.id=cfe.document_id WHERE cfe.document_id=$1 AND cd.user_id=$2 ORDER BY cfe.created_at DESC`, [Number(req.params.id), req.user.id]);
    res.json({ success: true, conflicts: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/documents/conflicts/:id', requireAuth, async (req, res) => {
  const { resolution, resolved_value = null } = req.body || {};
  if (!['accept_extracted','keep_existing','manual_value','dismissed'].includes(resolution)) return res.status(400).json({ success: false, message: 'Invalid resolution' });
  try {
    const q = await db(req).query(`UPDATE compliance_document_field_events SET resolution=$1,resolved_value=$2,resolved_by=$3,resolved_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`, [resolution, resolved_value, String(req.user.email || req.user.id), Number(req.params.id), req.user.id]);
    if (!q.rows[0]) return res.status(404).json({ success: false, message: 'Conflict not found' });
    res.json({ success: true, conflict: q.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/voyages/:id/packages/:authorityCode', requireAuth, async (req, res) => {
  try {
    const pkg = await bridge.buildAuthorityPackage(db(req), { userId: req.user.id, voyageId: Number(req.params.id), authorityCode: String(req.params.authorityCode).toUpperCase() });
    if (!pkg) return res.status(404).json({ success: false, message: 'Voyage not found' });
    res.json({ success: true, package: pkg });
  } catch (err) {
    console.error('[compliance-operations] package build:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/voyages/:id/packages', requireAuth, async (req, res) => {
  try {
    const voyage = await bridge.assertVoyage(db(req), req.user.id, Number(req.params.id));
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found' });
    const q = await db(req).query(`SELECT id,voyage_id,authority_code,adapter_key,package_version,readiness_score,package_hash,status,created_at,updated_at FROM compliance_submission_packages WHERE user_id=$1 AND voyage_id=$2 ORDER BY created_at DESC`, [req.user.id, Number(req.params.id)]);
    res.json({ success: true, packages: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/submissions/:id/link-voyage', requireAuth, async (req, res) => {
  const { voyage_id } = req.body || {};
  if (!voyage_id) return res.status(400).json({ success: false, message: 'voyage_id is required' });
  try {
    const p = db(req);
    const voyage = await bridge.assertVoyage(p, req.user.id, Number(voyage_id));
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found' });
    const q = await p.query(`UPDATE submission_attempts SET compliance_voyage_id=$1 WHERE id=$2 AND user_id=$3 RETURNING *`, [Number(voyage_id), Number(req.params.id), req.user.id]);
    if (!q.rows[0]) return res.status(404).json({ success: false, message: 'Submission attempt not found' });
    const outcome = await bridge.syncSubmissionOutcome(p, Number(req.params.id));
    res.json({ success: true, submission: q.rows[0], outcome });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.post('/submissions/:id/sync-outcome', requireAuth, async (req, res) => {
  try {
    const owned = await db(req).query(`SELECT id FROM submission_attempts WHERE id=$1 AND user_id=$2`, [Number(req.params.id), req.user.id]);
    if (!owned.rows[0]) return res.status(404).json({ success: false, message: 'Submission attempt not found' });
    const outcome = await bridge.syncSubmissionOutcome(db(req), Number(req.params.id));
    res.json({ success: true, outcome });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/voyages/:id/timeline', requireAuth, async (req, res) => {
  try {
    const voyage = await bridge.assertVoyage(db(req), req.user.id, Number(req.params.id));
    if (!voyage) return res.status(404).json({ success: false, message: 'Voyage not found' });
    const [ledger, submissions, outcomes] = await Promise.all([
      db(req).query(`SELECT id,event_type,actor_type,actor_id,result,evidence_refs,created_at FROM compliance_evidence_ledger WHERE user_id=$1 AND voyage_id=$2 ORDER BY created_at DESC LIMIT 200`, [req.user.id, Number(req.params.id)]),
      db(req).query(`SELECT id,waterway,authority,channel,status,authority_reference,response_status,error_message,created_at,sent_at,acknowledged_at FROM submission_attempts WHERE user_id=$1 AND compliance_voyage_id=$2 ORDER BY created_at DESC LIMIT 100`, [req.user.id, Number(req.params.id)]),
      db(req).query(`SELECT * FROM compliance_outcomes WHERE user_id=$1 AND voyage_id=$2 ORDER BY occurred_at DESC LIMIT 100`, [req.user.id, Number(req.params.id)])
    ]);
    res.json({ success: true, timeline: { evidence: ledger.rows, submissions: submissions.rows, outcomes: outcomes.rows } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/reviews', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT * FROM compliance_review_queue WHERE user_id=$1 ORDER BY CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC LIMIT 250`, [req.user.id]);
    res.json({ success: true, reviews: q.rows });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/reviews/:id', requireAuth, async (req, res) => {
  const { status, assigned_to = null } = req.body || {};
  if (!['open','in_review','resolved','dismissed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid review status' });
  try {
    const q = await db(req).query(`UPDATE compliance_review_queue SET status=$1,assigned_to=COALESCE($2,assigned_to),resolved_at=CASE WHEN $1 IN ('resolved','dismissed') THEN NOW() ELSE NULL END WHERE id=$3 AND user_id=$4 RETURNING *`, [status, assigned_to, Number(req.params.id), req.user.id]);
    if (!q.rows[0]) return res.status(404).json({ success: false, message: 'Review item not found' });
    res.json({ success: true, review: q.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/learning-signals', requireAuth, async (req, res) => {
  try {
    const q = await db(req).query(`SELECT * FROM compliance_learning_signals ORDER BY observations DESC,last_seen_at DESC LIMIT 300`);
    res.json({ success: true, signals: q.rows, guardrail: 'Learning signals are observational and must not be represented as official authority rules.' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.patch('/partnerships/:authorityCode', requireAuth, async (req, res) => {
  const { stage, next_action = null, next_action_at = null, technical_scope = null, pilot_metrics = null } = req.body || {};
  const allowed = ['identified','routed','technical_contact','discovery','pilot_proposed','procurement','pilot_active','strategic_partner','nurture'];
  if (stage && !allowed.includes(stage)) return res.status(400).json({ success: false, message: 'Invalid partnership stage' });
  try {
    const q = await db(req).query(`UPDATE authority_partnerships SET stage=COALESCE($1,stage),next_action=COALESCE($2,next_action),next_action_at=COALESCE($3,next_action_at),technical_scope=CASE WHEN $4::jsonb IS NULL THEN technical_scope ELSE technical_scope || $4::jsonb END,pilot_metrics=CASE WHEN $5::jsonb IS NULL THEN pilot_metrics ELSE pilot_metrics || $5::jsonb END,updated_at=NOW() WHERE authority_code=$6 RETURNING *`, [stage || null, next_action, next_action_at, technical_scope ? JSON.stringify(technical_scope) : null, pilot_metrics ? JSON.stringify(pilot_metrics) : null, String(req.params.authorityCode).toUpperCase()]);
    if (!q.rows[0]) return res.status(404).json({ success: false, message: 'Authority partnership not found' });
    res.json({ success: true, partnership: q.rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
