-- Migration 049: alert_state.notified
--
-- The evaluator records a state transition before it notifies the rule's
-- channels, and retries the notification on later ticks while it is still
-- outstanding. That "outstanding" bit used to be inferred from
-- alert_evaluations, which retention purges after 720 hours — so a state
-- older than the retention window looked undelivered again and was re-sent
-- every tick. The flag lives on the state row instead and is never purged.
--
-- Backfill: every existing row is marked delivered (DEFAULT 1). Before this
-- column existed the evaluator only wrote a transition after the channels
-- had accepted it, so no stored state can be awaiting a notification.
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_state ADD COLUMN notified INTEGER NOT NULL DEFAULT 1;
