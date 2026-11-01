-- Migration 058: alert_state.pending_seen_at
--
-- Mirrors ../migrations/058_alert_state_pending_seen_at.sql. ISO TEXT.
-- Idempotent.

ALTER TABLE alert_state ADD COLUMN IF NOT EXISTS pending_seen_at TEXT;
