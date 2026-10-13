-- Migration 046: action graph tables keyed by (project_id, id)
--
-- The RFC 0010 spine and leaf tables (031) used `id TEXT PRIMARY KEY`.
-- Action ids are client-supplied (`obs.action.id`) and leaf ids are raw
-- OTel span ids, so two projects can legitimately emit the same id. The
-- stores upserted with ON CONFLICT(id) DO UPDATE SET project_id = ..., which
-- let one tenant move or overwrite another tenant's row.
--
-- Rebuilds all six tables with PRIMARY KEY (project_id, id), preserving every
-- row, column default and index (031, 038, 044). The old key was unique, so
-- the composite key cannot collide. Re-running the file is a no-op in effect.

-- 1. actions
DROP TABLE IF EXISTS actions_new;

CREATE TABLE actions_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  root_action_id TEXT NOT NULL,
  caused_by_action_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action_kind TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  trace_id TEXT,
  span_id TEXT,
  session_id TEXT,
  interaction_id TEXT,
  user_id TEXT,
  agent_run_id TEXT,
  step_id TEXT,
  tool_call_id TEXT,
  prompt_version TEXT,
  model_name TEXT,
  provider TEXT,
  total_cost_usd REAL,
  attrs_json TEXT,
  PRIMARY KEY (project_id, id)
);

INSERT INTO actions_new (
  project_id, id, root_action_id, caused_by_action_id, actor_type, actor_id,
  action_kind, name, status, started_at, ended_at, duration_ms, trace_id,
  span_id, session_id, interaction_id, user_id, agent_run_id, step_id,
  tool_call_id, prompt_version, model_name, provider, total_cost_usd, attrs_json
)
SELECT
  project_id, id, root_action_id, caused_by_action_id, actor_type, actor_id,
  action_kind, name, COALESCE(status, 'ok'), started_at, ended_at, duration_ms,
  trace_id, span_id, session_id, interaction_id, user_id, agent_run_id, step_id,
  tool_call_id, prompt_version, model_name, provider, total_cost_usd, attrs_json
FROM actions;

DROP TABLE actions;

ALTER TABLE actions_new RENAME TO actions;

CREATE INDEX IF NOT EXISTS idx_actions_project_root
  ON actions (project_id, root_action_id, started_at);
CREATE INDEX IF NOT EXISTS idx_actions_project_actor
  ON actions (project_id, actor_type, actor_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_project_trace
  ON actions (project_id, trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actions_project_interaction
  ON actions (project_id, interaction_id)
  WHERE interaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actions_project_agent_run
  ON actions (project_id, agent_run_id, started_at)
  WHERE agent_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_actions_started_at
  ON actions (started_at);

-- 2. agent_runs
DROP TABLE IF EXISTS agent_runs_new;

CREATE TABLE agent_runs_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  goal TEXT,
  outcome TEXT,
  autonomy_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  total_cost_usd REAL DEFAULT 0.0,
  total_duration_ms INTEGER,
  metadata_json TEXT,
  PRIMARY KEY (project_id, id)
);

INSERT INTO agent_runs_new (
  project_id, id, agent_id, agent_name, agent_version, goal, outcome,
  autonomy_level, status, error_message, total_cost_usd, total_duration_ms,
  metadata_json
)
SELECT
  project_id, id, agent_id, agent_name, agent_version, goal, outcome,
  autonomy_level, COALESCE(status, 'running'), error_message, total_cost_usd,
  total_duration_ms, metadata_json
FROM agent_runs;

DROP TABLE agent_runs;

ALTER TABLE agent_runs_new RENAME TO agent_runs;

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_agent
  ON agent_runs (project_id, agent_id, status);

-- 3. tool_calls (031 columns + 038 evidence columns)
DROP TABLE IF EXISTS tool_calls_new;

CREATE TABLE tool_calls_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  error_type TEXT,
  side_effect INTEGER NOT NULL DEFAULT 0,
  approval_state TEXT,
  args_redacted TEXT,
  result_redacted TEXT,
  mcp_audit_json TEXT,
  mutation_before_json TEXT,
  mutation_after_json TEXT,
  mutation_diff_json TEXT,
  mutation_artifact_id TEXT,
  PRIMARY KEY (project_id, id)
);

INSERT INTO tool_calls_new (
  project_id, id, action_id, tool_name, args_hash, result_hash, error_type,
  side_effect, approval_state, args_redacted, result_redacted, mcp_audit_json,
  mutation_before_json, mutation_after_json, mutation_diff_json,
  mutation_artifact_id
)
SELECT
  project_id, id, action_id, tool_name, args_hash, result_hash, error_type,
  COALESCE(side_effect, 0), approval_state, args_redacted, result_redacted,
  mcp_audit_json, mutation_before_json, mutation_after_json,
  mutation_diff_json, mutation_artifact_id
FROM tool_calls;

DROP TABLE tool_calls;

ALTER TABLE tool_calls_new RENAME TO tool_calls;

CREATE INDEX IF NOT EXISTS idx_tool_calls_action
  ON tool_calls (action_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name
  ON tool_calls (project_id, tool_name);

-- 4. retrieval_events
DROP TABLE IF EXISTS retrieval_events_new;

CREATE TABLE retrieval_events_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  retriever_name TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  documents_json TEXT,
  total_results INTEGER NOT NULL DEFAULT 0,
  max_relevance_score REAL,
  duration_ms INTEGER,
  PRIMARY KEY (project_id, id)
);

INSERT INTO retrieval_events_new (
  project_id, id, action_id, retriever_name, query_hash, documents_json,
  total_results, max_relevance_score, duration_ms
)
SELECT
  project_id, id, action_id, retriever_name, query_hash, documents_json,
  COALESCE(total_results, 0), max_relevance_score, duration_ms
FROM retrieval_events;

DROP TABLE retrieval_events;

ALTER TABLE retrieval_events_new RENAME TO retrieval_events;

CREATE INDEX IF NOT EXISTS idx_retrieval_events_action
  ON retrieval_events (action_id);

-- 5. eval_results
DROP TABLE IF EXISTS eval_results_new;

CREATE TABLE eval_results_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  evaluator_name TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  score REAL,
  passed INTEGER NOT NULL DEFAULT 1,
  reasoning TEXT,
  rubric_json TEXT,
  PRIMARY KEY (project_id, id)
);

INSERT INTO eval_results_new (
  project_id, id, action_id, evaluator_name, evaluator_version, score, passed,
  reasoning, rubric_json
)
SELECT
  project_id, id, action_id, evaluator_name, evaluator_version, score,
  COALESCE(passed, 1), reasoning, rubric_json
FROM eval_results;

DROP TABLE eval_results;

ALTER TABLE eval_results_new RENAME TO eval_results;

CREATE INDEX IF NOT EXISTS idx_eval_results_action
  ON eval_results (action_id);

-- 6. artifacts
DROP TABLE IF EXISTS artifacts_new;

CREATE TABLE artifacts_new (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  artifact_name TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_ref TEXT,
  size_bytes INTEGER,
  sha256_hash TEXT,
  content_preview TEXT,
  PRIMARY KEY (project_id, id)
);

INSERT INTO artifacts_new (
  project_id, id, action_id, artifact_name, artifact_type, storage_ref,
  size_bytes, sha256_hash, content_preview
)
SELECT
  project_id, id, action_id, artifact_name, artifact_type, storage_ref,
  size_bytes, sha256_hash, content_preview
FROM artifacts;

DROP TABLE artifacts;

ALTER TABLE artifacts_new RENAME TO artifacts;

CREATE INDEX IF NOT EXISTS idx_artifacts_action
  ON artifacts (action_id);
