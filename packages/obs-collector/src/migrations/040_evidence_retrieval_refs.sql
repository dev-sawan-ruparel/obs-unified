-- RFC 0011 — materialized evidence retrieval refs and expansion telemetry.
--
-- Encoded refs remain portable handles. This table gives the product a durable
-- view of which refs were issued and which ones agents actually expand.

CREATE TABLE IF NOT EXISTS evidence_retrieval_refs (
  ref_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  anchor_kind TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  query_json TEXT,
  compacted_from_json TEXT,
  returned_json TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
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
  expanded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_time
  ON evidence_ref_expansions (project_id, expanded_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_ref
  ON evidence_ref_expansions (project_id, ref_id, expanded_at DESC);

CREATE INDEX IF NOT EXISTS idx_evidence_expansions_project_kind
  ON evidence_ref_expansions (project_id, kind, expanded_at DESC);
