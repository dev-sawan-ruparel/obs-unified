-- RFC 0010 — action graph retention.
--
-- The hourly retention sweep expires action trees by `actions.started_at`
-- (the spine has no `expires_at` column). Existing indexes all lead with
-- `project_id` plus another key, so a cross-project "oldest actions first"
-- scan would read the whole table every hour. This index lets the sweep
-- pick its next batch of candidates in index order.

CREATE INDEX IF NOT EXISTS idx_actions_started_at
  ON actions (started_at);
