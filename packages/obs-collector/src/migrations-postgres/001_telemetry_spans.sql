CREATE TABLE IF NOT EXISTS telemetry_spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  service_name TEXT,
  scope_name TEXT,
  scope_version TEXT,
  span_name TEXT NOT NULL,
  span_kind BIGINT,
  status_code BIGINT,
  status_message TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  attributes_json JSONB,
  resource_attributes_json JSONB,
  events_json JSONB,
  links_json JSONB,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_spans_received_at ON telemetry_spans (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON telemetry_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON telemetry_spans (service_name);
CREATE INDEX IF NOT EXISTS idx_spans_status ON telemetry_spans (status_code);
CREATE INDEX IF NOT EXISTS idx_spans_root ON telemetry_spans (parent_span_id, received_at DESC);

-- Postgres-only: GIN index on attributes_json enables fast JSONB
-- containment queries used by the dashboard's attribute filter.
CREATE INDEX IF NOT EXISTS idx_spans_attributes_gin
  ON telemetry_spans USING GIN (attributes_json);
