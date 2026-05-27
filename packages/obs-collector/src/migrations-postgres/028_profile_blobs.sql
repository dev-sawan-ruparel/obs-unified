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
  duration_ms INTEGER NOT NULL,
  blob_size_bytes INTEGER NOT NULL,
  blob_url TEXT NOT NULL,
  sample_count INTEGER,
  agent TEXT,
  resource_attrs_json TEXT,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_service_ts
  ON profile_blobs (project_id, service_name, end_ts DESC);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_expires
  ON profile_blobs (expires_at);

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
