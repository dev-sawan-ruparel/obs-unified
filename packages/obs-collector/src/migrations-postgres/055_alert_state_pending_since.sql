-- Migration 055: alert_state.pending_since
--
-- Mirrors ../migrations/055_alert_state_pending_since.sql. ISO TEXT like
-- alert_state.last_state_change. Idempotent.

ALTER TABLE alert_state ADD COLUMN IF NOT EXISTS pending_since TEXT;
