-- Migration 054: alert_rules.pending_secs
--
-- Mirrors ../migrations/054_alert_rules_pending_secs.sql. INTEGER like the
-- sibling alert_rules.window_mins. Existing rules default to 0 (fire on the
-- first matching evaluation, as before). Idempotent.

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS pending_secs INTEGER NOT NULL DEFAULT 0;
