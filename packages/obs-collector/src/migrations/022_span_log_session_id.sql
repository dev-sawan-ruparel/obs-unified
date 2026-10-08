-- Denormalize session.id off the span/log attributes so we can pivot from a
-- session to every telemetry signal (spans, logs) without a json_extract on
-- every row. Populated at ingest by the enrichment plugins.
--
-- Nullable — not every span or log belongs to a session.

ALTER TABLE telemetry_spans ADD COLUMN session_id TEXT;
ALTER TABLE logs ADD COLUMN session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_session
  ON telemetry_spans (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_session
  ON logs (project_id, session_id, received_at DESC);
