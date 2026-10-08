CREATE INDEX IF NOT EXISTS idx_spans_project_received
  ON telemetry_spans (project_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_spans_with_links
  ON telemetry_spans (project_id, received_at DESC)
  WHERE links_json IS NOT NULL AND links_json <> '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_spans_project_service_received
  ON telemetry_spans (project_id, service_name, received_at DESC);
