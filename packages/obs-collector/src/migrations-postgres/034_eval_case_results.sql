-- RFC 0010 Phase 7: reusable eval-case run results.
--
-- Results are produced by offline or CI evaluators against a saved production
-- eval case. They intentionally store compact comparison metadata rather than
-- raw prompts or completions.

CREATE TABLE IF NOT EXISTS eval_case_results (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  eval_case_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  passed INTEGER NOT NULL,
  score REAL,
  actual_outcome TEXT,
  details_json JSONB,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_eval_case_results_case_created
  ON eval_case_results (project_id, eval_case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_eval_case_results_run
  ON eval_case_results (project_id, run_id);

CREATE INDEX IF NOT EXISTS idx_eval_case_results_details_gin
  ON eval_case_results USING GIN (details_json);
