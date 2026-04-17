CREATE TABLE IF NOT EXISTS alert_evaluations (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  value REAL NOT NULL,
  state TEXT NOT NULL,
  notified INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_eval_rule_time ON alert_evaluations (rule_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_eval_project ON alert_evaluations (project_id, evaluated_at DESC);
