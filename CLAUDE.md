# CanalClear — CLAUDE.md

## What this app does
CanalClear automates compliance filings for Panama Canal (VUMPA/PCSOPEP), Suez Canal (SCA/SCNT/ISPS), Bosporus / Turkish Straits (SP-1/Montreux), and Strait of Malacca (TSS/VTIS/MARPOL). Ship operators, fleet managers, and ship agents use it to replace expensive manual ship agent paperwork ($2,000–$5,000+ per transit) with AI-powered pre-submission validation across the world's critical maritime chokepoints.

## Stack
Express.js + Node.js · PostgreSQL (Neon) · Render deployment · Stripe payments · Postmark email · Cloudflare R2 storage

## Directory map
- `server.js` — main Express entry (~240 lines, wiring only — all routes/services extracted)
- `routes/` — Express route modules (api.js, pages.js, content.js, assets.js, admin.js, bosporus.js, malacca.js, cape.js, deadline-alerts.js, batch.js, integrations.js, direct-filing.js, status.js, ais.js, geofence.js, v1.js, v1-keys.js, agent-dashboard.js, onboarding.js, vessel-limits.js, calculator.js, sca.js, vumpa.js, mpa.js)
- `db/` — SQL query modules, one file per entity (bosporus-filings.js, malacca-filings.js, cape-filings.js, filing-deadlines.js, ais-positions.js, api-keys.js, inbound-data.js, webhook-logs.js, vessel-limits.js, sca-portal.js, vumpa-portal.js, mpa-portal.js, vtsc-portal.js); no Pool construction here
- `services/` — business logic (PDF generation, email, drip, alerts, vessel-lookup, startup.js, deadline-alert-service.js, bosporus-validator.js, malacca-validator.js, cape-validator.js, batch-validator.js, ais-mock-provider.js, ais-provider.js, inbound-validator.js, vessel-limit-service.js, sca-portal.js, vumpa-portal.js, mpa-portal.js, vtsc-portal.js)
- `middleware/` — auth helpers (requireAuth, requireSubscription, requireAdmin, apiKeyAuth.js) + analytics.js (bot detection, page views)
- `migrations/` — node-pg-migrate SQL schema files
- `public/` — all HTML/CSS/JS for the site (65+ pages)
- `public/blog/` — 57 blog posts (byline: Francis Eagleston); includes 2 Cape (SAMSA ISPS), 2 Bosporus (SP-1/Turkish Straits), 2 Malacca (STRAITREP/VTIS)
- `public/css/` — global styles (nav.css, mobile.css, visual-polish.css)
- `public/js/` — client JS (analytics, lead-funnel, chatbot, mobile-nav, pwa-manager, whatsapp-button, ocr-upload.js)
- `scripts/` — one-off utility scripts (not deployed)

## Database
- `users` — auth, plan_type, subscription_status, vessel_limit, allowed_canals (text[]), onboarding_completed, onboarding_step, account_type ('agent'|'operator'), vessel_limit_exceeded_at (agency over-limit timestamp), vessel_limit_notified_day (1/5/7 email dedup)
- `filings` — canal filings (canal: panama/suez/bosporus, user_id, status)
- `sp1_filings` — Bosporus SP-1 filings (full vessel + cargo + transit fields, compliance_score, filing_status enum, deadline tracking, soft delete)
- `malacca_filings` — Malacca Strait STRAITREP filings (vessel particulars, transit direction, speed, VHF/ISPS/pilotage flags, DG, compliance_score, soft delete)
- `cape_filings` — Cape of Good Hope ISPS pre-arrival filings (vessel particulars, voyage, ISPS level, last 10 ports, DG, SSO details, compliance_score, 96h deadline, soft delete)
- `analytics_events` — custom event tracking (session_id, event_name, properties)
- `site_assets` — R2 PDF asset registry (file_type, r2_url, original_url)
- `drip_emails` — email drip sequence state per lead
- `password_resets` — 1-hour reset tokens
- `sca_credentials` — AES-256-GCM encrypted SCA E-Services portal credentials (one per user)
- `sca_submissions` — SCA transit filing submission history (vessel, type, direction, status, sca_reference)
- `filing_deadlines` — per-vessel per-waterway deadline records for alert scheduling (deadline_at, waterway, filing_type, compliance_issues, alerts_enabled)
- `deadline_alert_log` — dedup log of sent deadline alerts (deadline_id, recipient, alert_window); prevents double-fire
- `waterway_alert_prefs` — user per-waterway alert preferences (enabled, alert_windows array)
- `pricing_slots` — founding slot counter (total_slots: 20, remaining_slots: live count)
- `pricing_slot_purchases` — dedup table keyed by stripe_session_id (idempotent decrement)
- `promo_redemptions` — promo code usage log (code, stripe_session_id dedup key, canal, vessels, timestamp)
- `voyages` — unified multi-waterway voyage records (vessel, route, waterways[], overall_score, status, soft delete)
- `voyage_waypoints` — per-waterway waypoints (waterway, eta, etd, filing_deadline, filing_status, compliance_score, filing_data jsonb)
- `direct_filing_waitlist` — demand capture for direct authority submission feature (email, company, fleet_size, authorities text[], comment)
- `integration_waitlist` — per-integration waitlist signups (email, integration_slug, company_name); dedup on (email, integration_slug)
- `geofence_zones` — canal approach zone config (center lat/lng, alert thresholds in nm per window)
- `geofence_events` — geofence trigger log (imo_number, waterway, alert_window, distance, alert_id FK, diversion flag)
- `vessel_positions` — AIS position records (imo_number, vessel_name, lat/lon, speed, heading, nav_status, source, timestamp); indexed on imo+timestamp
- `vessel_tracks` — materialised latest position + canal distances/ETAs per vessel (upserted each tick)
- `ais_provider_config` — active AIS provider config (mock/marinetraffic/vesselfinder/spire), poll_interval_sec, api_key
- `api_keys` — TMS integration API keys (SHA-256 hashed, prefix shown in UI, per-key usage stats)
- `inbound_vessels` / `inbound_voyages` / `inbound_crews` — canonical store for TMS-pushed data (API + webhook)
- `webhook_logs` — every webhook delivery (raw payload, mapped entities, status); `webhook_mappings` — field mapping templates
- `agent_clients` — principals managed by shipping agents (client_name, contact, company_type, user_id FK, is_active)
- `agent_client_vessels` — vessels linked to agent clients (imo_number, vessel_name, type, flag, waterways[])
- `org_approval_settings` — per-user approval workflow config (enabled, auto-approve, notify toggles)
- `filing_audit_log` — immutable event log for all workflow state transitions (filing_id, filing_type, action, actor, comment)
- `filing_review_comments` — inline reviewer comments on specific filing fields (field_name, resolved flag)
- `user_notifications` — in-app notification bell records (kind, title, body, filing_id, read flag)
- `demo_codes` — demo access codes (code UNIQUE, expires_at, max_uses, use_count, created_by, is_active, notes)
- `demo_sessions` — demo sessions keyed by session_token (demo_code_id FK, ip_address, user_agent, last_active_at, expires_at 48h)
- `demo_requests` — self-serve demo request leads (name, email, company, role, fleet_size, waterway, demo_code FK, ip_address, domain, email_sent_at, resend_count)
- `calculator_leads` — Rejection Exposure Calculator leads (email, company, fleet_size, monthly_transits, cargo_type, primary_waterway, filing_method, annual_exposure, with_canalclear, savings, pdf_sent)
- `vessels` — fleet vessel registry (user_id, name, imo, flag, type, gt, nt, loa, beam, max_draft, class_society, status, is_sample); extended by migration 1778750000000
- `fleet_compliance_cache` — per-vessel per-waterway validation snapshot (vessel_id, waterway, score, status, issues jsonb, validated_at); UNIQUE(vessel_id, waterway)
- `submission_attempts` — unified audit log for all auto-filing submission attempts (user_id, vessel_id, waterway, authority, channel, direction, payload jsonb, response_body, response_status, status enum, authority_reference, error_message, created_at, sent_at, acknowledged_at)
- `mpa_credentials` — AES-256-GCM encrypted MPA OCEANS-X API keys (one per user)
- `mpa_submissions` — MPA pre-arrival notification submission history (vessel, IMO, filing_type, direction, mpa_reference, oceans_x_vessel_data jsonb, status)
- `vtsc_submissions` — Turkish Straits VTSC SP-1 email submission log (user_id, filing_id, vts_center, recipient_email, message_hash, vtsc_reference, status)
- `samsa_submissions` — Cape Town Radio ISPS pre-arrival email submission log (user_id, filing_id, port_of_arrival, recipient_email, message_hash, samsa_reference, status)

## External integrations
- **Stripe** — owner's own Stripe account (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + STRIPE_LINK_* env vars); checkout: Agent Pro /api/checkout/subscribe, Ops Manager /api/checkout/ops-manager (pre-created links 1–10 via env vars, dynamic Stripe SDK 11+); Agency /api/checkout/agency; webhook at POST /api/webhooks/stripe; see STRIPE_SETUP.md
- **Postmark** — transactional email via Polsia proxy (POLSIA_API_KEY)
- **Cloudflare R2** — PDF storage via Polsia proxy
- **GA4** — G-HYJXEY6H3G (122+ pages)
- **Meta Pixel** — 972550615207303
- **MPA OCEANS-X** — vessel particulars + arrival data API (api.oceans-x.mpa.gov.sg/v1); user supplies their own API key stored AES-256-GCM encrypted

## Recent changes
- 2026-05-18: Stripe independence — replaced Polsia payment proxy with direct Stripe SDK integration; services/stripe.js (getPaymentLink/createCheckoutSession/verifyCheckoutSession/constructWebhookEvent); routes/stripe-webhooks.js (POST /api/webhooks/stripe — direct Stripe signature verification, handles checkout.session.completed/subscription.updated/deleted/invoice events); all 100+ hardcoded buy.stripe.com links replaced with getPaymentLink(envKey, fallback) pattern; dynamic checkout now uses owner's STRIPE_SECRET_KEY + price ID env vars; STRIPE_SETUP.md documents full setup; zero breaking changes — falls back to legacy Polsia links until owner sets STRIPE_LINK_* env vars.
- 2026-05-18: Domain migration — replaced all 87 occurrences of `canal-clear.polsia.app` with `canalclear.org` across 87 files (services, routes, public HTML, blog posts, robots.txt, scripts); added BASE_URL constant to server.js (env var `BASE_URL`, defaults to `https://canalclear.org`) exposed as `app.locals.BASE_URL` for future one-line domain changes.
- 2026-05-18: Onboarding UX improvements — GET /api/onboarding/progress endpoint (db/users.js getOnboardingProgress, cross-table aggregation: vessels + all filing types + portal credentials); progress checklist bar in app.html (4-step: Add vessel → Run check → Submit → Connect portal, dismissible, hides when all done); first-vessel prompt in fleet.html (bottom-of-screen card after saving first vessel → "Run Check →" CTA); contextual "?" tooltips on compliance badge header (green/yellow/red legend), stats bar (Passed + Active Deadlines), portal nav dots.
- 2026-05-14: Portal reachability fixed — replaced broken client-side no-cors HEAD fetch (opaque responses always resolve, cannot distinguish online/offline) with server-side proxy endpoint GET /api/portals/reachability; routes/portals.js does real HEAD checks with 60s in-memory cache + rejectUnauthorized:false for gov cert quirks; portals.html updated to call API instead of direct fetch; info banner text corrected.
- 2026-05-14: SAMSA Cape Town Radio email auto-submission (Cape of Good Hope ISPS) — samsa_submissions table (migration 1778800000000); services/samsa-portal.js (ISPS pre-arrival formatter per SAMSA Marine Notice 12/2008, plain text no attachments, Polsia proxy delivery, SHA-256 message hash audit); db/samsa-portal.js (submission history + audit log writes); POST /api/cape/submit (send ISPS to Cape Town Radio ZSC, updates filing status, writes audit trail), GET/POST submissions + resubmit routes added to routes/cape.js; "Submit to Cape Town Radio" card + submitToSAMSA() added to demo-cape.html; Authority: SAMSA (South African Maritime Safety Authority).

