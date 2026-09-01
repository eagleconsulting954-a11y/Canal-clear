module.exports = {
  name: 'compliance_infrastructure_v1',
  up: async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_vessel_profiles (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        imo VARCHAR(16),
        profile_version INTEGER NOT NULL DEFAULT 1,
        identity JSONB NOT NULL DEFAULT '{}'::jsonb,
        particulars JSONB NOT NULL DEFAULT '{}'::jsonb,
        ownership JSONB NOT NULL DEFAULT '{}'::jsonb,
        operational JSONB NOT NULL DEFAULT '{}'::jsonb,
        authority_identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
        verification_state VARCHAR(32) NOT NULL DEFAULT 'unverified',
        verified_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, vessel_id)
      );

      CREATE INDEX IF NOT EXISTS cvp_user_imo_idx ON compliance_vessel_profiles(user_id, imo);

      CREATE TABLE IF NOT EXISTS compliance_documents (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        document_type VARCHAR(120) NOT NULL,
        document_name TEXT,
        storage_ref TEXT,
        source_hash VARCHAR(128),
        extracted_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        extraction_confidence NUMERIC(5,4),
        issued_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        issuer TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        review_state VARCHAR(32) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS compliance_documents_vessel_idx ON compliance_documents(user_id, vessel_id, expires_at);

      CREATE TABLE IF NOT EXISTS regulatory_sources (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        title TEXT NOT NULL,
        source_url TEXT NOT NULL,
        publication_date DATE,
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        source_type VARCHAR(64),
        version_label VARCHAR(120),
        checksum VARCHAR(128),
        is_authoritative BOOLEAN NOT NULL DEFAULT TRUE,
        last_verified_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(authority_code, source_url, version_label)
      );

      CREATE TABLE IF NOT EXISTS regulatory_rules (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        rule_key VARCHAR(160) NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        severity VARCHAR(24) NOT NULL DEFAULT 'required',
        predicate JSONB NOT NULL DEFAULT '{}'::jsonb,
        required_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        required_document_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        validation JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_id BIGINT REFERENCES regulatory_sources(id) ON DELETE SET NULL,
        source_excerpt TEXT,
        interpretation_state VARCHAR(32) NOT NULL DEFAULT 'reviewed',
        effective_from TIMESTAMPTZ,
        effective_to TIMESTAMPTZ,
        version INTEGER NOT NULL DEFAULT 1,
        supersedes_rule_id BIGINT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(authority_code, rule_key, version)
      );
      CREATE INDEX IF NOT EXISTS regulatory_rules_lookup_idx ON regulatory_rules(authority_code, waterway, active);

      CREATE TABLE IF NOT EXISTS regulatory_changes (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        source_id BIGINT REFERENCES regulatory_sources(id) ON DELETE SET NULL,
        change_type VARCHAR(40) NOT NULL,
        summary TEXT NOT NULL,
        impact JSONB NOT NULL DEFAULT '{}'::jsonb,
        review_state VARCHAR(32) NOT NULL DEFAULT 'pending',
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        effective_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS compliance_voyages (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        voyage_ref VARCHAR(120),
        origin TEXT,
        destination TEXT,
        eta TIMESTAMPTZ,
        etd TIMESTAMPTZ,
        cargo JSONB NOT NULL DEFAULT '{}'::jsonb,
        route JSONB NOT NULL DEFAULT '[]'::jsonb,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        readiness_score INTEGER NOT NULL DEFAULT 0,
        readiness_state VARCHAR(32) NOT NULL DEFAULT 'insufficient_evidence',
        compiled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS compliance_voyages_user_eta_idx ON compliance_voyages(user_id, eta);

      CREATE TABLE IF NOT EXISTS voyage_requirements (
        id BIGSERIAL PRIMARY KEY,
        voyage_id BIGINT NOT NULL REFERENCES compliance_voyages(id) ON DELETE CASCADE,
        rule_id BIGINT REFERENCES regulatory_rules(id) ON DELETE SET NULL,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        requirement_key VARCHAR(160) NOT NULL,
        title TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'unresolved',
        severity VARCHAR(24) NOT NULL DEFAULT 'required',
        missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        missing_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        source_provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
        due_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(voyage_id, authority_code, requirement_key)
      );
      CREATE INDEX IF NOT EXISTS voyage_requirements_status_idx ON voyage_requirements(voyage_id, status);

      CREATE TABLE IF NOT EXISTS compliance_evidence_ledger (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        voyage_id BIGINT REFERENCES compliance_voyages(id) ON DELETE SET NULL,
        requirement_id BIGINT REFERENCES voyage_requirements(id) ON DELETE SET NULL,
        event_type VARCHAR(64) NOT NULL,
        actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
        actor_id TEXT,
        rule_version INTEGER,
        source_id BIGINT REFERENCES regulatory_sources(id) ON DELETE SET NULL,
        input_hash VARCHAR(128),
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS evidence_ledger_voyage_idx ON compliance_evidence_ledger(user_id, voyage_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS authority_adapters (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL,
        waterway VARCHAR(64) NOT NULL,
        adapter_key VARCHAR(120) NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        submission_mode VARCHAR(40) NOT NULL DEFAULT 'guided',
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        field_map JSONB NOT NULL DEFAULT '{}'::jsonb,
        endpoint_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS compliance_outcomes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        vessel_id BIGINT,
        voyage_id BIGINT REFERENCES compliance_voyages(id) ON DELETE SET NULL,
        authority_code VARCHAR(32),
        waterway VARCHAR(64),
        outcome VARCHAR(48) NOT NULL,
        authority_reference TEXT,
        reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
        corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_response_ref TEXT,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS compliance_review_queue (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        entity_type VARCHAR(48) NOT NULL,
        entity_id BIGINT NOT NULL,
        reason VARCHAR(80) NOT NULL,
        risk_level VARCHAR(24) NOT NULL DEFAULT 'medium',
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(32) NOT NULL DEFAULT 'open',
        assigned_to TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS compliance_webhook_endpoints (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        endpoint_url TEXT NOT NULL,
        event_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        signing_secret_hash VARCHAR(128),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS authority_partnerships (
        id BIGSERIAL PRIMARY KEY,
        authority_code VARCHAR(32) NOT NULL UNIQUE,
        authority_name TEXT NOT NULL,
        stage VARCHAR(48) NOT NULL DEFAULT 'identified',
        official_routes JSONB NOT NULL DEFAULT '{}'::jsonb,
        technical_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        pilot_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        claims_guardrail TEXT NOT NULL DEFAULT 'No endorsement, integration, certification, or approval may be implied without written authority authorization.',
        next_action TEXT,
        next_action_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      INSERT INTO authority_adapters(authority_code, waterway, adapter_key, display_name, submission_mode, capabilities)
      VALUES
        ('ACP','panama','acp-vumpa','Panama Canal Authority / VUMPA','portal_assisted','{"rules":true,"validation":true,"credentials":true,"submission_audit":true}'::jsonb),
        ('SCA','suez','sca-eservices','Suez Canal Authority / E-Services','portal_assisted','{"rules":true,"validation":true,"credentials":true,"submission_audit":true}'::jsonb),
        ('TSVTS','bosporus','turkish-straits','Turkish Straits / SP-1','guided','{"rules":true,"validation":true}'::jsonb),
        ('MPA','malacca','mpa-straitrep','Singapore MPA / STRAITREP','digital','{"rules":true,"validation":true,"enrichment":true}'::jsonb),
        ('SAMSA','cape','cape-isps','Cape of Good Hope / ISPS workflow','guided','{"rules":true,"validation":true}'::jsonb)
      ON CONFLICT(adapter_key) DO NOTHING;

      INSERT INTO authority_partnerships(authority_code, authority_name, official_routes, technical_scope, pilot_metrics, next_action)
      VALUES
        ('ACP','Panama Canal Authority',
          '{"procurement":"acp-compras@pancanal.com","supplier_system":"SLI","strategic_route":"Strategic Planning"}'::jsonb,
          '{"positioning":"industry-side upstream validation","production_access":false,"authority_remains_authoritative":true}'::jsonb,
          '{"completeness_detection":true,"exception_visibility":true,"rule_provenance":true,"operator_effort":true}'::jsonb,
          'Prepare supplier registration and request technical discovery routing'),
        ('SCA','Suez Canal Authority',
          '{"strategic_route":"Planning / Research","operations_route":"Transit / Navigation","procurement_route":"Procurement"}'::jsonb,
          '{"positioning":"industry-side pre-transit readiness","production_access":false,"authority_remains_authoritative":true}'::jsonb,
          '{"missing_particulars":true,"rule_change_propagation":true,"rule_provenance":true,"operator_effort":true}'::jsonb,
          'Request technical discovery with appropriate Planning, Transit, Information Systems, or Procurement stakeholder')
      ON CONFLICT(authority_code) DO NOTHING;
    `);
  }
};