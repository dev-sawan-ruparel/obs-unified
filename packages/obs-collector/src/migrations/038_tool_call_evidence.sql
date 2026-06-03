-- AI debugging evidence for side-effecting tool calls.
--
-- These fields are opt-in evidence channels. They intentionally store only
-- explicit audit/diff envelopes emitted by instrumentation, not raw tool
-- arguments, results, or transport metadata.

ALTER TABLE tool_calls ADD COLUMN mcp_audit_json TEXT;
ALTER TABLE tool_calls ADD COLUMN mutation_before_json TEXT;
ALTER TABLE tool_calls ADD COLUMN mutation_after_json TEXT;
ALTER TABLE tool_calls ADD COLUMN mutation_diff_json TEXT;
ALTER TABLE tool_calls ADD COLUMN mutation_artifact_id TEXT;
