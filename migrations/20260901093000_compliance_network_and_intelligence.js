module.exports = {
  name: 'compliance_network_and_intelligence_v1',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS voyage_collaborators (
        id BIGSERIAL PRIMARY KEY,
        voyage_id BIGINT NOT NULL REFERENCES compliance_voyages(id) ON DELETE CASCADE,
        user_id BIGINT,
        external_email TEXT,
        organization_name TEXT,
        role VARCHAR(48) NOT NULL DEFAULT 'viewer',
        responsibility JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS voyage_collaborators_voyage_idx ON voyage_collaborators(voyage_id, status);

      CREATE TABLE IF NOT EXISTS requirement_assignments (
        id BIGSERIAL PRIMARY KEY,
        requirement_id BIGINT NOT NULL REFERENCES voyage_requirements(id) ON DELETE CASCADE,
        collaborator_id BIGINT REFERENCES voyage_collaborators(id) ON DELETE SET NULL,
        assigned_user_id BIGINT,
        due_at TIMESTAMPTZ,
        status VARCHAR(32) NOT NULL DEFAULT 'assigned',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS regulatory_source_monitors (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        source_url TEXT NOT NULL,
        source_type VARCHAR(48) NOT NULL DEFAULT 'official_page',
        cadence_minutes INTEGER NOT NULL DEFAULT 1440,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        last_checked_at TIMESTAMPTZ,
        last_checksum VARCHAR(128),
        last_status VARCHAR(32),
        next_check_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(authority_code, source_url)
      );

      CREATE TABLE IF NOT EXISTS regulatory_ingestion_runs (
        id BIGSERIAL PRIMARY KEY,
        monitor_id BIGINT REFERENCES regulatory_source_monitors(id) ON DELETE SET NULL,
        authority_code VARCHAR(32) NOT NULL,
        source_url TEXT NOT NULL,
        fetch_status VARCHAR(32) NOT NULL,
        previous_checksum VARCHAR(128),
        current_checksum VARCHAR(128),
        changed BOOLEAN NOT NULL DEFAULT FALSE,
        diff_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS compliance_notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        entity_type VARCHAR(48),
        entity_id BIGINT,
        title TEXT NOT NULL,
        body TEXT,
        severity VARCHAR(24) NOT NULL DEFAULT 'info',
        read_at TIMESTAMPTZ,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS compliance_notifications_user_idx ON compliance_notifications(user_id, read_at, created_at DESC);

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id BIGSERIAL PRIMARY KEY,
        endpoint_id BIGINT REFERENCES compliance_webhook_endpoints(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        event_id TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        attempt INTEGER NOT NULL DEFAULT 1,
        delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
        response_status INTEGER,
        response_excerpt TEXT,
        next_attempt_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS compliance_intelligence_snapshots (
        id BIGSERIAL PRIMARY KEY,
        scope_type VARCHAR(48) NOT NULL,
        scope_key TEXT NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        sample_size INTEGER NOT NULL DEFAULT 0,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        privacy_state VARCHAR(32) NOT NULL DEFAULT 'internal_only',
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(scope_type, scope_key, period_start, period_end)
      );

      CREATE TABLE IF NOT EXISTS authority_feedback (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        rule_id BIGINT REFERENCES regulatory_rules(id) ON DELETE SET NULL,
        source_id BIGINT REFERENCES regulatory_sources(id) ON DELETE SET NULL,
        feedback_type VARCHAR(48) NOT NULL,
        feedback_text TEXT NOT NULL,
        submitted_by TEXT,
        authorization_state VARCHAR(32) NOT NULL DEFAULT 'unverified',
        review_state VARCHAR(32) NOT NULL DEFAULT 'pending',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS compliance_api_keys (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        key_prefix VARCHAR(24) NOT NULL,
        key_hash VARCHAR(128) NOT NULL UNIQUE,
        name TEXT NOT NULL,
        scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS document_field_conflicts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        field_path TEXT NOT NULL,
        values JSONB NOT NULL DEFAULT '[]'::jsonb,
        document_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );

      INSERT INTO regulatory_source_monitors(authority_code, waterway, source_url, source_type, cadence_minutes, metadata)
      VALUES
        ('ACP','panama','https://pancanal.com/','official_authority_site',1440,'{"purpose":"official notices and navigation requirements","requires_review_before_rule_change":true}'::jsonb),
        ('SCA','suez','https://www.suezcanal.gov.eg/English/Pages/Default.aspx','official_authority_site',1440,'{"purpose":"rules circulars and navigation updates","requires_review_before_rule_change":true}'::jsonb)
      ON CONFLICT(authority_code, source_url) DO NOTHING;
    `);
  }
};