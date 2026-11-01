-- Migration 057: alert_evaluations.outcome
--
-- Mirrors ../migrations/057_alert_evaluations_outcome.sql ('value',
-- 'no_data' or 'error'; existing rows 'value'). Idempotent.

ALTER TABLE alert_evaluations ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'value';
