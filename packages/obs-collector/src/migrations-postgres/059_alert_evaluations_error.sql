-- Migration 059: alert_evaluations.error_message
--
-- Mirrors ../migrations/059_alert_evaluations_error.sql. TEXT, NULL unless
-- the outcome is 'error'. Idempotent.

ALTER TABLE alert_evaluations ADD COLUMN IF NOT EXISTS error_message TEXT;
