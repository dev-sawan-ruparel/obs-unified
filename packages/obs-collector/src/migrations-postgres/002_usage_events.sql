CREATE TABLE IF NOT EXISTS usage_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  page_path TEXT,
  page_title TEXT,
  referrer TEXT,
  severity TEXT,
  source TEXT,
  context_json JSONB NOT NULL,
  properties_json JSONB NOT NULL,
  user_agent TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_received ON usage_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_events (session_id);
CREATE INDEX IF NOT EXISTS idx_usage_visitor ON usage_events (visitor_id);
CREATE INDEX IF NOT EXISTS idx_usage_path ON usage_events (page_path);
CREATE INDEX IF NOT EXISTS idx_usage_type ON usage_events (event_type);
