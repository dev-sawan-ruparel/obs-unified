CREATE TABLE IF NOT EXISTS telemetry_spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  service_name TEXT,
  scope_name TEXT,
  scope_version TEXT,
  span_name TEXT NOT NULL,
  span_kind INTEGER,
  status_code INTEGER,
  status_message TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  attributes_json TEXT,
  resource_attributes_json TEXT,
  events_json TEXT,
  links_json TEXT,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_spans_received_at ON telemetry_spans (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON telemetry_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON telemetry_spans (service_name);
CREATE INDEX IF NOT EXISTS idx_spans_status ON telemetry_spans (status_code);
CREATE INDEX IF NOT EXISTS idx_spans_root ON telemetry_spans (parent_span_id, received_at DESC);
