CREATE TABLE IF NOT EXISTS logs (
  log_id TEXT PRIMARY KEY,
  trace_id TEXT,
  span_id TEXT,
  service_name TEXT,
  severity TEXT NOT NULL,
  severity_number INTEGER NOT NULL,
  logger_name TEXT,
  message TEXT NOT NULL,
  attributes_json TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_logs_received ON logs (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace ON logs (trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service_name);
CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs (severity_number);
