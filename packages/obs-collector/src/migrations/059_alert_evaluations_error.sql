-- Migration 059: alert_evaluations.error_message
--
-- Why an evaluation with outcome 'error' (057) failed: a timeout, a metrics
-- query over its series or point cap, a database error. Truncated and with
-- URLs replaced by the store, so no credentials or hook paths are kept.
-- NULL for every other outcome.
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_evaluations ADD COLUMN error_message TEXT;
