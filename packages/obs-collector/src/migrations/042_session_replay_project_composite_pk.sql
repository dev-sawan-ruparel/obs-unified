-- Migration 042: session replay composite primary key (project_id, session_id)
--
-- Fixes cross-project session replay metadata collisions. Previously,
-- session_replay_metadata used session_id alone as primary key while
-- project_id was added in migration 010. Replay receiver upserts used
-- ON CONFLICT(session_id), causing identical session IDs from different
-- projects to overwrite or increment each other.
--
-- This forward migration recreates the table with PRIMARY KEY (project_id, session_id),
-- preserving all existing rows and column defaults, and recreates associated indexes.

DROP TABLE IF EXISTS session_replay_metadata_new;

CREATE TABLE session_replay_metadata_new (
  project_id TEXT NOT NULL DEFAULT 'default',
  session_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  first_chunk_at TEXT NOT NULL,
  last_chunk_at TEXT NOT NULL,
  chunk_count INTEGER DEFAULT 0,
  events_count INTEGER DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, session_id)
);

INSERT INTO session_replay_metadata_new (
  project_id,
  session_id,
  visitor_id,
  first_chunk_at,
  last_chunk_at,
  chunk_count,
  events_count,
  storage_bytes
)
SELECT
  COALESCE(project_id, 'default'),
  session_id,
  visitor_id,
  first_chunk_at,
  last_chunk_at,
  COALESCE(chunk_count, 0),
  COALESCE(events_count, 0),
  COALESCE(storage_bytes, 0)
FROM session_replay_metadata;

DROP TABLE session_replay_metadata;

ALTER TABLE session_replay_metadata_new RENAME TO session_replay_metadata;

CREATE INDEX IF NOT EXISTS idx_replay_visitor ON session_replay_metadata (visitor_id);
CREATE INDEX IF NOT EXISTS idx_replay_project_last ON session_replay_metadata (project_id, last_chunk_at DESC);
