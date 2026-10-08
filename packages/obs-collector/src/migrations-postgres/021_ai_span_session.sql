ALTER TABLE ai_span_payloads ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE ai_span_payloads ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_payloads_session
  ON ai_span_payloads (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_user
  ON ai_span_payloads (project_id, user_id, received_at DESC);
