-- Denormalize session.id and user.id off the span's attributes_json into
-- ai_span_payloads so we can filter sessions / user threads cheaply without
-- a json_extract on every row.
--
-- Both columns are nullable — not every AI span belongs to a session.

ALTER TABLE ai_span_payloads ADD COLUMN session_id TEXT;
ALTER TABLE ai_span_payloads ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_payloads_session
  ON ai_span_payloads (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_payloads_user
  ON ai_span_payloads (project_id, user_id, received_at DESC);
