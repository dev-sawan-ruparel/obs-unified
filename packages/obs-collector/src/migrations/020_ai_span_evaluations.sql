-- Evaluations attached to an AI span. One span can have many evaluations
-- (e.g. an LLM-judge "hallucination" score plus a human "thumbs_up" label).
--
-- source tells us where the evaluation came from:
--   "llm_judge"  — another model scored this span
--   "code"       — deterministic check (regex, schema, etc.)
--   "human"      — UI annotation / feedback
--   "user"       — end-user thumbs up/down in the product
--
-- score is numeric (0..1 or any float); label is a free-form categorical
-- (e.g. "correct", "hallucinated", "👍"). Either or both may be set.

CREATE TABLE IF NOT EXISTS ai_span_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score REAL,
  label TEXT,
  explanation TEXT,
  source TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_evals_span
  ON ai_span_evaluations (trace_id, span_id);
CREATE INDEX IF NOT EXISTS idx_ai_evals_project_created
  ON ai_span_evaluations (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_evals_project_name
  ON ai_span_evaluations (project_id, name, created_at DESC);
