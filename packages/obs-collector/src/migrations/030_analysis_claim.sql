-- RFC 0002 Stage 4 follow-up — cron overlap protection.
--
-- Every-minute analyses tick + narrative-LLM latency could leave a single
-- analysis still running when the next tick fires. Without a claim, both
-- ticks pick up the same row (last_run_at hasn't moved yet on success-only
-- writes), and we double-spend on LLM calls and write duplicate result
-- rows.
--
-- last_started_at is the claim timestamp; the runner takes a 90-second
-- lease on the row before processing. A lease that's older than the
-- threshold is considered abandoned and the next tick may re-claim.
-- last_run_at continues to track completion time.

ALTER TABLE analysis_definitions ADD COLUMN last_started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_analysis_definitions_started
  ON analysis_definitions (project_id, last_started_at)
  WHERE last_started_at IS NOT NULL;
