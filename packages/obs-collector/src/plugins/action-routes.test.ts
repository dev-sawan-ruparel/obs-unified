import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import type { EntityManifestExtended } from "../lib/identity-index";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { actionRoutesPlugin } from "./action-routes";

const actionRoot = {
	id: "run-123",
	project_id: "default",
	root_action_id: "run-123",
	caused_by_action_id: null,
	actor_type: "agent",
	actor_id: "billing-agent",
	action_kind: "agent.run",
	name: "Billing agent",
	status: "ok",
	started_at: "2026-05-22T00:00:00.000Z",
	ended_at: "2026-05-22T00:00:05.000Z",
	duration_ms: 5000,
	trace_id: "trace-123",
	span_id: "span-root",
	session_id: null,
	interaction_id: null,
	user_id: null,
	agent_run_id: "run-123",
	step_id: null,
	tool_call_id: null,
	prompt_version: "billing-v2",
	model_name: "claude-sonnet-4",
	provider: "anthropic",
	total_cost_usd: 0.02,
	attrs_json: "{}",
};

const actionChild = {
	...actionRoot,
	id: "action-tool",
	caused_by_action_id: "run-123",
	action_kind: "tool.call",
	name: "Update invoice",
	span_id: "span-tool",
	tool_call_id: "tool-1",
};

const agentRun = {
	id: "run-123",
	project_id: "default",
	agent_id: "billing-agent",
	agent_name: "Billing Agent",
	agent_version: "2.0.0",
	goal: "Resolve invoice mismatch",
	outcome: "Updated invoice",
	autonomy_level: "human_approved_write",
	status: "success",
	error_message: null,
	total_cost_usd: 0.02,
	total_duration_ms: 5000,
	metadata_json: "{}",
};

const toolCall = {
	id: "tool-1",
	action_id: "action-tool",
	project_id: "default",
	tool_name: "update_invoice",
	args_hash: "args-hash",
	result_hash: "result-hash",
	error_type: null,
	side_effect: 1,
	approval_state: "human_approved",
	args_redacted: "{}",
	result_redacted: "{}",
};

const setup = (db: MemSqlDb) => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime();
	actionRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
	};
	return (path: string) => app.request(path, { method: "GET" }, env);
};

type ActionRouteBody = {
	action: { id: string };
	manifest: EntityManifestExtended;
};

type AgentRunRouteBody = {
	agentRun: { id: string };
	manifest: EntityManifestExtended;
};

type ToolCallRouteBody = {
	toolCall: { id: string; actionId: string };
	manifest: EntityManifestExtended;
};

const actionGraphDb = () =>
	new MemSqlDb({
		first: (sql, binds) => {
			if (sql.includes("FROM actions")) {
				return binds.includes("run-123") || binds.includes("action-tool")
					? actionRoot
					: null;
			}
			if (sql.includes("FROM agent_runs")) {
				return binds.includes("run-123") ? agentRun : null;
			}
			if (sql.includes("FROM tool_calls")) {
				return binds.includes("tool-1") ? { action_id: "action-tool" } : null;
			}
			return null;
		},
		all: (sql) => {
			if (sql.includes("FROM actions")) return [actionRoot, actionChild];
			if (sql.includes("FROM agent_runs")) return [agentRun];
			if (sql.includes("FROM tool_calls")) return [toolCall];
			return [];
		},
	});

describe("actionRoutesPlugin", () => {
	it("returns direct action detail with the full action graph manifest", async () => {
		const res = await setup(actionGraphDb())("/internal/actions/run-123");

		expect(res.status).toBe(200);
		const body = (await res.json()) as ActionRouteBody;
		expect(body.action.id).toBe("run-123");
		expect(body.manifest.actions).toHaveLength(2);
		expect(body.manifest.agentRuns[0].id).toBe("run-123");
		expect(body.manifest.toolCalls[0].id).toBe("tool-1");
	});

	it("returns direct agent run detail with the full run manifest", async () => {
		const res = await setup(actionGraphDb())("/internal/agent-runs/run-123");

		expect(res.status).toBe(200);
		const body = (await res.json()) as AgentRunRouteBody;
		expect(body.agentRun.id).toBe("run-123");
		expect(body.manifest.actions.map((a: { id: string }) => a.id)).toContain(
			"action-tool",
		);
	});

	it("resolves a tool call through its causal action", async () => {
		const res = await setup(actionGraphDb())("/internal/tool-calls/tool-1");

		expect(res.status).toBe(200);
		const body = (await res.json()) as ToolCallRouteBody;
		expect(body.toolCall.id).toBe("tool-1");
		expect(body.toolCall.actionId).toBe("action-tool");
		expect(body.manifest.actions).toHaveLength(2);
	});

	it("returns 404 for missing actions, agent runs, and tool calls", async () => {
		const fetch = setup(new MemSqlDb({ first: () => null, all: () => [] }));

		expect((await fetch("/internal/actions/missing")).status).toBe(404);
		expect((await fetch("/internal/agent-runs/missing")).status).toBe(404);
		expect((await fetch("/internal/tool-calls/missing")).status).toBe(404);
	});
});
