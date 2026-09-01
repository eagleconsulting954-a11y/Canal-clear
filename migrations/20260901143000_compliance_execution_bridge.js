module.exports = {
  name: 'compliance_execution_bridge_v1',
  up: async (client) => {
    await client.query(`
      ALTER TABLE submission_attempts
        ADD COLUMN IF NOT EXISTS compliance_voyage_id BIGINT REFERENCES compliance_voyages(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS submission_attempts_compliance_voyage_idx
        ON submission_attempts(compliance_voyage_id, created_at DESC);

      ALTER TABLE compliance_outcomes
        ADD COLUMN IF NOT EXISTS submission_attempt_id BIGINT REFERENCES submission_attempts(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS source_type VARCHAR(48) NOT NULL DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS source_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
      CREATE UNIQUE INDEX IF NOT EXISTS compliance_outcomes_submission_unique_idx
        ON compliance_outcomes(submission_attempt_id)
        WHERE submission_attempt_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS compliance_document_field_events (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        document_id BIGINT REFERENCES compliance_documents(id) ON DELETE CASCADE,
        field_path TEXT NOT NULL,
        extracted_value JSONB,
        existing_value JSONB,
        confidence NUMERIC(5,4),
        resolution VARCHAR(32) NOT NULL DEFAULT 'pending',
        resolved_value JSONB,
        resolved_by TEXT,
        resolved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS compliance_document_field_events_pending_idx
        ON compliance_document_field_events(user_id, vessel_id, resolution, created_at DESC);

      CREATE TABLE IF NOT EXISTS compliance_submission_packages (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        voyage_id BIGINT NOT NULL REFERENCES compliance_voyages(id) ON DELETE CASCADE,
        authority_code VARCHAR(32) NOT NULL,
        adapter_key VARCHAR(120),
        package_version INTEGER NOT NULL DEFAULT 1,
        readiness_score INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_versions JSONB NOT NULL DEFAULT '[]'::jsonb,
        package_hash VARCHAR(128),
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(voyage_id, authority_code, package_version)
      );
      CREATE INDEX IF NOT EXISTS compliance_submission_packages_lookup_idx
        ON compliance_submission_packages(user_id, voyage_id, authority_code, created_at DESC);

      CREATE TABLE IF NOT EXISTS compliance_learning_signals (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32),
        waterway VARCHAR(64),
        signal_type VARCHAR(64) NOT NULL,
        signal_key VARCHAR(180) NOT NULL,
        observations INTEGER NOT NULL DEFAULT 1,
        accepted_count INTEGER NOT NULL DEFAULT 0,
        exception_count INTEGER NOT NULL DEFAULT 0,
        confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(authority_code, waterway, signal_type, signal_key)
      );

      CREATE TABLE IF NOT EXISTS compliance_event_outbox (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        event_type VARCHAR(96) NOT NULL,
        aggregate_type VARCHAR(48),
        aggregate_id BIGINT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(24) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS compliance_event_outbox_pending_idx
        ON compliance_event_outbox(status, next_attempt_at, created_at);
    `);
  }
};
