-- RFC 0010 Phase 7: durable eval runner records.
--
-- Eval runs group one or more eval case results under a candidate agent,
-- prompt, and model configuration so production behavior can be compared with
-- attempted fixes across repeatable runs.

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  eval_case_id TEXT,
  candidate_agent_id TEXT,
  candidate_agent_version TEXT,
  candidate_prompt_id TEXT,
  candidate_prompt_version TEXT,
  candidate_model_provider TEXT,
  candidate_model TEXT,
  candidate_model_version TEXT,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  pass_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  average_score REAL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_project_created
  ON eval_runs (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_case_created
  ON eval_runs (project_id, eval_case_id, created_at DESC)
  WHERE eval_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_eval_runs_project_status_created
  ON eval_runs (project_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_runs_metadata_gin
  ON eval_runs USING GIN (metadata_json);
