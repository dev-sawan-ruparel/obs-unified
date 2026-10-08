CREATE TABLE IF NOT EXISTS ai_calls (
  call_id TEXT PRIMARY KEY,
  trace_id TEXT,
  span_id TEXT,
  service_name TEXT,
  model_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  call_type TEXT NOT NULL, -- 'text_completion', 'chat', 'prompt_to_image', 'embedding'
  request_json TEXT, -- The raw prompt/messages or image configuration
  response_json TEXT, -- The raw completion text or image URLs
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_cost_usd REAL,
  latency_ms REAL,
  is_error INTEGER DEFAULT 0,
  error_message TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_aicalls_received ON ai_calls (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_aicalls_trace ON ai_calls (trace_id);
CREATE INDEX IF NOT EXISTS idx_aicalls_service ON ai_calls (service_name);
CREATE INDEX IF NOT EXISTS idx_aicalls_model ON ai_calls (model_name);
