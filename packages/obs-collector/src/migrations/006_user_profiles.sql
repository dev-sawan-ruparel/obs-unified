CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  properties_json TEXT, -- custom traits (plan_tier, role)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_visitor ON user_profiles(visitor_id);
