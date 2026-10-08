-- RFC 0011 — materialized evidence retrieval refs and expansion telemetry.

CREATE TABLE IF NOT EXISTS evidence_retrieval_refs (
  ref_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  anchor_kind TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  query_json JSONB,
  compacted_from_json JSONB,
  returned_json JSONB,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_evidence_refs_project_seen
  ON evidence_retrieval_refs (project_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_refs_project_kind
  ON evidence_retrieval_refs (project_id, kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_refs_project_anchor
  ON evidence_retrieval_refs (project_id, anchor_kind, anchor_id);

CREATE TABLE IF NOT EXISTS evidence_ref_expansions (
  id TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  operation TEXT NOT NULL,
  result_status TEXT NOT NULL,
  limit_value INTEGER,
  query_text TEXT,
  expanded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_time
  ON evidence_ref_expansions (project_id, expanded_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_ref
  ON evidence_ref_expansions (project_id, ref_id, expanded_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_kind
  ON evidence_ref_expansions (project_id, kind, expanded_at DESC);
