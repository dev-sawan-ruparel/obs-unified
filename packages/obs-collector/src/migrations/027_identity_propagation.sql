-- RFC 0004 — identity propagation.
--
-- Adds the `interaction_id` correlation key (a ULID minted by
-- @obs/analytics-sdk at click/submit/keydown time) to every signal that
-- carries it, plus the missing `session_id` column on `ai_calls`.
--
-- Why interaction_id: today, replay → trace navigation is approximate
-- (session_id + timestamp window). With a click-scoped correlation key we
-- can pivot from any rrweb event to the exact trace it caused, in either
-- direction.
--
-- metric_point intentionally does NOT get either column. Metrics aggregate;
-- tying a metric point to one click defeats the purpose. Exemplars
-- (already supported via metric_point.exemplars_json) are the correct
-- correlation primitive for metrics. Indexing exemplars for reverse lookup
-- is a follow-up flagged in the RFC.

ALTER TABLE telemetry_spans   ADD COLUMN interaction_id TEXT;
ALTER TABLE logs              ADD COLUMN interaction_id TEXT;
ALTER TABLE usage_events      ADD COLUMN interaction_id TEXT;
ALTER TABLE ai_calls          ADD COLUMN interaction_id TEXT;
ALTER TABLE ai_span_payloads  ADD COLUMN interaction_id TEXT;

-- Backfill the one signal table missing session_id. ai_calls today
-- carries trace_id but no session, forcing a two-hop join through spans
-- to recover the user session that triggered an LLM call.
ALTER TABLE ai_calls          ADD COLUMN session_id TEXT;

-- Partial indices keep the index small in the common case where most
-- rows predate this migration and therefore have NULL interaction_id.
-- SQLite/D1 supports partial indexes via the WHERE clause.
CREATE INDEX IF NOT EXISTS idx_spans_interaction
  ON telemetry_spans (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_interaction
  ON logs (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_interaction
  ON usage_events (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_interaction
  ON ai_calls (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_session
  ON ai_calls (project_id, session_id, received_at DESC)
  WHERE session_id IS NOT NULL;
