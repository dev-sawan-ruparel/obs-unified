CREATE TABLE IF NOT EXISTS session_replay_metadata (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  first_chunk_at TEXT NOT NULL,
  last_chunk_at TEXT NOT NULL,
  chunk_count BIGINT DEFAULT 0,
  events_count BIGINT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_replay_visitor ON session_replay_metadata (visitor_id);
