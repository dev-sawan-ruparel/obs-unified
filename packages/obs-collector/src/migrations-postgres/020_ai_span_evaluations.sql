CREATE TABLE IF NOT EXISTS ai_span_evaluations (
  evaluation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  name TEXT NOT NULL,
  score DOUBLE PRECISION,
  label TEXT,
  explanation TEXT,
  source TEXT NOT NULL,
  metadata_json JSONB,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_evals_span
  ON ai_span_evaluations (trace_id, span_id);
CREATE INDEX IF NOT EXISTS idx_ai_evals_project_created
  ON ai_span_evaluations (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_evals_project_name
  ON ai_span_evaluations (project_id, name, created_at DESC);
