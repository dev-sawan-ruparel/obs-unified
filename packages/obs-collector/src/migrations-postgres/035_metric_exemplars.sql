-- Reverse index for OTLP metric exemplars.
--
-- metric_point.exemplars_json preserves the raw exemplar payload on the point,
-- but investigation flows need trace/span lookup without scanning JSON blobs.
-- This table turns exemplars into first-class correlation edges.

CREATE TABLE IF NOT EXISTS metric_exemplars (
  id TEXT PRIMARY KEY,
  point_id TEXT NOT NULL REFERENCES metric_point(id),
  series_id TEXT NOT NULL REFERENCES metric_series(id),
  project_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  service_name TEXT,
  trace_id TEXT,
  span_id TEXT,
  ts_ns TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metric_exemplars_project_trace
  ON metric_exemplars (project_id, trace_id, ts_ns)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_exemplars_project_span
  ON metric_exemplars (project_id, trace_id, span_id, ts_ns)
  WHERE trace_id IS NOT NULL AND span_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_metric_exemplars_expires
  ON metric_exemplars (expires_at);
