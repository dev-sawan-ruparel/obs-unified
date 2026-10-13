-- Migration 047: ai_span_payloads composite primary key
-- (project_id, trace_id, span_id)
--
-- 019 keyed the payload side table by (trace_id, span_id) only, and the
-- processor upserted with ON CONFLICT(trace_id, span_id) DO UPDATE SET
-- project_id = excluded.project_id. Trace and span ids are produced by the
-- client SDK, so a second project emitting the same ids replaced the first
-- project's prompt/completion payloads and took ownership of the row.
--
-- Rebuilds the table with PRIMARY KEY (project_id, trace_id, span_id),
-- preserving every row and every index (019, 021, 031). Columns come from
-- 019 + 021 + 027 + 031 + 032. Re-running the file is a no-op in effect.

DROP TABLE IF EXISTS ai_span_payloads_new;

CREATE TABLE ai_span_payloads_new (
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  span_kind TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  session_id TEXT,
  user_id TEXT,
  interaction_id TEXT,
  action_id TEXT,
  input_hash TEXT,
  output_hash TEXT,
  PRIMARY KEY (project_id, trace_id, span_id)
);

INSERT INTO ai_span_payloads_new (
  project_id, trace_id, span_id, span_kind, input_json, output_json,
  received_at, expires_at, session_id, user_id, interaction_id, action_id,
  input_hash, output_hash
)
SELECT
  project_id, trace_id, span_id, span_kind, input_json, output_json,
  received_at, expires_at, session_id, user_id, interaction_id, action_id,
  input_hash, output_hash
FROM ai_span_payloads;

DROP TABLE ai_span_payloads;

ALTER TABLE ai_span_payloads_new RENAME TO ai_span_payloads;

CREATE INDEX IF NOT EXISTS idx_ai_payloads_received
  ON ai_span_payloads (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_project
  ON ai_span_payloads (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_kind
  ON ai_span_payloads (project_id, span_kind, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_session
  ON ai_span_payloads (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_user
  ON ai_span_payloads (project_id, user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_action
  ON ai_span_payloads (project_id, action_id)
  WHERE action_id IS NOT NULL;
