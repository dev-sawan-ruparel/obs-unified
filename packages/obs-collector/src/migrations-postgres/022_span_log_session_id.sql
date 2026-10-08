ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_session
  ON telemetry_spans (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_session
  ON logs (project_id, session_id, received_at DESC);
