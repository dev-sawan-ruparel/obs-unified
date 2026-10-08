CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  signal TEXT NOT NULL,
  query_json JSONB NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  window_mins INTEGER NOT NULL,
  comparison TEXT NOT NULL,
  channels_json JSONB NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_project ON alert_rules (project_id, enabled);
