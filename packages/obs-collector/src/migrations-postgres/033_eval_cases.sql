-- RFC 0010 Phase 7: production-to-eval case persistence.
--
-- Eval cases are reusable fixtures captured from production telemetry. They
-- retain stable source links back to the production entity that created the
-- case while keeping prompts/payloads in explicitly redacted JSON fields.

CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_entity_type TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  source_agent_run_id TEXT,
  source_action_id TEXT,
  source_ai_call_id TEXT,
  source_tool_call_id TEXT,
  source_trace_id TEXT,
  source_span_id TEXT,
  name TEXT NOT NULL,
  expected_outcome TEXT,
  rubric_json JSONB,
  redacted_prompt_json JSONB,
  reference_payload_json JSONB,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_cases_project_created
  ON eval_cases (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_cases_project_source
  ON eval_cases (project_id, source_entity_type, source_entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_cases_agent_run
  ON eval_cases (project_id, source_agent_run_id)
  WHERE source_agent_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_cases_action
  ON eval_cases (project_id, source_action_id)
  WHERE source_action_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_cases_ai_call
  ON eval_cases (project_id, source_ai_call_id)
  WHERE source_ai_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_cases_tool_call
  ON eval_cases (project_id, source_tool_call_id)
  WHERE source_tool_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_cases_trace
  ON eval_cases (project_id, source_trace_id)
  WHERE source_trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_cases_metadata_gin
  ON eval_cases USING GIN (metadata_json);
