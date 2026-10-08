-- RFC 0007 — pprof profiling receiver storage.
--
-- Postgres translation of the D1 profile metadata/index tables. Blob bytes live
-- in S3-compatible storage; these tables make profiles discoverable by id,
-- service, and trace.

CREATE TABLE IF NOT EXISTS profile_blobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  service_name TEXT,
  profile_type TEXT NOT NULL,
  start_ts TEXT NOT NULL,
  end_ts TEXT NOT NULL,
  duration_ms BIGINT NOT NULL,
  blob_size_bytes BIGINT NOT NULL,
  blob_url TEXT NOT NULL,
  sample_count BIGINT,
  agent TEXT,
  resource_attrs_json JSONB,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_service_ts
  ON profile_blobs (project_id, service_name, end_ts DESC);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_expires
  ON profile_blobs (expires_at);

-- Postgres-only GIN index so the dashboard read paths can query against
-- resource attributes (service.version, deployment.environment, etc.).
-- Matches the JSONB+GIN pattern from 001 and 031.
CREATE INDEX IF NOT EXISTS idx_profile_blobs_resource_attrs_gin
  ON profile_blobs USING GIN (resource_attrs_json);

CREATE TABLE IF NOT EXISTS profile_trace_index (
  profile_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, trace_id),
  FOREIGN KEY (profile_id) REFERENCES profile_blobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profile_trace_index_trace
  ON profile_trace_index (project_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_profile_trace_index_profile
  ON profile_trace_index (profile_id);
