-- RFC 0010: Agent Action Graph Spine Schema (Phase 1)
--
-- Creates the action spine and detail leaf tables, and extends existing tables 
-- to support higher-level causal action tracing for agentic systems.

-- 1. General Action Spine
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,                       -- Unique ULID / ID for this action
  project_id TEXT NOT NULL,                  -- Project scope
  root_action_id TEXT NOT NULL,              -- ULID of the root causal action
  caused_by_action_id TEXT,                  -- ULID of the parent causal action
  actor_type TEXT NOT NULL,                  -- human, agent, service, workflow, system
  actor_id TEXT,                             -- ID of the actor initiating this action
  action_kind TEXT NOT NULL,                 -- agent.run, agent.step, llm.call, tool.call, retrieval, eval, etc.
  name TEXT,                                 -- Human readable name
  status TEXT NOT NULL DEFAULT 'ok',         -- ok, error
  started_at TEXT NOT NULL,                  -- ISO8601 timestamp
  ended_at TEXT,                             -- ISO8601 timestamp
  duration_ms INTEGER,                       -- Execution duration
  trace_id TEXT,                             -- Optional linked OTel trace ID
  span_id TEXT,                              -- Optional linked OTel span ID
  session_id TEXT,                           -- Optional browser/user session
  interaction_id TEXT,                       -- Optional click-scoped correlation key
  user_id TEXT,                              -- Optional user ID
  agent_run_id TEXT,                         -- Optional linked Agent Run ID
  step_id TEXT,                              -- Optional linked Step ID
  tool_call_id TEXT,                         -- Optional linked Tool Call ID
  prompt_version TEXT,                       -- Denormalized prompt version
  model_name TEXT,                           -- Denormalized LLM model name
  provider TEXT,                             -- Denormalized LLM provider name
  total_cost_usd DOUBLE PRECISION,           -- Denormalized token/tool cost
  attrs_json JSONB                           -- Arbitrary JSON key-value store for plugin/custom data
);

-- Indices for fast spine traversal
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

-- Postgres-only GIN index
CREATE INDEX IF NOT EXISTS idx_actions_attrs_gin
  ON actions USING GIN (attrs_json);


-- 2. Detail Leaf: Agent Runs
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,                       -- Matches actions.id for the run's root action
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,                    -- Stable identifier of the agent template/codebase
  agent_name TEXT NOT NULL,                  -- Human-readable name of the agent
  agent_version TEXT NOT NULL,               -- Version of agent configuration/strategy
  goal TEXT,                                 -- High-level prompt or goal of the run
  outcome TEXT,                              -- Final answer, result summary, or output
  autonomy_level TEXT NOT NULL,              -- read_only, suggested_action, human_approved_write, autonomous_write, blocked_by_policy
  status TEXT NOT NULL DEFAULT 'running',    -- running, success, failed
  error_message TEXT,                        -- Optional error string
  total_cost_usd DOUBLE PRECISION DEFAULT 0.0,
  total_duration_ms INTEGER,
  metadata_json JSONB                        -- Opt-in debug metadata
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_project_agent
  ON agent_runs (project_id, agent_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_runs_metadata_gin
  ON agent_runs USING GIN (metadata_json);


-- 3. Detail Leaf: Tool Calls
CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,                       -- Unique identifier (often matches OTel span_id or actions.id)
  action_id TEXT NOT NULL,                   -- Links back to actions.id
  project_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,                   -- Named tool (e.g. sql_query, fetch_invoice)
  args_hash TEXT NOT NULL,                   -- SHA256 of args for privacy-preserving cache key
  result_hash TEXT NOT NULL,                 -- SHA256 of result for parity verification
  error_type TEXT,                           -- Optional error classifier (e.g. timeout, auth)
  side_effect INTEGER NOT NULL DEFAULT 0,    -- Boolean (0/1): does this tool mutate state?
  approval_state TEXT,                       -- suggested, human_approved, bypassed, blocked
  args_redacted JSONB,                       -- Opt-in redacted parameters JSON
  result_redacted JSONB                      -- Opt-in redacted result JSON
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_action
  ON tool_calls (action_id);

CREATE INDEX IF NOT EXISTS idx_tool_calls_name
  ON tool_calls (project_id, tool_name);

CREATE INDEX IF NOT EXISTS idx_tool_calls_args_redacted_gin
  ON tool_calls USING GIN (args_redacted);

CREATE INDEX IF NOT EXISTS idx_tool_calls_result_redacted_gin
  ON tool_calls USING GIN (result_redacted);


-- 4. Detail Leaf: Retrieval Events
CREATE TABLE IF NOT EXISTS retrieval_events (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,                   -- Links back to actions.id
  project_id TEXT NOT NULL,
  retriever_name TEXT NOT NULL,              -- Name of vector DB or retriever system
  query_hash TEXT NOT NULL,                  -- SHA-256 of the retrieval query string
  documents_json JSONB,                      -- Array of { docId, score, sourceId, snippet_preview }
  total_results INTEGER NOT NULL DEFAULT 0,
  max_relevance_score DOUBLE PRECISION,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_action
  ON retrieval_events (action_id);

CREATE INDEX IF NOT EXISTS idx_retrieval_events_docs_gin
  ON retrieval_events USING GIN (documents_json);


-- 5. Detail Leaf: Evaluation & Guardrail Results
CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,                   -- Links back to actions.id
  project_id TEXT NOT NULL,
  evaluator_name TEXT NOT NULL,              -- Name of the evaluator or guardrail (e.g. groundedness)
  evaluator_version TEXT NOT NULL,           -- Grader version
  score DOUBLE PRECISION,                    -- Numeric metric between 0.0 and 1.0
  passed INTEGER NOT NULL DEFAULT 1,         -- Boolean (0/1) for binary policy gates
  reasoning TEXT,                            -- Explanation or chain-of-thought of the grader
  rubric_json JSONB                          -- Optional grader schema or rubric details
);

CREATE INDEX IF NOT EXISTS idx_eval_results_action
  ON eval_results (action_id);

CREATE INDEX IF NOT EXISTS idx_eval_results_rubric_gin
  ON eval_results USING GIN (rubric_json);


-- 6. Detail Leaf: Generated Artifacts
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,                   -- Links back to actions.id
  project_id TEXT NOT NULL,
  artifact_name TEXT NOT NULL,               -- e.g. "invoice-pdf"
  artifact_type TEXT NOT NULL,               -- file, patch, text, message, data
  storage_ref TEXT,                          -- S3 / Blob reference
  size_bytes INTEGER,
  sha256_hash TEXT,
  content_preview TEXT                       -- Redacted preview or summary
);

CREATE INDEX IF NOT EXISTS idx_artifacts_action
  ON artifacts (action_id);


-- 7. Extend Existing AI Span Payloads Table
ALTER TABLE ai_span_payloads ADD COLUMN action_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_payloads_action
  ON ai_span_payloads (project_id, action_id)
  WHERE action_id IS NOT NULL;
