CREATE TABLE IF NOT EXISTS ai_span_payloads (
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  span_kind TEXT NOT NULL,
  input_json JSONB,
  output_json JSONB,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_payloads_received
  ON ai_span_payloads (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_project
  ON ai_span_payloads (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_kind
  ON ai_span_payloads (project_id, span_kind, received_at DESC);
