-- Migration 048: telemetry_spans composite primary key
-- (project_id, trace_id, span_id)
--
-- 001 keyed spans by (trace_id, span_id); project_id arrived in 010 without
-- joining the key. Ingest uses INSERT OR IGNORE, so a span whose
-- (trace_id, span_id) already existed under another project was silently
-- dropped, and the first project to write a given id owned it for every
-- tenant.
--
-- Rebuilds the table with PRIMARY KEY (project_id, trace_id, span_id),
-- preserving every row, every column default (001, 010, 017, 022, 027, 029)
-- and every index (001, 010, 022, 023, 027, 029). The old key was unique,
-- so the composite key cannot collide. Re-running the file is a no-op in
-- effect.
--
-- Operational note: this copies the whole spans table once. Retention keeps
-- the table bounded, but on a busy D1 database apply it in a quiet window.

DROP TABLE IF EXISTS telemetry_spans_new;

CREATE TABLE telemetry_spans_new (
  project_id TEXT NOT NULL DEFAULT 'default',
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  trace_state TEXT,
  service_name TEXT,
  scope_name TEXT,
  scope_version TEXT,
  span_name TEXT NOT NULL,
  span_kind INTEGER,
  status_code INTEGER,
  status_message TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  attributes_json TEXT,
  dropped_attributes_count INTEGER NOT NULL DEFAULT 0,
  resource_attributes_json TEXT,
  events_json TEXT,
  dropped_events_count INTEGER NOT NULL DEFAULT 0,
  links_json TEXT,
  dropped_links_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  session_id TEXT,
  interaction_id TEXT,
  telemetry_sdk_name TEXT,
  PRIMARY KEY (project_id, trace_id, span_id)
);

INSERT INTO telemetry_spans_new (
  project_id, trace_id, span_id, parent_span_id, trace_state, service_name,
  scope_name, scope_version, span_name, span_kind, status_code, status_message,
  start_time, end_time, duration_ms, attributes_json, dropped_attributes_count,
  resource_attributes_json, events_json, dropped_events_count, links_json,
  dropped_links_count, received_at, expires_at, session_id, interaction_id,
  telemetry_sdk_name
)
SELECT
  COALESCE(project_id, 'default'), trace_id, span_id, parent_span_id,
  trace_state, service_name, scope_name, scope_version, span_name, span_kind,
  status_code, status_message, start_time, end_time, duration_ms,
  attributes_json, COALESCE(dropped_attributes_count, 0),
  resource_attributes_json, events_json, COALESCE(dropped_events_count, 0),
  links_json, COALESCE(dropped_links_count, 0), received_at, expires_at,
  session_id, interaction_id, telemetry_sdk_name
FROM telemetry_spans;

DROP TABLE telemetry_spans;

ALTER TABLE telemetry_spans_new RENAME TO telemetry_spans;

CREATE INDEX IF NOT EXISTS idx_spans_received_at ON telemetry_spans (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON telemetry_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_service ON telemetry_spans (service_name);
CREATE INDEX IF NOT EXISTS idx_spans_status ON telemetry_spans (status_code);
CREATE INDEX IF NOT EXISTS idx_spans_root ON telemetry_spans (parent_span_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_project_received ON telemetry_spans (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_with_links
  ON telemetry_spans (project_id, received_at DESC)
  WHERE links_json IS NOT NULL AND links_json != '[]';
CREATE INDEX IF NOT EXISTS idx_spans_project_service_received
  ON telemetry_spans (project_id, service_name, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_session
  ON telemetry_spans (project_id, session_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_interaction
  ON telemetry_spans (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_sdk_name
  ON telemetry_spans (project_id, telemetry_sdk_name, received_at DESC)
  WHERE telemetry_sdk_name IS NOT NULL;
