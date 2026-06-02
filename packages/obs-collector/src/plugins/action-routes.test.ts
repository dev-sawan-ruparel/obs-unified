import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import type {
	AutonomousReviewResult,
	CostAttributionResult,
	ToolReliabilityResult,
	VersionComparisonResult,
} from "../lib/action-aggregates";
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

	it("returns tool reliability aggregate shape with explicit null/zero unsupported metrics", async () => {
		const fetch = setup(
			new MemSqlDb({
				all: (sql) => {
					if (
						sql.includes("FROM tool_calls t") &&
						sql.includes("GROUP BY t.tool_name")
					) {
						return [
							{
								tool_name: "update_invoice",
								call_count: 4,
								error_count: 2,
								timeout_count: 1,
								malformed_argument_count: 1,
								side_effect_count: 3,
							},
							{
								tool_name: "lookup_customer",
								call_count: 1,
								error_count: 0,
								timeout_count: 0,
								malformed_argument_count: 0,
								side_effect_count: 0,
							},
						];
					}
					if (sql.includes("FROM tool_calls t")) {
						return [
							{
								tool_name: "update_invoice",
								duration_ms: 100,
								agent_id: "billing-agent",
								agent_label: "Billing Agent",
								workflow_id: "invoice-workflow",
								workflow_label: "invoice-workflow",
								action_id: "action-tool",
								agent_run_id: "run-123",
								trace_id: "trace-123",
								tool_call_id: "tool-1",
								eval_id: "eval-1",
								action_label: "Update invoice",
								status: "error",
								occurred_at: "2026-05-22T00:00:01.000Z",
							},
							{
								tool_name: "update_invoice",
								duration_ms: 200,
								agent_id: "billing-agent",
								agent_label: "Billing Agent",
								workflow_id: "invoice-workflow",
								workflow_label: "invoice-workflow",
							},
							{
								tool_name: "update_invoice",
								duration_ms: 400,
								agent_id: "billing-agent",
								agent_label: "Billing Agent",
								workflow_id: "invoice-workflow",
								workflow_label: "invoice-workflow",
							},
							{
								tool_name: "update_invoice",
								duration_ms: 800,
								agent_id: "refund-agent",
								agent_label: "Refund Agent",
								workflow_id: null,
								workflow_label: null,
							},
							{
								tool_name: "lookup_customer",
								duration_ms: null,
								agent_id: null,
								agent_label: null,
								workflow_id: null,
								workflow_label: null,
							},
						];
					}
					return [];
				},
			}),
		);

		const res = await fetch(
			"/internal/actions/aggregates/tool-reliability?hours=24&limit=2",
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as ToolReliabilityResult;
		expect(body.windowHours).toBe(24);
		expect(body.tools).toHaveLength(2);
		expect(body.tools[0]).toMatchObject({
			toolName: "update_invoice",
			callCount: 4,
			p50LatencyMs: 200,
			p95LatencyMs: 800,
			errorCount: 2,
			errorRate: 0.5,
			timeoutCount: 1,
			timeoutRate: 0.25,
			retryCount: 0,
			malformedArgumentCount: 1,
			sideEffectCount: 3,
		});
		expect(body.tools[0].topCausingAgents[0]).toEqual({
			id: "billing-agent",
			label: "Billing Agent",
			count: 3,
		});
		expect(body.tools[0].topCausingWorkflows[0]).toEqual({
			id: "invoice-workflow",
			label: "invoice-workflow",
			count: 3,
		});
		expect(body.tools[0].exemplars[0]).toMatchObject({
			actionId: "action-tool",
			agentRunId: "run-123",
			traceId: "trace-123",
			toolCallId: "tool-1",
			evalId: "eval-1",
			label: "Update invoice",
			status: "error",
		});
		expect(body.tools[1]).toMatchObject({
			toolName: "lookup_customer",
			p50LatencyMs: null,
			p95LatencyMs: null,
			retryCount: 0,
			malformedArgumentCount: 0,
		});
	});

	it("returns cost attribution aggregate shape across agent run action tool user tenant workflow dimensions", async () => {
		const fetch = setup(
			new MemSqlDb({
				all: (sql) => {
					if (sql.includes("ar.agent_id AS dimension_key")) {
						return [
							{
								dimension_key: "billing-agent",
								action_id: "run-1",
								agent_run_id: "run-1",
								trace_id: "trace-agent-cost",
								tool_call_id: null,
								eval_id: "eval-agent-cost",
								label: "Billing Agent",
								status: "success",
								occurred_at: "2026-05-22T00:00:00.000Z",
							},
						];
					}
					if (sql.includes("ar.id AS dimension_key")) {
						return [
							{
								dimension_key: "run-1",
								action_id: "run-1",
								agent_run_id: "run-1",
								trace_id: "trace-run-cost",
								tool_call_id: null,
								eval_id: null,
								label: "Billing Agent",
								status: "success",
								occurred_at: "2026-05-22T00:00:00.000Z",
							},
						];
					}
					if (sql.includes("t.tool_name AS dimension_key")) {
						return [
							{
								dimension_key: "update_invoice",
								action_id: "action-tool",
								agent_run_id: "run-1",
								trace_id: "trace-tool-cost",
								tool_call_id: "tool-1",
								eval_id: null,
								label: "Update invoice",
								status: "ok",
								occurred_at: "2026-05-22T00:00:01.000Z",
							},
						];
					}
					if (sql.includes("FROM agent_runs ar")) {
						if (sql.includes("GROUP BY ar.agent_id")) {
							return [
								{
									key: "billing-agent",
									label: "Billing Agent",
									total_cost_usd: 0.3,
									action_count: 0,
									agent_run_count: 2,
									tool_call_count: 0,
								},
							];
						}
						return [
							{
								key: "run-1",
								label: "Billing Agent",
								total_cost_usd: 0.2,
								action_count: 0,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (
						sql.includes("FROM tool_calls t") &&
						sql.includes("COUNT(*) AS tool_call_count")
					) {
						return [
							{
								key: "update_invoice",
								label: "update_invoice",
								total_cost_usd: 0.07,
								action_count: 2,
								agent_run_count: 1,
								tool_call_count: 4,
							},
						];
					}
					if (sql.includes("a.model_name AS key")) {
						return [
							{
								key: "gpt-4o",
								label: "gpt-4o",
								total_cost_usd: 0.13,
								action_count: 3,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (sql.includes("a.provider AS key")) {
						return [
							{
								key: "openai",
								label: "openai",
								total_cost_usd: 0.13,
								action_count: 3,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (sql.includes("a.prompt_version AS key")) {
						return [
							{
								key: "billing-v3",
								label: "billing-v3",
								total_cost_usd: 0.11,
								action_count: 2,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (sql.includes("a.user_id AS key")) {
						return [
							{
								key: "user-123",
								label: "user-123",
								total_cost_usd: 0.09,
								action_count: 2,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (sql.includes("target_tenant")) {
						return [
							{
								key: "acme_corp",
								label: "acme_corp",
								total_cost_usd: 0.08,
								action_count: 1,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					if (sql.includes("workflow_id") || sql.includes("task_id")) {
						return [
							{
								key: "invoice-workflow",
								label: "invoice-workflow",
								total_cost_usd: 0.06,
								action_count: 1,
								agent_run_count: 1,
								tool_call_count: 0,
							},
						];
					}
					return [];
				},
			}),
		);

		const res = await fetch(
			"/internal/actions/aggregates/cost-attribution?hours=48&limit=10",
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as CostAttributionResult;
		expect(body.windowHours).toBe(48);
		expect(body.byAgent[0]).toMatchObject({
			dimension: "agent",
			key: "billing-agent",
			totalCostUsd: 0.3,
			agentRunCount: 2,
		});
		expect(body.byRun[0]).toMatchObject({
			dimension: "run",
			key: "run-1",
			totalCostUsd: 0.2,
		});
		expect(body.byModel[0]).toMatchObject({
			dimension: "model",
			key: "gpt-4o",
			totalCostUsd: 0.13,
		});
		expect(body.byProvider[0].key).toBe("openai");
		expect(body.byPromptVersion[0].key).toBe("billing-v3");
		expect(body.byTool[0]).toMatchObject({
			dimension: "tool",
			key: "update_invoice",
			toolCallCount: 4,
		});
		expect(body.byAgent[0].exemplars[0]).toMatchObject({
			actionId: "run-1",
			agentRunId: "run-1",
			traceId: "trace-agent-cost",
			evalId: "eval-agent-cost",
		});
		expect(body.byRun[0].exemplars[0]).toMatchObject({
			actionId: "run-1",
			agentRunId: "run-1",
			traceId: "trace-run-cost",
		});
		expect(body.byTool[0].exemplars[0]).toMatchObject({
			actionId: "action-tool",
			agentRunId: "run-1",
			traceId: "trace-tool-cost",
			toolCallId: "tool-1",
		});
		expect(body.byUser[0].key).toBe("user-123");
		expect(body.byTenant[0].key).toBe("acme_corp");
		expect(body.byWorkflow[0].key).toBe("invoice-workflow");
	});

	it("returns autonomous-write review rows for side-effecting autonomous tools", async () => {
		const fetch = setup(
			new MemSqlDb({
				all: () => [
					{
						id: "tool-1",
						tool_name: "update_invoice",
						action_id: "action-tool",
						action_name: "Update invoice",
						agent_run_id: "run-123",
						agent_name: "Billing Agent",
						agent_version: "2.0.0",
						autonomy_level: "autonomous_write",
						side_effect: 1,
						approval_state: "bypassed",
						status: "error",
						error_snippet: "policy violation",
						trace_id: "trace-123",
						occurred_at: "2026-05-22T00:00:01.000Z",
					},
				],
			}),
		);

		const res = await fetch(
			"/internal/actions/aggregates/autonomous-review?hours=24&limit=10",
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as AutonomousReviewResult;
		expect(body.rows[0]).toMatchObject({
			id: "tool-1",
			toolName: "update_invoice",
			agentRunId: "run-123",
			approvalState: "bypassed",
			status: "error",
		});
	});

	it("returns prompt and agent version diff metrics", async () => {
		const fetch = setup(
			new MemSqlDb({
				all: (sql) => {
					if (sql.includes("root.id AS action_id")) {
						return [
							{
								action_id: "run-version",
								agent_run_id: "run-version",
								trace_id: "trace-version",
								tool_call_id: null,
								eval_id: "eval-version",
								label: "Billing Agent",
								status: "failed",
								occurred_at: "2026-05-22T00:00:00.000Z",
							},
						];
					}
					return [
						{
							version: "v3",
							run_count: 10,
							success_count: 9,
							avg_duration_ms: 300,
							avg_cost_usd: 0.02,
							eval_count: 8,
							passed_eval_count: 7,
							avg_eval_score: 0.92,
							tool_count: 20,
							tool_error_count: 1,
						},
						{
							version: "v2",
							run_count: 10,
							success_count: 8,
							avg_duration_ms: 500,
							avg_cost_usd: 0.04,
							eval_count: 8,
							passed_eval_count: 6,
							avg_eval_score: 0.82,
							tool_count: 20,
							tool_error_count: 3,
						},
					];
				},
			}),
		);

		const res = await fetch(
			"/internal/actions/aggregates/version-diff?baseline=v2&target=v3",
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as VersionComparisonResult;
		expect(body.baselineVersion).toBe("v2");
		expect(body.targetVersion).toBe("v3");
		expect(body.metrics.map((metric) => metric.label)).toContain(
			"Success Rate",
		);
		expect(
			body.metrics.find((metric) => metric.label === "Average Run Cost")
				?.deltaDirection,
		).toBe("positive");
		expect(body.baselineExemplars[0]).toMatchObject({
			actionId: "run-version",
			agentRunId: "run-version",
			traceId: "trace-version",
			evalId: "eval-version",
		});
		expect(body.targetExemplars[0]).toMatchObject({
			actionId: "run-version",
			agentRunId: "run-version",
			traceId: "trace-version",
			evalId: "eval-version",
		});
	});
});
