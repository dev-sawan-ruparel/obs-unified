CREATE TABLE IF NOT EXISTS metric_series (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT,
  type TEXT NOT NULL,
  is_monotonic INTEGER,
  temporality INTEGER,
  scope_name TEXT,
  scope_version TEXT,
  service_name TEXT,
  resource_attrs_json JSONB,
  attributes_json JSONB,
  identity TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, identity)
);

CREATE INDEX IF NOT EXISTS idx_metric_series_project_name
  ON metric_series (project_id, name);

CREATE TABLE IF NOT EXISTS metric_point (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  ts_ns TEXT NOT NULL,
  start_ts_ns TEXT,
  value DOUBLE PRECISION,
  count BIGINT,
  sum DOUBLE PRECISION,
  min DOUBLE PRECISION,
  max DOUBLE PRECISION,
  bounds_json JSONB,
  bucket_counts_json JSONB,
  exemplars_json JSONB,
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
