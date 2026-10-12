-- Migration 042: session replay composite primary key (project_id, session_id)
--
-- Fixes cross-project session replay metadata collisions. Previously,
-- session_replay_metadata used session_id alone as primary key while
-- project_id was added in migration 010. Replay receiver upserts used
-- ON CONFLICT(session_id), causing identical session IDs from different
-- projects to overwrite or increment each other.
--
-- This forward migration drops the existing single-column primary key constraint
-- and establishes PRIMARY KEY (project_id, session_id) while preserving all
-- existing rows and indexes.

UPDATE session_replay_metadata SET project_id = 'default' WHERE project_id IS NULL;
ALTER TABLE session_replay_metadata ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE session_replay_metadata DROP CONSTRAINT IF EXISTS session_replay_metadata_pkey;
ALTER TABLE session_replay_metadata ADD PRIMARY KEY (project_id, session_id);
