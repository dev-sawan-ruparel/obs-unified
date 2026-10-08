ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS telemetry_sdk_name TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_sdk_name
  ON telemetry_spans (project_id, telemetry_sdk_name, received_at DESC)
  WHERE telemetry_sdk_name IS NOT NULL;
