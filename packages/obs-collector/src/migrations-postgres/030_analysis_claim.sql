ALTER TABLE analysis_definitions ADD COLUMN IF NOT EXISTS last_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_definitions_started
  ON analysis_definitions (project_id, last_started_at)
  WHERE last_started_at IS NOT NULL;
