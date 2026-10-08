-- Side table for large prompt/completion/tool/retrieval payloads attached
-- to OpenInference-kind spans (LLM/CHAIN/RETRIEVER/EMBEDDING/TOOL/AGENT/...).
--
-- Spans themselves continue to live in telemetry_spans — this table only
-- holds the input/output blobs that would otherwise bloat the hot spans
-- table. Keyed by (trace_id, span_id) so a join against telemetry_spans
-- reconstructs the full AI span.
--
-- Retention mirrors telemetry_spans: entries are purged when expires_at
-- elapses. span_kind is denormalized from attributes_json for cheap
-- filtering without json_extract.

CREATE TABLE IF NOT EXISTS ai_span_payloads (
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  span_kind TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
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
