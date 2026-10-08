ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS interaction_id TEXT;
ALTER TABLE logs ADD COLUMN IF NOT EXISTS interaction_id TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS interaction_id TEXT;
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS interaction_id TEXT;
ALTER TABLE ai_span_payloads ADD COLUMN IF NOT EXISTS interaction_id TEXT;

ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_interaction
  ON telemetry_spans (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_interaction
  ON logs (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_interaction
  ON usage_events (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_interaction
  ON ai_calls (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_session
  ON ai_calls (project_id, session_id, received_at DESC)
  WHERE session_id IS NOT NULL;
