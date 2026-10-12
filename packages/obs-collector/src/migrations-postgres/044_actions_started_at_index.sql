-- RFC 0010 — action graph retention.
--
-- Mirrors ../migrations/044_actions_started_at_index.sql. `started_at` is
-- ISO-8601 TEXT on both backends, so the retention sweep compares it against
-- a text cutoff rendered the same way `postgresDialect.sinceHours` does.

CREATE INDEX IF NOT EXISTS idx_actions_started_at
  ON actions (started_at);
