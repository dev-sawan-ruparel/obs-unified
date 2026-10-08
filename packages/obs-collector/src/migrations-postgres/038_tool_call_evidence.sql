-- AI debugging evidence for side-effecting tool calls.
--
-- These fields are opt-in evidence channels. They intentionally store only
-- explicit audit/diff envelopes emitted by instrumentation, not raw tool
-- arguments, results, or transport metadata.

ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS mcp_audit_json JSONB;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS mutation_before_json JSONB;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS mutation_after_json JSONB;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS mutation_diff_json JSONB;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS mutation_artifact_id TEXT;
