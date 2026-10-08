ALTER TABLE projects
  ADD COLUMN payload_capture_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE ai_span_payloads
  ADD COLUMN input_hash TEXT;

ALTER TABLE ai_span_payloads
  ADD COLUMN output_hash TEXT;
