ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS trace_state TEXT;
ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS dropped_attributes_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS dropped_events_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry_spans ADD COLUMN IF NOT EXISTS dropped_links_count INTEGER NOT NULL DEFAULT 0;
