-- RFC 0002 Stage 1: persistent storage for Analysis runs.
--
-- One row per (analysis_id, generated_at). The dashboard reads "latest result
-- per analysis" via the (project_id, analysis_id, generated_at DESC) index;
-- the retention cron drops rows past expires_at. Stage 1 only writes
-- status / primary / baseline / payload; narrative + narrative_signature
-- get filled by Stage 3.

CREATE TABLE IF NOT EXISTS analysis_definitions (
	project_id TEXT NOT NULL,
	id TEXT NOT NULL,
	title TEXT NOT NULL,
	"group" TEXT NOT NULL,
	source TEXT NOT NULL,                  -- 'tier0' | 'tier1' | 'user' | 'llm-suggested'
	view TEXT NOT NULL,                    -- 'tile' | 'page' | 'alert'
	refresh_seconds INTEGER,
	sql TEXT,
	scope_json TEXT,                       -- JSON-serialized scope object
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	last_run_at TEXT,
	PRIMARY KEY (project_id, id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_definitions_group
	ON analysis_definitions (project_id, "group", id);

CREATE TABLE IF NOT EXISTS analysis_results (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	project_id TEXT NOT NULL,
	analysis_id TEXT NOT NULL,
	generated_at INTEGER NOT NULL,         -- unix epoch millis
	params_hash TEXT,
	status TEXT NOT NULL,                  -- 'ok' | 'warn' | 'critical' | 'unknown'
	primary_value REAL,
	baseline_value REAL,
	delta_pct REAL,
	payload_json TEXT NOT NULL,
	narrative TEXT,
	narrative_signature TEXT,
	duration_ms INTEGER NOT NULL,
	expires_at INTEGER NOT NULL            -- unix epoch millis; matched by retention cron
);

CREATE INDEX IF NOT EXISTS idx_analysis_results_latest
	ON analysis_results (project_id, analysis_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_results_expires
	ON analysis_results (expires_at);
