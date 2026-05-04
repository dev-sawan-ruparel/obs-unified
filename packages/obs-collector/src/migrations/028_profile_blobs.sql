-- RFC 0007 — pprof profiling receiver storage.
--
-- Two tables:
--   profile_blobs        — one row per ingested pprof blob (cpu / heap /
--                          off-cpu / mutex / etc). The blob itself lives
--                          in R2 (Workers) or filesystem (Node), keyed by
--                          blob_url; this table is the metadata index.
--   profile_trace_index  — one row per (profile, trace) pair so the
--                          trace waterfall can join in O(1) on trace_id.
--                          Populated at ingest from the
--                          x-obs-trace-ids header (Phase 4 minimal) or
--                          by parsing the pprof on later iterations.
--
-- The blob index uses an explicit join table rather than a JSON column
-- so a 60s profile from a high-traffic service touching thousands of
-- traces doesn't blow past D1's 2 MB row limit (see RFC 0007 §
-- profile_trace_index rationale).

CREATE TABLE IF NOT EXISTS profile_blobs (
  id TEXT PRIMARY KEY,                    -- ULID minted at ingest
  project_id TEXT NOT NULL,
  service_name TEXT,
  profile_type TEXT NOT NULL,             -- 'cpu' | 'heap' | 'wall' | 'block' | 'mutex' | 'goroutine' | 'offcpu'
  start_ts TEXT NOT NULL,                 -- ISO8601 — beginning of sampled window
  end_ts TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  blob_size_bytes INTEGER NOT NULL,
  blob_url TEXT NOT NULL,                 -- R2 key or filesystem path
  sample_count INTEGER,                   -- total samples (nullable — header-driven path doesn't know)
  agent TEXT,                             -- 'datadog-pprof' | 'pyroscope' | 'parca-agent' | 'otel-ebpf' | unknown
  resource_attrs_json TEXT,               -- service.name, host.name, etc.
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_service_ts
  ON profile_blobs (project_id, service_name, end_ts DESC);

CREATE INDEX IF NOT EXISTS idx_profile_blobs_expires
  ON profile_blobs (expires_at);

-- Trace→profile join. One row per (profile, trace) pair. ~50 bytes per row;
-- a profile sampling 5,000 distinct traces produces ~250 KB of join-table
-- rows, indexed for sub-ms lookup.
CREATE TABLE IF NOT EXISTS profile_trace_index (
  profile_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,               -- denormalized for retention sweep
  PRIMARY KEY (profile_id, trace_id),
  FOREIGN KEY (profile_id) REFERENCES profile_blobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_profile_trace_index_trace
  ON profile_trace_index (project_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_profile_trace_index_profile
  ON profile_trace_index (profile_id);
