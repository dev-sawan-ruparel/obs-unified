-- Migration 058: alert_state.pending_seen_at
--
-- ISO time of the last evaluation that saw a pending rule's condition hold.
-- The evaluator continues a pending period only when the next matching
-- evaluation comes within the allowed gap of this one (and after the
-- current collector process started); otherwise the hold starts over, as
-- Prometheus resets `for` when evaluations stop.
--
-- Re-running fails with "duplicate column name", which the D1 runner treats
-- as already applied.

ALTER TABLE alert_state ADD COLUMN pending_seen_at TEXT;
