CREATE TABLE IF NOT EXISTS alert_state (
  rule_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  last_state_change TEXT NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_state_project ON alert_state (project_id);
