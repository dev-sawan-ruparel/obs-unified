-- ============================================================================
-- Migration 050: AutoSRE Causal Ontology, Change Correlation & Incident Memory
-- (RFC 0013)
-- ============================================================================

-- 0. Denormalize environment, version, and target_node_id onto existing tables
--    for O(log N) cohort rate lift and cross-trace contention queries.
ALTER TABLE telemetry_spans ADD COLUMN environment TEXT NOT NULL DEFAULT 'default';
ALTER TABLE telemetry_spans ADD COLUMN service_version TEXT;
ALTER TABLE telemetry_spans ADD COLUMN commit_sha TEXT;
ALTER TABLE telemetry_spans ADD COLUMN target_node_id TEXT;
ALTER TABLE telemetry_spans ADD COLUMN error_signature TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_cohort_attribution
  ON telemetry_spans (project_id, environment, service_name, service_version, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_contention_lookup
  ON telemetry_spans (project_id, environment, target_node_id, start_time, end_time)
  WHERE target_node_id IS NOT NULL;

ALTER TABLE actions ADD COLUMN environment TEXT NOT NULL DEFAULT 'default';
ALTER TABLE actions ADD COLUMN service_version TEXT;
ALTER TABLE actions ADD COLUMN target_node_id TEXT;

-- Extend eval_runs and add eval_case_results for verifiable PairedCounterfactualProof
ALTER TABLE eval_runs ADD COLUMN environment TEXT NOT NULL DEFAULT 'default';
ALTER TABLE eval_runs ADD COLUMN service_version TEXT;
ALTER TABLE eval_runs ADD COLUMN commit_sha TEXT;
ALTER TABLE eval_runs ADD COLUMN config_digest TEXT;
ALTER TABLE eval_runs ADD COLUMN input_payload_hash TEXT;
ALTER TABLE eval_runs ADD COLUMN failure_fingerprint TEXT;

ALTER TABLE eval_case_results ADD COLUMN input_payload_hash TEXT;
ALTER TABLE eval_case_results ADD COLUMN failure_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_eval_case_results_counterfactual
  ON eval_case_results (project_id, eval_case_id, input_payload_hash, passed);

-- 1. Environment-Scoped Persistent Operational Ontology Nodes
CREATE TABLE IF NOT EXISTS ontology_nodes (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  namespace_or_endpoint TEXT NOT NULL DEFAULT 'default',
  is_scoped_identity INTEGER NOT NULL DEFAULT 1,
  current_version TEXT,
  current_commit_sha TEXT,
  current_config_digest TEXT,
  attributes_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (project_id, environment, id)
);

-- 2. Directed Operational Ontology Edges (Cycles Permitted; Handled via Tarjan SCC)
CREATE TABLE IF NOT EXISTS ontology_edges (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  relationship_certainty TEXT NOT NULL DEFAULT 'exact',
  call_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_duration_ms REAL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (project_id, environment, id)
);

CREATE INDEX IF NOT EXISTS idx_ontology_edges_source
  ON ontology_edges (project_id, environment, source_node_id);

CREATE INDEX IF NOT EXISTS idx_ontology_edges_target
  ON ontology_edges (project_id, environment, target_node_id);

-- 3. Explicit & Inferred Change Events
CREATE TABLE IF NOT EXISTS change_events (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  relationship_certainty TEXT NOT NULL DEFAULT 'exact',
  summary TEXT NOT NULL,
  service_name TEXT,
  version TEXT,
  previous_version TEXT,
  commit_sha TEXT,
  previous_commit_sha TEXT,
  config_digest TEXT,
  repository_url TEXT,
  pull_request_url TEXT,
  actor_id TEXT,
  caused_by_action_id TEXT,
  agent_run_id TEXT,
  touched_paths_json TEXT,
  attributes_json TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (project_id, environment, id)
);

CREATE INDEX IF NOT EXISTS idx_change_events_node_time
  ON change_events (project_id, environment, target_node_id, occurred_at DESC);

-- 4. Durable Incident Investigations & Runner Lease Coordination
CREATE TABLE IF NOT EXISTS incident_investigations (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  target_node_id TEXT NOT NULL,
  symptom_anchor_kind TEXT NOT NULL,
  symptom_anchor_id TEXT NOT NULL,
  symptom_fingerprint TEXT,
  alert_count INTEGER NOT NULL DEFAULT 1,
  latest_bundle_json TEXT,
  lease_owner_id TEXT,
  lease_expires_at TEXT,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  last_dispatched_at TEXT,
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  expires_at TEXT,
  PRIMARY KEY (project_id, environment, id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_active_dedup
  ON incident_investigations (project_id, environment, dedup_key, status);

-- 5. Closed-Loop Investigation Findings (Separating Recovery vs Causal Proof)
CREATE TABLE IF NOT EXISTS investigation_findings (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  incident_id TEXT,
  fingerprint TEXT NOT NULL,
  fingerprint_input_json TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  causal_proof_tier TEXT NOT NULL DEFAULT 'unverified_locus',
  confidence REAL NOT NULL,
  confidence_breakdown_json TEXT NOT NULL,
  symptom_entity_kind TEXT NOT NULL,
  symptom_entity_id TEXT NOT NULL,
  fault_locus_entity_kind TEXT NOT NULL,
  fault_locus_entity_id TEXT NOT NULL,
  root_cause_entity_kind TEXT,
  root_cause_entity_id TEXT,
  contributing_change_id TEXT,
  cohort_verdict TEXT,
  contending_trace_id TEXT,
  causal_chain_json TEXT NOT NULL,
  cited_evidence_ids_json TEXT NOT NULL,
  code_references_json TEXT,
  counterfactual_proof_json TEXT,
  recovery_status TEXT NOT NULL DEFAULT 'not_applicable',
  causal_verification_status TEXT NOT NULL DEFAULT 'unverified',
  watchdog_step INTEGER NOT NULL DEFAULT 0,
  baseline_request_rate_per_min REAL,
  next_watchdog_check_at TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  agent_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (project_id, environment, id)
);

CREATE INDEX IF NOT EXISTS idx_findings_fingerprint
  ON investigation_findings (project_id, environment, fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_findings_watchdog
  ON investigation_findings (project_id, recovery_status, next_watchdog_check_at);

-- 6. Pre-Execution Remediation Proposals & Single-Use Grants
CREATE TABLE IF NOT EXISTS remediation_proposals (
  project_id TEXT NOT NULL DEFAULT 'default',
  environment TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_kind TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  expected_current_state_json TEXT NOT NULL,
  desired_target_state_json TEXT NOT NULL,
  requested_autonomy TEXT NOT NULL,
  effective_autonomy TEXT NOT NULL,
  policy_decision_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  grant_token_hash TEXT,
  grant_expires_at TEXT,
  approved_by_user_id TEXT,
  approved_at TEXT,
  claimed_by_runner_id TEXT,
  claimed_at TEXT,
  claim_expires_at TEXT,
  remediation_agent_run_id TEXT,
  resulting_change_id TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (project_id, environment, id),
  UNIQUE (project_id, environment, idempotency_key)
);
