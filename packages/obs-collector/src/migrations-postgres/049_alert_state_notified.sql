-- Migration 049: alert_state.notified
--
-- Mirrors ../migrations/049_alert_state_notified.sql. INTEGER 0/1 like the
-- sibling alert_evaluations.notified (not BOOLEAN), so the shared store SQL
-- can test and set it the same way on both backends.
--
-- Backfill: existing rows default to 1 (delivered); the pre-049 evaluator
-- only stored a transition after the channels accepted it. Idempotent.

ALTER TABLE alert_state ADD COLUMN IF NOT EXISTS notified INTEGER NOT NULL DEFAULT 1;
