-- RFC 0002 Stage 6: auto-pinning + alert→analysis binding.
--
-- Two coupled changes that share a migration so first-time installs land
-- in one shot:
--
-- 1. ask_evidence_events
--    Every time the Ask box's tool-use loop cites an analysis in its
--    answer, we drop a row here. The Health tab's "Pinned" group derives
--    from the top-cited analyses over the trailing 7 days. This is the
--    auto-pinning input — pure observation, no manual config required.
--
-- 2. alert_rules.analysis_id
--    Lets an alert rule reference an Analysis by id rather than carrying
--    its own query. The evaluator reads the analysis's latest primary
--    value; webhook payloads attach the analysis's current narrative so
--    Slack/PagerDuty messages are about *what's happening*, not just
--    "metric crossed threshold." NULL means the rule still uses its
--    `query_json` (the pre-Stage-6 path).

CREATE TABLE IF NOT EXISTS ask_evidence_events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL,
	analysis_id TEXT NOT NULL,
	asked_at INTEGER NOT NULL              -- unix epoch millis
);

CREATE INDEX IF NOT EXISTS idx_ask_evidence_events_recent
	ON ask_evidence_events (project_id, asked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ask_evidence_events_analysis
	ON ask_evidence_events (project_id, analysis_id, asked_at DESC);

-- ALTER TABLE ... ADD COLUMN is the single supported schema-change form
-- in SQLite/D1. Defaults to NULL (legacy rules unaffected).
ALTER TABLE alert_rules ADD COLUMN analysis_id TEXT;

CREATE INDEX IF NOT EXISTS idx_alert_rules_analysis
	ON alert_rules (project_id, analysis_id);
