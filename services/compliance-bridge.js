const crypto = require('crypto');

function hashObject(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

async function assertVoyage(pool, userId, voyageId) {
  const q = await pool.query(
    `SELECT cv.*, v.name vessel_name, v.imo, v.flag, v.type, v.gt, v.nt, v.loa, v.beam, v.max_draft, v.class_society
     FROM compliance_voyages cv
     JOIN vessels v ON v.id=cv.vessel_id
     WHERE cv.id=$1 AND cv.user_id=$2`,
    [voyageId, userId]
  );
  return q.rows[0] || null;
}

async function recordDocument(pool, {
  userId, vesselId, documentType, documentName, storageRef, extractedFields = {},
  extractionConfidence = null, issuedAt = null, expiresAt = null, issuer = null,
  sourceHash = null, reviewState = 'pending'
}) {
  const hash = sourceHash || hashObject({ documentType, documentName, storageRef, extractedFields, issuedAt, expiresAt, issuer });
  const q = await pool.query(
    `INSERT INTO compliance_documents
       (user_id,vessel_id,document_type,document_name,storage_ref,source_hash,extracted_fields,extraction_confidence,issued_at,expires_at,issuer,review_state)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [userId, vesselId, documentType, documentName || null, storageRef || null, hash, extractedFields, extractionConfidence, issuedAt, expiresAt, issuer, reviewState]
  );
  const doc = q.rows[0];
  await pool.query(
    `INSERT INTO compliance_evidence_ledger(user_id,vessel_id,event_type,actor_type,input_hash,result,evidence_refs)
     VALUES($1,$2,'document.ingested','system',$3,$4,$5)`,
    [userId, vesselId, hash, { document_type: documentType, review_state: reviewState }, [doc.id]]
  );
  await pool.query(
    `INSERT INTO compliance_event_outbox(user_id,event_type,aggregate_type,aggregate_id,payload)
     VALUES($1,'document.ingested','document',$2,$3)`,
    [userId, doc.id, { vessel_id: vesselId, document_type: documentType }]
  );
  return doc;
}

async function createFieldConflicts(pool, { userId, vesselId, documentId, extractedFields = {}, profile = {} }) {
  const events = [];
  for (const [fieldPath, extractedValue] of Object.entries(extractedFields)) {
    const parts = fieldPath.split('.');
    let cursor = profile;
    for (const p of parts) cursor = cursor == null ? undefined : cursor[p];
    if (cursor !== undefined && JSON.stringify(cursor) !== JSON.stringify(extractedValue)) {
      const q = await pool.query(
        `INSERT INTO compliance_document_field_events
           (user_id,vessel_id,document_id,field_path,extracted_value,existing_value)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [userId, vesselId, documentId, fieldPath, JSON.stringify(extractedValue), JSON.stringify(cursor)]
      );
      events.push(q.rows[0]);
    }
  }
  return events;
}

async function buildAuthorityPackage(pool, { userId, voyageId, authorityCode }) {
  const voyage = await assertVoyage(pool, userId, voyageId);
  if (!voyage) return null;
  const profileQ = await pool.query(`SELECT * FROM compliance_vessel_profiles WHERE user_id=$1 AND vessel_id=$2`, [userId, voyage.vessel_id]);
  const reqQ = await pool.query(`SELECT * FROM voyage_requirements WHERE voyage_id=$1 AND authority_code=$2 ORDER BY id`, [voyageId, authorityCode]);
  const adapterQ = await pool.query(`SELECT * FROM authority_adapters WHERE authority_code=$1 AND status='active' ORDER BY id LIMIT 1`, [authorityCode]);
  const docsQ = await pool.query(`SELECT id,document_type,document_name,source_hash,expires_at,review_state FROM compliance_documents WHERE user_id=$1 AND vessel_id=$2 AND status='active' ORDER BY created_at DESC`, [userId, voyage.vessel_id]);
  const profile = profileQ.rows[0] || {};
  const adapter = adapterQ.rows[0] || null;
  const requirements = reqQ.rows;
  const unresolved = requirements.filter(r => r.status !== 'satisfied');
  const payload = {
    authority_code: authorityCode,
    voyage: { id: voyage.id, voyage_ref: voyage.voyage_ref, origin: voyage.origin, destination: voyage.destination, eta: voyage.eta, etd: voyage.etd, cargo: voyage.cargo, route: voyage.route },
    vessel: { id: voyage.vessel_id, name: voyage.vessel_name, imo: voyage.imo, flag: voyage.flag, type: voyage.type, gt: voyage.gt, nt: voyage.nt, loa: voyage.loa, beam: voyage.beam, max_draft: voyage.max_draft, class_society: voyage.class_society },
    passport: { identity: profile.identity || {}, particulars: profile.particulars || {}, operational: profile.operational || {}, authority_identifiers: profile.authority_identifiers || {} },
    adapter: adapter ? { key: adapter.adapter_key, submission_mode: adapter.submission_mode, field_map: adapter.field_map || {}, capabilities: adapter.capabilities || {} } : null,
    requirements: requirements.map(r => ({ key: r.requirement_key, title: r.title, status: r.status, missing_fields: r.missing_fields, missing_documents: r.missing_documents, provenance: r.source_provenance })),
    documents: docsQ.rows,
    guardrail: 'This package is an industry-side preparation artifact. It is not an official authority submission unless transmitted through an explicitly authorized integration.'
  };
  const sourceVersions = requirements.map(r => r.source_provenance).filter(Boolean);
  const evidenceRefs = docsQ.rows.map(d => d.id);
  const versionQ = await pool.query(`SELECT COALESCE(MAX(package_version),0)+1 next_version FROM compliance_submission_packages WHERE voyage_id=$1 AND authority_code=$2`, [voyageId, authorityCode]);
  const packageVersion = versionQ.rows[0].next_version;
  const packageHash = hashObject(payload);
  const status = unresolved.length ? 'review_required' : 'ready';
  const q = await pool.query(
    `INSERT INTO compliance_submission_packages
       (user_id,voyage_id,authority_code,adapter_key,package_version,readiness_score,payload,evidence_refs,source_versions,package_hash,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [userId, voyageId, authorityCode, adapter?.adapter_key || null, packageVersion, voyage.readiness_score || 0, payload, evidenceRefs, sourceVersions, packageHash, status]
  );
  await pool.query(
    `INSERT INTO compliance_evidence_ledger(user_id,vessel_id,voyage_id,event_type,actor_type,input_hash,result,evidence_refs)
     VALUES($1,$2,$3,'submission.package_built','system',$4,$5,$6)`,
    [userId, voyage.vessel_id, voyageId, packageHash, { authority_code: authorityCode, package_version: packageVersion, status }, evidenceRefs]
  );
  return q.rows[0];
}

function mapOutcome(status) {
  if (status === 'acknowledged' || status === 'delivered') return 'accepted_transport';
  if (status === 'failed') return 'submission_failed';
  if (status === 'manual_required') return 'manual_intervention_required';
  if (status === 'sent') return 'submitted';
  return 'queued';
}

async function syncSubmissionOutcome(pool, submissionAttemptId) {
  const q = await pool.query(`SELECT * FROM submission_attempts WHERE id=$1`, [submissionAttemptId]);
  const attempt = q.rows[0];
  if (!attempt) return null;
  const authorityMap = { acp_vumpa: 'ACP', sca: 'SCA', samsa: 'SAMSA', turkish_vtsc: 'TSVTS', mpa_singapore: 'MPA' };
  const outcome = mapOutcome(attempt.status);
  const result = await pool.query(
    `INSERT INTO compliance_outcomes
       (user_id,vessel_id,voyage_id,authority_code,waterway,outcome,authority_reference,raw_response_ref,submission_attempt_id,source_type,source_payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'submission_attempt',$10)
     ON CONFLICT(submission_attempt_id) WHERE submission_attempt_id IS NOT NULL
     DO UPDATE SET outcome=EXCLUDED.outcome, authority_reference=EXCLUDED.authority_reference, raw_response_ref=EXCLUDED.raw_response_ref, source_payload=EXCLUDED.source_payload, occurred_at=NOW()
     RETURNING *`,
    [attempt.user_id, attempt.vessel_id, attempt.compliance_voyage_id, authorityMap[attempt.authority] || attempt.authority, attempt.waterway, outcome, attempt.authority_reference, attempt.response_body ? `submission_attempt:${attempt.id}:response` : null, attempt.id, { status: attempt.status, response_status: attempt.response_status, error_message: attempt.error_message }]
  );
  const accepted = ['acknowledged','delivered'].includes(attempt.status) ? 1 : 0;
  const exception = ['failed','manual_required'].includes(attempt.status) ? 1 : 0;
  const signalKey = `${attempt.authority}:${attempt.channel}:${attempt.status}`;
  await pool.query(
    `INSERT INTO compliance_learning_signals(authority_code,waterway,signal_type,signal_key,observations,accepted_count,exception_count,confidence,metadata)
     VALUES($1,$2,'submission_outcome',$3,1,$4,$5,0.1,$6)
     ON CONFLICT(authority_code,waterway,signal_type,signal_key)
     DO UPDATE SET observations=compliance_learning_signals.observations+1,
       accepted_count=compliance_learning_signals.accepted_count+EXCLUDED.accepted_count,
       exception_count=compliance_learning_signals.exception_count+EXCLUDED.exception_count,
       confidence=LEAST(0.99, compliance_learning_signals.confidence + 0.02),
       last_seen_at=NOW(), metadata=EXCLUDED.metadata`,
    [authorityMap[attempt.authority] || attempt.authority, attempt.waterway, signalKey, accepted, exception, { channel: attempt.channel, status: attempt.status }]
  );
  await pool.query(
    `INSERT INTO compliance_event_outbox(user_id,event_type,aggregate_type,aggregate_id,payload)
     VALUES($1,'authority.outcome_recorded','submission_attempt',$2,$3)`,
    [attempt.user_id, attempt.id, { voyage_id: attempt.compliance_voyage_id, authority: attempt.authority, outcome }]
  );
  return result.rows[0];
}

module.exports = { recordDocument, createFieldConflicts, buildAuthorityPackage, syncSubmissionOutcome, assertVoyage, hashObject };
