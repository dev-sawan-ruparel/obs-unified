-- Migration 045: user_profiles composite primary key (project_id, user_id)
--
-- user_profiles was created in 006 with `user_id TEXT PRIMARY KEY` and only
-- gained project_id in 010. /v1/identify upserted on ON CONFLICT(user_id),
-- so an ingest key for one project could read or rewrite another project's
-- profile by posting the same userId (commonly an email address).
--
-- Rebuilds the table with PRIMARY KEY (project_id, user_id), preserving
-- every row and the two indexes. The old key was unique, so the composite
-- key cannot collide. Re-running the file is a no-op in effect.

DROP TABLE IF EXISTS user_profiles_new;

CREATE TABLE user_profiles_new (
  project_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  properties_json TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

INSERT INTO user_profiles_new (
  project_id, user_id, visitor_id, email, name, properties_json,
  first_seen_at, last_seen_at
)
SELECT
  COALESCE(project_id, 'default'), user_id, visitor_id, email, name,
  properties_json, first_seen_at, last_seen_at
FROM user_profiles;

DROP TABLE user_profiles;

ALTER TABLE user_profiles_new RENAME TO user_profiles;

CREATE INDEX IF NOT EXISTS idx_user_visitor ON user_profiles (visitor_id);
CREATE INDEX IF NOT EXISTS idx_users_project_last ON user_profiles (project_id, last_seen_at DESC);
