ALTER TABLE session_replay_metadata
  ADD COLUMN IF NOT EXISTS storage_bytes BIGINT NOT NULL DEFAULT 0;
