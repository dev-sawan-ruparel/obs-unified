-- Migration 055: alert_state.pending_since
--
-- ISO timestamp of the first evaluation, in the current unbroken run, whose
-- value matched a rule that has a pending duration (054) and is not firing
-- yet. NULL when the rule is not pending. The evaluator fires once
-- `now - pending_since >= pending_secs` and clears it when the condition
-- stops holding or the rule fires.
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_state ADD COLUMN pending_since TEXT;
