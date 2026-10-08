-- OTLP metrics storage.
--
-- Two tables:
--   metric_series — one row per unique (resource, scope, metric name, metric
--                   attrs) tuple. Upserted on ingest.
--   metric_point  — one row per datapoint. FK to metric_series.
--
-- Histogram-specific fields on metric_point are nullable (only populated for
-- type='histogram'). Gauge/sum write `value`. Exponential histograms and
-- Summary are not yet supported (Phase 5).

CREATE TABLE IF NOT EXISTS metric_series (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT,
  type TEXT NOT NULL,                 -- 'gauge' | 'sum' | 'histogram'
  is_monotonic INTEGER,               -- 0/1 — sum only
  temporality INTEGER,                -- 1=DELTA, 2=CUMULATIVE — sum/histogram
  scope_name TEXT,
  scope_version TEXT,
  service_name TEXT,
  resource_attrs_json TEXT,
  attributes_json TEXT,
  identity TEXT NOT NULL,             -- canonical JSON of identity tuple
  created_at TEXT NOT NULL,
  UNIQUE(project_id, identity)
);

CREATE INDEX IF NOT EXISTS idx_metric_series_project_name
  ON metric_series (project_id, name);

CREATE TABLE IF NOT EXISTS metric_point (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  project_id TEXT NOT NULL,           -- denormalized for retention sweep
  ts_ns TEXT NOT NULL,                -- uint64 as decimal string
  start_ts_ns TEXT,
  value REAL,                         -- gauge/sum scalar
  count INTEGER,                      -- histogram
  sum REAL,                           -- histogram
  min REAL,                           -- histogram
  max REAL,                           -- histogram
  bounds_json TEXT,                   -- histogram bucket upper bounds (number[])
  bucket_counts_json TEXT,            -- histogram bucket counts (number[])
  exemplars_json TEXT,                -- array of {value, traceId?, spanId?, tsNs}
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (series_id) REFERENCES metric_series(id)
);

CREATE INDEX IF NOT EXISTS idx_metric_point_series_ts
  ON metric_point (series_id, ts_ns);
CREATE INDEX IF NOT EXISTS idx_metric_point_expires
  ON metric_point (expires_at);
CREATE INDEX IF NOT EXISTS idx_metric_point_project_received
  ON metric_point (project_id, received_at DESC);
