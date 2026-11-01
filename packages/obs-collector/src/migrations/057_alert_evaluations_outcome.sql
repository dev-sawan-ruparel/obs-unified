-- Migration 057: alert_evaluations.outcome
--
-- What an evaluation produced: 'value' (a value was compared), 'no_data'
-- (a metrics rule with noData "keep" found no fresh series and left the
-- state alone) or 'error' (the evaluation failed; the state was left alone).
-- Existing rows are 'value'.
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_evaluations ADD COLUMN outcome TEXT NOT NULL DEFAULT 'value';
