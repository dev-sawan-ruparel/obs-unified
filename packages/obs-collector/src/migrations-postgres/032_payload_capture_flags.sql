ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS payload_capture_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai_span_payloads
  ADD COLUMN IF NOT EXISTS input_hash TEXT;

ALTER TABLE ai_span_payloads
  ADD COLUMN IF NOT EXISTS output_hash TEXT;
