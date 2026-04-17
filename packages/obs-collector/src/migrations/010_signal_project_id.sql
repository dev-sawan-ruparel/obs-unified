-- Add project_id to every signal table. DEFAULT 'default' backfills existing rows.
ALTER TABLE telemetry_spans ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE logs ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE usage_events ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE ai_calls ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE session_replay_metadata ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE user_profiles ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';

-- Composite indexes for project-scoped queries.
CREATE INDEX IF NOT EXISTS idx_spans_project_received ON telemetry_spans (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_project_received ON logs (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_project_received ON usage_events (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_project_received ON ai_calls (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_replay_project_last ON session_replay_metadata (project_id, last_chunk_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_project_last ON user_profiles (project_id, last_seen_at DESC);
