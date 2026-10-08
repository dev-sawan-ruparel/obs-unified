CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects (slug);

CREATE TABLE IF NOT EXISTS ingest_keys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- D1 used TEXT for the bcrypt hash. Postgres stores it as BYTEA so
  -- the column-comparison code in ingest-auth.ts (constant-time
  -- compare via bytes) doesn't pay a UTF-8 decode cost on every check.
  key_hash BYTEA NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects (id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_keys_project ON ingest_keys (project_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_ingest_keys_hash ON ingest_keys (key_hash);
