-- Migration 054: alert_rules.pending_secs
--
-- How long a rule's condition must hold on consecutive evaluations before
-- the rule fires (Prometheus `for`). 0 keeps the existing behaviour: fire on
-- the first evaluation whose value matches. The start of the pending period
-- lives on alert_state (055).
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_rules ADD COLUMN pending_secs INTEGER NOT NULL DEFAULT 0;
