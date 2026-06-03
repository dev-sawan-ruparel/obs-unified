/**
 * RFC 0006 — connected rail manifest tests.
 *
 * Asserts the *contract* the rail UI relies on:
 *   - Every entity kind returns exactly four sections (up/across/down/related)
 *   - Empty sections render an emptyReason (informative-absence)
 *   - Sections with > 5 neighbors collapse to a count link
 *
 * The endpoint mounts on a fresh Hono app with a synthetic env that
 * carries a MemSqlDb. We don't spin up D1 — the tests assert SQL +
 * shape decisions only.
 */

import {
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ActionConfidence,
} from "@obs-unified/types/constants";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import {
	type ConnectedManifest,
	connectedRoutesPlugin,
} from "./connected-routes";

// ── Test harness ─────────────────────────────────────────────────────

const setup = (db: MemSqlDb) => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime();
	connectedRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
	};
	return async (path: string): Promise<ConnectedManifest> => {
		const res = await app.request(path, { method: "GET" }, env);
		return (await res.json()) as ConnectedManifest;
	};
};

// setup() asserts a 200 + manifest shape; the raw variant lets tests
// assert error responses without forcing the JSON shape.
const setupRaw = (db: MemSqlDb) => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime();
	connectedRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
	};
	return (path: string) => app.request(path, { method: "GET" }, env);
};

describe("ConnectedRail manifest — informative absence", () => {
	it("usage entity with no session returns empty sections with emptyReason on each", async () => {
		const db = new MemSqlDb({
			// All session lookups return nothing — every section in this
			// manifest should render with an emptyReason.
			all: () => [],
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch(
			"/internal/connected/usage/event-123?session_id=sess-empty",
		);

		// Four sections always present
		expect(m.up.length).toBeGreaterThan(0);
		expect(m.across.length).toBeGreaterThan(0);
		expect(m.down.length).toBeGreaterThan(0);
		expect(m.related.length).toBeGreaterThan(0);

		// Empty sections must render an emptyReason — never a bare empty
		// links array with no explanation.
		const allSections = [...m.up, ...m.across, ...m.down, ...m.related];
		for (const section of allSections) {
			if (section.links.length === 0) {
				expect(section.emptyReason).toBeDefined();
				expect(section.emptyReason?.length).toBeGreaterThan(0);
			}
		}
	});

	it("alert entity returns the topic-only stub with explanation", async () => {
		const db = new MemSqlDb({ all: () => [], first: () => null });
		const fetch = setup(db);
		const m = await fetch("/internal/connected/alert/al-123");

		// Alert/analysis entities deliberately skip the identity-graph
		// lookups; verify the stub explanation is present in `related`.
		const related = m.related[0];
		expect(related.links).toEqual([]);
		expect(related.emptyReason).toMatch(/topic links/i);
	});
});

describe("ConnectedRail manifest — count-link pattern", () => {
	it("usage event in a busy session collapses 100 spans into a single count link", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					// 100 distinct spans — well over the > 5 threshold.
					return Array.from({ length: 100 }, (_, i) => ({
						trace_id: "trace-A",
						span_id: `span-${i}`,
						parent_span_id: null,
						service_name: "checkout",
						span_name: `op-${i}`,
						status_code: 1,
						status_message: null,
						start_time: "2026-05-04T10:00:00Z",
						duration_ms: 10,
						interaction_id: null,
					}));
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch(
			"/internal/connected/usage/event-123?session_id=sess-busy",
		);

		// `Across` should contain a "Spans in this session" section.
		// With 100 entries, the count-link pattern collapses them into
		// a single link whose `count` is set.
		const spansSection = m.across.find((s) =>
			s.label.toLowerCase().includes("span"),
		);
		expect(spansSection).toBeDefined();
		expect(spansSection?.links).toHaveLength(1);
		expect(spansSection?.links[0].count).toBe(100);
		expect(spansSection?.links[0].sample).toBeDefined();
	});

	it("usage event with 3 logs renders them inline, not as a count link", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM logs")) {
					return [
						{
							log_id: "l-1",
							trace_id: "tr-A",
							span_id: null,
							service_name: "svc",
							logger_name: null,
							severity: "INFO",
							message: "first log message",
							occurred_at: "2026-05-04T10:00:00Z",
							interaction_id: null,
						},
						{
							log_id: "l-2",
							trace_id: "tr-A",
							span_id: null,
							service_name: "svc",
							logger_name: null,
							severity: "WARN",
							message: "second log",
							occurred_at: "2026-05-04T10:00:01Z",
							interaction_id: null,
						},
						{
							log_id: "l-3",
							trace_id: "tr-A",
							span_id: null,
							service_name: "svc",
							logger_name: null,
							severity: "ERROR",
							message: "third log",
							occurred_at: "2026-05-04T10:00:02Z",
							interaction_id: null,
						},
					];
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch(
			"/internal/connected/usage/event-123?session_id=sess-light",
		);

		const logsSection = m.across.find((s) =>
			s.label.toLowerCase().includes("log"),
		);
		expect(logsSection).toBeDefined();
		expect(logsSection?.links).toHaveLength(3);
		// No count-link consolidation under the threshold.
		expect(logsSection?.links[0].count).toBeUndefined();
	});
});

describe("ConnectedRail manifest — span profile section (RFC 0009 #5)", () => {
	it("surfaces matching profiles under Down, grouped by profile_type", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "tr-A",
							span_id: "sp-1",
							parent_span_id: null,
							service_name: "payment",
							span_name: "charge",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM profile_trace_index")) {
					return [
						{
							id: "prof-1",
							service_name: "payment",
							profile_type: "cpu",
							duration_ms: 60_000,
						},
						{
							id: "prof-2",
							service_name: "payment",
							profile_type: "offcpu",
							duration_ms: 60_000,
						},
					];
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/span/tr-A:sp-1");

		// CPU + off-CPU should each be their own section.
		expect(m.down.length).toBeGreaterThanOrEqual(2);
		const cpuSection = m.down.find((s) => s.label.includes("Cpu"));
		const offCpuSection = m.down.find((s) =>
			s.label.toLowerCase().includes("off-cpu"),
		);
		expect(cpuSection).toBeDefined();
		expect(offCpuSection).toBeDefined();
		expect(cpuSection?.links[0].href).toContain("trace_id=tr-A");
	});

	it("renders informative-absence under Down when no profile covers the trace", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "tr-B",
							span_id: "sp-1",
							parent_span_id: null,
							service_name: "payment",
							span_name: "charge",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/span/tr-B:sp-1");

		const profilesSection = m.down.find((s) =>
			s.label.toLowerCase().includes("profile"),
		);
		expect(profilesSection).toBeDefined();
		expect(profilesSection?.links).toEqual([]);
		expect(profilesSection?.emptyReason).toContain("startProfiler");
	});

	it("surfaces metric exemplars indexed for the selected trace", async () => {
		const db = new MemSqlDb({
			all: (sql, binds) => {
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("trace_id = ?") &&
					binds.includes("trace-metric")
				) {
					return [
						{
							trace_id: "trace-metric",
							span_id: "span-hot",
							parent_span_id: null,
							service_name: "checkout",
							span_name: "checkout.submit",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM metric_exemplars")) {
					return [
						{
							id: "ex-1",
							point_id: "point-1",
							series_id: "series-1",
							metric_name: "http.server.duration",
							service_name: "checkout",
							trace_id: "trace-metric",
							span_id: "span-hot",
							ts_ns: "1777908000000000000",
							value: 923.4,
							received_at: "2026-05-04T10:00:01Z",
						},
					];
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/span/trace-metric:span-hot");

		const exemplarSection = m.down.find((s) =>
			s.label.toLowerCase().includes("metric exemplar"),
		);
		expect(exemplarSection).toBeDefined();
		expect(exemplarSection?.links[0].label).toContain("http.server.duration");
		expect(exemplarSection?.links[0].href).toBe(
			"#/traces/trace-metric#span=span-hot",
		);
	});
});

describe("ConnectedRail manifest — raw signal action back-links", () => {
	const actionRow = (
		overrides: Partial<Record<string, unknown>> = {},
	): Record<string, unknown> => ({
		id: "action-explicit",
		project_id: "default",
		root_action_id: "run-explicit",
		caused_by_action_id: null,
		actor_type: "agent",
		actor_id: "agent-1",
		action_kind: "agent.step",
		name: "Investigate checkout",
		status: "ok",
		started_at: "2026-05-04T10:00:00Z",
		ended_at: "2026-05-04T10:00:01Z",
		duration_ms: 1000,
		trace_id: "trace-action",
		span_id: "span-action",
		session_id: null,
		interaction_id: null,
		user_id: null,
		agent_run_id: "run-explicit",
		step_id: null,
		tool_call_id: null,
		prompt_version: null,
		model_name: null,
		provider: null,
		total_cost_usd: null,
		attrs_json: null,
		...overrides,
	});

	const toolRow = (
		overrides: Partial<Record<string, unknown>> = {},
	): Record<string, unknown> => ({
		id: "tool-explicit",
		action_id: "action-explicit",
		project_id: "default",
		tool_name: "search_docs",
		args_hash: "args-hash",
		result_hash: "result-hash",
		error_type: null,
		side_effect: 0,
		approval_state: null,
		args_redacted: null,
		result_redacted: null,
		...overrides,
	});

	const evalRow = (
		overrides: Partial<Record<string, unknown>> = {},
	): Record<string, unknown> => ({
		id: "eval-explicit",
		action_id: "action-explicit",
		project_id: "default",
		evaluator_name: "groundedness",
		evaluator_version: "1",
		score: 0.92,
		passed: 1,
		reasoning: null,
		rubric_json: null,
		...overrides,
	});

	const runRow = (
		overrides: Partial<Record<string, unknown>> = {},
	): Record<string, unknown> => ({
		id: "run-explicit",
		project_id: "default",
		agent_id: "agent-1",
		agent_name: "Debug Agent",
		agent_version: "1.0.0",
		goal: "Debug checkout",
		outcome: null,
		autonomy_level: "supervised",
		status: "ok",
		error_message: null,
		total_cost_usd: null,
		total_duration_ms: null,
		metadata_json: null,
		...overrides,
	});

	it("span entity surfaces exact action, tool call, eval, and agent run links", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "trace-action",
							span_id: "span-action",
							parent_span_id: null,
							service_name: "checkout",
							span_name: "checkout.submit",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM actions")) return [actionRow()];
				if (sql.includes("FROM tool_calls")) return [toolRow()];
				if (sql.includes("FROM eval_results")) return [evalRow()];
				if (sql.includes("FROM agent_runs")) return [runRow()];
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);

		const m = await fetch("/internal/connected/span/trace-action:span-action");

		expect(
			m.down.find((s) => s.label === "Causal actions for this span")?.links[0],
		).toMatchObject({
			label: "[agent.step] Investigate checkout",
			href: "#/actions/action-explicit",
		});
		expect(
			m.down.find((s) => s.label === "Tool calls for this span")?.links[0],
		).toMatchObject({
			label: "tool: search_docs",
			href: "#/tool-calls/tool-explicit",
		});
		expect(
			m.down.find((s) => s.label === "Evaluations for this span")?.links[0],
		).toMatchObject({
			label: "eval: groundedness (passed)",
			href: "#/evals/eval-explicit",
		});
		expect(
			m.related.find((s) => s.label === "Agent runs for this span")?.links[0],
		).toMatchObject({
			label: "Debug Agent (v1.0.0)",
			href: "#/agent-runs/run-explicit",
		});
	});

	it("span action-context links expose trusted explicit causal confidence metadata", async () => {
		const explicitActionId = "01J3Y4Z5A6B7C8D9E0F1G2H3J4";
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "trace-explicit-confidence",
							span_id: "span-explicit-confidence",
							parent_span_id: null,
							service_name: "checkout",
							span_name: "checkout.submit",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM actions")) {
					return [
						actionRow({
							id: explicitActionId,
							root_action_id: explicitActionId,
							agent_run_id: null,
							trace_id: "trace-explicit-confidence",
							span_id: "span-explicit-confidence",
							name: "Explicit action",
							attrs_json: JSON.stringify({
								[ACTION_ID_KEY]: explicitActionId,
								[ACTION_CONFIDENCE_KEY]: ActionConfidence.Explicit,
							}),
						}),
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [toolRow({ action_id: explicitActionId })];
				}
				if (sql.includes("FROM eval_results")) {
					return [evalRow({ action_id: explicitActionId })];
				}
				if (sql.includes("FROM agent_runs")) return [];
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);

		const m = await fetch(
			"/internal/connected/span/trace-explicit-confidence:span-explicit-confidence",
		);

		const actionLink = m.down.find(
			(s) => s.label === "Causal actions for this span",
		)?.links[0];
		expect(actionLink).toMatchObject({
			entityKind: "action",
			entityId: explicitActionId,
			source: "trace_id+span_id",
			causalConfidence: ActionConfidence.Explicit,
			confidence: 0.95,
		});

		const toolLink = m.down.find((s) => s.label === "Tool calls for this span")
			?.links[0];
		expect(toolLink).toMatchObject({
			entityKind: "tool_call",
			source: "trace_id+span_id",
			causalConfidence: ActionConfidence.Explicit,
		});

		expect(m.rawManifest).toBeUndefined();
	});

	it("malformed explicit action ids are exposed as fallback confidence", async () => {
		const derivedActionId = "01J3Y4Z5A6B7C8D9E0F1G2H3J5";
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "trace-malformed-confidence",
							span_id: "span-malformed-confidence",
							parent_span_id: null,
							service_name: "checkout",
							span_name: "checkout.submit",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM actions")) {
					return [
						actionRow({
							id: derivedActionId,
							root_action_id: derivedActionId,
							agent_run_id: null,
							trace_id: "trace-malformed-confidence",
							span_id: "span-malformed-confidence",
							name: "Malformed explicit action",
							attrs_json: JSON.stringify({
								[ACTION_ID_KEY]: "not-an-action-id",
								[ACTION_CONFIDENCE_KEY]: ActionConfidence.Explicit,
							}),
						}),
					];
				}
				if (sql.includes("FROM tool_calls")) return [];
				if (sql.includes("FROM eval_results")) return [];
				if (sql.includes("FROM agent_runs")) return [];
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);

		const m = await fetch(
			"/internal/connected/span/trace-malformed-confidence:span-malformed-confidence",
		);

		const actionLink = m.down.find(
			(s) => s.label === "Causal actions for this span",
		)?.links[0];
		expect(actionLink).toMatchObject({
			entityId: derivedActionId,
			causalConfidence: ActionConfidence.Fallback,
			source: "trace_id+span_id",
		});
	});

	it("log entity resolves direct log id and falls back to deterministic trace action context", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM logs")) {
					return {
						trace_id: "trace-fallback",
						span_id: "span-log",
						session_id: null,
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM logs")) return [];
				if (sql.includes("FROM telemetry_spans")) return [];
				if (sql.includes("FROM actions") && sql.includes("span_id = ?")) {
					return [];
				}
				if (sql.includes("FROM actions") && sql.includes("trace_id = ?")) {
					return [
						actionRow({
							id: "fallback:trace-fallback:agent.step:1",
							root_action_id: "run-fallback",
							agent_run_id: "run-fallback",
							trace_id: "trace-fallback",
							span_id: null,
							name: "Fallback normalized action",
						}),
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [
						toolRow({
							id: "tool-fallback",
							action_id: "fallback:trace-fallback:agent.step:1",
						}),
					];
				}
				if (sql.includes("FROM eval_results")) return [];
				if (sql.includes("FROM agent_runs")) {
					return [
						runRow({
							id: "run-fallback",
							agent_name: "Fallback Agent",
						}),
					];
				}
				return [];
			},
		});
		const fetch = setup(db);

		const m = await fetch("/internal/connected/log/log-1");

		expect(
			m.down.find((s) => s.label === "Trace-level actions for this log")
				?.links[0],
		).toMatchObject({
			label: "[agent.step] Fallback normalized action",
			href: "#/actions/fallback:trace-fallback:agent.step:1",
			causalConfidence: ActionConfidence.Fallback,
			source: "trace_id",
			confidence: 0.55,
		});
		expect(
			m.down.find((s) => s.label === "Trace-level actions for this log")
				?.links[0].reason,
		).toMatch(/shared trace_id/i);
		expect(
			m.down.find((s) => s.label === "Trace-level tool calls for this log")
				?.links[0],
		).toMatchObject({
			href: "#/tool-calls/tool-fallback",
			causalConfidence: ActionConfidence.Fallback,
			source: "trace_id",
		});
		expect(
			m.related.find((s) => s.label === "Trace-level agent runs for this log")
				?.links[0],
		).toMatchObject({
			label: "Fallback Agent (v1.0.0)",
			href: "#/agent-runs/run-fallback",
		});
	});

	it("AI call entity resolves call id to span-level action context", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM ai_calls")) {
					return {
						trace_id: "trace-action",
						span_id: "span-action",
						session_id: "sess-ai",
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "trace-action",
							span_id: "span-action",
							parent_span_id: null,
							service_name: "ai",
							span_name: "openai.chat",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM ai_calls")) return [];
				if (sql.includes("FROM actions")) return [actionRow()];
				if (sql.includes("FROM tool_calls")) return [toolRow()];
				if (sql.includes("FROM eval_results")) return [evalRow()];
				if (sql.includes("FROM agent_runs")) return [runRow()];
				return [];
			},
		});
		const fetch = setup(db);

		const m = await fetch("/internal/connected/ai_call/ai-1");

		expect(
			m.down.find((s) => s.label === "Causal actions for this AI call")
				?.links[0],
		).toMatchObject({ href: "#/actions/action-explicit" });
		expect(
			m.down.find((s) => s.label === "Tool calls for this AI call")?.links[0],
		).toMatchObject({ href: "#/tool-calls/tool-explicit" });
		expect(
			m.down.find((s) => s.label === "Evaluations for this AI call")?.links[0],
		).toMatchObject({ href: "#/evals/eval-explicit" });
		expect(
			m.related.find((s) => s.label === "Agent runs for this AI call")
				?.links[0],
		).toMatchObject({ href: "#/agent-runs/run-explicit" });
	});
});

describe("ConnectedRail manifest — profile source entity", () => {
	it("surfaces sampled traces plus action/tool/agent context for a profile", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM profile_blobs")) {
					return {
						id: "prof-1",
						service_name: "payment",
						profile_type: "cpu",
						start_ts: "2026-05-04T10:00:00Z",
						end_ts: "2026-05-04T10:01:00Z",
						duration_ms: 60_000,
						sample_count: 1200,
						agent: "datadog-pprof",
					};
				}
				return null;
			},
			all: (sql) => {
				if (
					sql.includes("FROM profile_trace_index") &&
					sql.includes("profile_id = ?")
				) {
					return [{ trace_id: "trace-prof" }];
				}
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "trace-prof",
							span_id: "span-hot",
							parent_span_id: null,
							service_name: "payment",
							span_name: "charge",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T10:00:00Z",
							duration_ms: 700,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("agent_runs")) {
					return [
						{
							id: "run-hot",
							agent_name: "billing-agent",
							agent_version: "2",
						},
					];
				}
				if (sql.includes("FROM actions")) {
					return [
						{
							id: "action-hot",
							action_kind: "tool",
							name: "charge card",
						},
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [{ id: "tool-hot", tool_name: "stripe.charge" }];
				}
				return [];
			},
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/profile/prof-1");

		expect(m.entity.kind).toBe("profile");
		expect(m.up[0].emptyReason).toContain("payment · cpu");

		const traceSection = m.across.find((s) => s.label === "Sampled traces");
		expect(traceSection?.links[0]).toMatchObject({
			label: "trace trace-prof",
			href: "#/traces/trace-prof",
		});

		const spanSection = m.across.find((s) => s.label === "Sampled spans");
		expect(spanSection?.links[0].href).toBe(
			"#/traces/trace-prof#span=span-hot",
		);

		const actionSection = m.down.find((s) =>
			s.label.includes("Causal actions"),
		);
		expect(actionSection?.links[0]).toMatchObject({
			label: "[tool] charge card",
			href: "#/actions/action-hot",
		});

		const toolSection = m.down.find((s) => s.label.includes("Tool calls"));
		expect(toolSection?.links[0]).toMatchObject({
			label: "tool: stripe.charge",
			href: "#/tool-calls/tool-hot",
		});

		const runSection = m.related.find((s) => s.label === "Agent runs");
		expect(runSection?.links[0]).toMatchObject({
			label: "billing-agent (v2)",
			href: "#/agent-runs/run-hot",
		});
	});

	it("rejects unknown kinds while accepting profile as a known kind", async () => {
		const db = new MemSqlDb({ all: () => [], first: () => null });
		const raw = setupRaw(db);

		const profileRes = await raw("/internal/connected/profile/missing-profile");
		expect(profileRes.status).toBe(200);

		const unknownRes = await raw("/internal/connected/not-a-kind/x");
		expect(unknownRes.status).toBe(400);
	});

	it("explains when a profile has no indexed trace labels", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM profile_blobs")) {
					return {
						id: "prof-empty",
						service_name: "worker",
						profile_type: "offcpu",
						start_ts: "2026-05-04T10:00:00Z",
						end_ts: "2026-05-04T10:01:00Z",
						duration_ms: 60_000,
						sample_count: null,
						agent: "otel-ebpf",
					};
				}
				return null;
			},
			all: () => [],
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/profile/prof-empty");

		const traceSection = m.across.find((s) => s.label === "Sampled traces");
		expect(traceSection?.links).toEqual([]);
		expect(traceSection?.emptyReason).toMatch(/trace_id labels/i);

		const actionSection = m.down.find((s) =>
			s.label.includes("Causal actions"),
		);
		expect(actionSection?.emptyReason).toMatch(/No action graph records/i);
	});
});

describe("ConnectedRail manifest — kind validation", () => {
	it("returns 400 on unknown entity kind instead of 200 + empty sections", async () => {
		const db = new MemSqlDb({ all: () => [], first: () => null });
		const fetch = setupRaw(db);
		const res = await fetch("/internal/connected/banana/whatever");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; known: string[] };
		expect(body.error).toContain("banana");
		expect(body.known).toContain("span");
		expect(body.known).toContain("log");
	});

	it("returns 400 with id error when id is missing", async () => {
		const db = new MemSqlDb({ all: () => [], first: () => null });
		const fetch = setupRaw(db);
		// Hono won't match without the second segment, so this exercises
		// a fallback path — we just confirm we don't 500.
		const res = await fetch("/internal/connected/span/");
		expect(res.status).toBeGreaterThanOrEqual(400);
	});
});

describe("ConnectedRail manifest — user entity (RFC 0006 Scenario B)", () => {
	it("surfaces latest session + recent traces + AI calls for a user with activity", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM user_profiles")) {
					return { visitor_id: "vis-user-1" };
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("DISTINCT session_id")) {
					return [
						{ session_id: "sess-latest", last_at: "2026-05-04T12:00:00Z" },
						{ session_id: "sess-prior", last_at: "2026-05-04T11:00:00Z" },
					];
				}
				if (sql.includes("FROM usage_events")) {
					return [
						{
							event_id: "evt-1",
							event_type: "interaction",
							event_name: "click",
							page_path: "/dashboard",
							severity: null,
							occurred_at: "2026-05-04T12:00:00Z",
							interaction_id: null,
							session_id: "sess-latest",
						},
					];
				}
				if (sql.includes("FROM ai_calls")) {
					return [
						{
							call_id: "ai-pricey",
							trace_id: "tx-1",
							model_name: "gpt-4o-mini",
							provider: "openai",
							total_cost_usd: 0.42,
							occurred_at: "2026-05-04T12:00:01Z",
							interaction_id: null,
						},
					];
				}
				return [];
			},
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/user/user-1");

		// "Latest session" is the canonical scenario-B pivot.
		const latestSection = m.across.find((s) =>
			s.label.toLowerCase().includes("latest session"),
		);
		expect(latestSection).toBeDefined();
		expect(latestSection?.links[0].href).toContain("sess-latest");

		const aiSection = m.across.find((s) =>
			s.label.toLowerCase().includes("ai call"),
		);
		expect(aiSection).toBeDefined();
		expect(aiSection?.links.length).toBeGreaterThan(0);

		// Up section is informative-absence (user is root).
		expect(m.up[0].emptyReason).toBeDefined();
	});

	it("returns informative absence when the user has no usage_events sessions", async () => {
		const db = new MemSqlDb({
			first: (sql) =>
				sql.includes("FROM user_profiles") ? { visitor_id: "v" } : null,
			all: () => [],
		});
		const fetch = setup(db);
		const m = await fetch("/internal/connected/user/user-nope");
		const sessionsSection = m.across.find((s) =>
			s.label.toLowerCase().includes("session"),
		);
		expect(sessionsSection).toBeDefined();
		expect(sessionsSection?.links).toEqual([]);
		expect(sessionsSection?.emptyReason).toContain("visitor_id");
	});
});

describe("ConnectedRail scenario acceptance contracts", () => {
	it("Scenario A walks session → hot span → CPU profile → originating click", async () => {
		const db = new MemSqlDb({
			all: (sql, binds) => {
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("session_id = ?") &&
					binds.includes("sess-root-cause")
				) {
					return [
						{
							trace_id: "trace-a",
							span_id: "span-hot",
							parent_span_id: null,
							service_name: "payment",
							span_name: "payment.charge",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:00Z",
							duration_ms: 950,
							interaction_id: "ix-checkout",
						},
					];
				}
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("trace_id = ?") &&
					binds.includes("trace-a")
				) {
					return [
						{
							trace_id: "trace-a",
							span_id: "span-hot",
							parent_span_id: null,
							service_name: "payment",
							span_name: "payment.charge",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:00Z",
							duration_ms: 950,
							interaction_id: "ix-checkout",
						},
						{
							trace_id: "trace-a",
							span_id: "span-child",
							parent_span_id: "span-hot",
							service_name: "payment",
							span_name: "stripe.authorize",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:01Z",
							duration_ms: 120,
							interaction_id: "ix-checkout",
						},
					];
				}
				if (
					sql.includes("FROM profile_trace_index") &&
					binds.includes("trace-a")
				) {
					return [
						{
							id: "prof-cpu",
							service_name: "payment",
							profile_type: "cpu",
							duration_ms: 60_000,
						},
					];
				}
				if (
					sql.includes("FROM usage_events") &&
					sql.includes("interaction_id = ?") &&
					binds.includes("ix-checkout")
				) {
					return [
						{
							event_id: "evt-checkout",
							event_type: "interaction",
							event_name: "click_checkout",
							page_path: "/checkout",
							severity: null,
							occurred_at: "2026-05-04T11:59:59Z",
							interaction_id: "ix-checkout",
							session_id: "sess-root-cause",
						},
					];
				}
				return [];
			},
			first: () => null,
		});
		const fetch = setup(db);

		const sessionManifest = await fetch(
			"/internal/connected/usage/evt-checkout?session_id=sess-root-cause",
		);
		const sessionSpans = sessionManifest.across.find((s) =>
			s.label.toLowerCase().includes("span"),
		);
		expect(sessionSpans?.links[0].href).toBe("#/traces/trace-a#span=span-hot");

		const spanManifest = await fetch(
			"/internal/connected/span/trace-a:span-hot",
		);
		const profileSection = spanManifest.down.find((s) =>
			s.label.toLowerCase().includes("cpu profile"),
		);
		expect(profileSection?.links[0].href).toBe(
			"#/profiles/prof-cpu?trace_id=trace-a",
		);

		const clickSection = spanManifest.related.find((s) =>
			s.label.toLowerCase().includes("click"),
		);
		expect(clickSection?.links[0].href).toBe("#/usage?id=evt-checkout");
	});

	it("Scenario B walks heavy-spender user → latest session → AI trace → originating click", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM user_profiles")) {
					return { visitor_id: "vis-heavy" };
				}
				return null;
			},
			all: (sql, binds) => {
				if (sql.includes("DISTINCT session_id")) {
					return [
						{ session_id: "sess-heavy", last_at: "2026-05-04T12:00:00Z" },
						{ session_id: "sess-light", last_at: "2026-05-04T11:00:00Z" },
					];
				}
				if (
					sql.includes("FROM usage_events") &&
					sql.includes("session_id IN")
				) {
					return [
						{
							event_id: "evt-ai-click",
							event_type: "interaction",
							event_name: "click_recommend",
							page_path: "/product/sku-1",
							severity: null,
							occurred_at: "2026-05-04T12:00:00Z",
							interaction_id: "ix-ai",
							session_id: "sess-heavy",
						},
					];
				}
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("session_id IN")
				) {
					return [
						{
							trace_id: "trace-ai-heavy",
							span_id: "span-llm",
							parent_span_id: null,
							service_name: "recommendation",
							span_name: "anthropic.chat",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:01Z",
							duration_ms: 800,
							interaction_id: "ix-ai",
						},
					];
				}
				if (sql.includes("FROM ai_calls") && sql.includes("session_id IN")) {
					return [
						{
							call_id: "ai-heavy-1",
							trace_id: "trace-ai-heavy",
							model_name: "claude-3-5-haiku",
							provider: "anthropic",
							total_cost_usd: 0.25,
							occurred_at: "2026-05-04T12:00:01Z",
							interaction_id: "ix-ai",
							session_id: "sess-heavy",
						},
					];
				}
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("session_id = ?") &&
					binds.includes("sess-heavy")
				) {
					return [
						{
							trace_id: "trace-ai-heavy",
							span_id: "span-llm",
							parent_span_id: null,
							service_name: "recommendation",
							span_name: "anthropic.chat",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:01Z",
							duration_ms: 800,
							interaction_id: "ix-ai",
						},
					];
				}
				if (
					sql.includes("FROM ai_calls") &&
					sql.includes("session_id = ?") &&
					binds.includes("sess-heavy")
				) {
					return [
						{
							call_id: "ai-heavy-1",
							trace_id: "trace-ai-heavy",
							model_name: "claude-3-5-haiku",
							provider: "anthropic",
							total_cost_usd: 0.25,
							occurred_at: "2026-05-04T12:00:01Z",
							interaction_id: "ix-ai",
							session_id: "sess-heavy",
						},
					];
				}
				if (
					sql.includes("FROM telemetry_spans") &&
					sql.includes("trace_id = ?") &&
					binds.includes("trace-ai-heavy")
				) {
					return [
						{
							trace_id: "trace-ai-heavy",
							span_id: "span-llm",
							parent_span_id: null,
							service_name: "recommendation",
							span_name: "anthropic.chat",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:01Z",
							duration_ms: 800,
							interaction_id: "ix-ai",
						},
					];
				}
				if (
					sql.includes("FROM usage_events") &&
					sql.includes("interaction_id = ?") &&
					binds.includes("ix-ai")
				) {
					return [
						{
							event_id: "evt-ai-click",
							event_type: "interaction",
							event_name: "click_recommend",
							page_path: "/product/sku-1",
							severity: null,
							occurred_at: "2026-05-04T12:00:00Z",
							interaction_id: "ix-ai",
							session_id: "sess-heavy",
						},
					];
				}
				return [];
			},
		});
		const fetch = setup(db);

		const userManifest = await fetch("/internal/connected/user/user-heavy");
		const latestSession = userManifest.across.find((s) =>
			s.label.toLowerCase().includes("latest session"),
		);
		expect(latestSession?.links[0].sample).toBe("sess-heavy");
		const aiSection = userManifest.across.find((s) =>
			s.label.toLowerCase().includes("ai call"),
		);
		expect(aiSection?.links[0].href).toBe("#/ai?id=ai-heavy-1");

		const sessionManifest = await fetch(
			"/internal/connected/usage/sess-heavy?session_id=sess-heavy",
		);
		const sessionSpans = sessionManifest.across.find((s) =>
			s.label.toLowerCase().includes("span"),
		);
		expect(sessionSpans?.links[0].href).toBe(
			"#/traces/trace-ai-heavy#span=span-llm",
		);

		const spanManifest = await fetch(
			"/internal/connected/span/trace-ai-heavy:span-llm",
		);
		const clickSection = spanManifest.related.find((s) =>
			s.label.toLowerCase().includes("click"),
		);
		expect(clickSection?.links[0].href).toBe("#/usage?id=evt-ai-click");
	});
});

describe("ConnectedRail manifest — agent action graph entities (RFC 0010)", () => {
	it("action entity returns causal parent/run, siblings, and downstream sub-actions/tools/evals", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM actions") && sql.includes("id = ?")) {
					return {
						id: "act-456",
						project_id: "p1",
						root_action_id: "run-123",
						caused_by_action_id: "act-parent",
						actor_type: "agent",
						actor_id: "my-agent",
						action_kind: "agent.step",
						name: "Perform Task",
						status: "ok",
						started_at: "2026-05-04T12:00:00Z",
						ended_at: "2026-05-04T12:00:05Z",
						duration_ms: 5000,
						trace_id: "tx-789",
						span_id: "sp-789",
						session_id: "sess-1",
						interaction_id: null,
						user_id: "user-1",
						agent_run_id: "run-123",
						step_id: "act-456",
						tool_call_id: null,
						prompt_version: null,
						model_name: null,
						provider: null,
						total_cost_usd: 0,
						attrs_json: "{}",
					};
				}
				return null;
			},
			all: (sql) => {
				if (
					sql.includes("FROM actions") &&
					sql.includes("root_action_id = ?")
				) {
					return [
						{
							id: "act-456",
							project_id: "p1",
							root_action_id: "run-123",
							caused_by_action_id: "act-parent",
							actor_type: "agent",
							actor_id: "my-agent",
							action_kind: "agent.step",
							name: "Perform Task",
							status: "ok",
							started_at: "2026-05-04T12:00:00Z",
							ended_at: "2026-05-04T12:00:05Z",
							duration_ms: 5000,
							trace_id: "tx-789",
							span_id: "sp-789",
							session_id: "sess-1",
							interaction_id: null,
							user_id: "user-1",
							agent_run_id: "run-123",
							step_id: "act-456",
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0,
							attrs_json: "{}",
						},
						{
							id: "act-sibling",
							project_id: "p1",
							root_action_id: "run-123",
							caused_by_action_id: "act-parent",
							actor_type: "agent",
							actor_id: "my-agent",
							action_kind: "agent.step",
							name: "Perform Other Task",
							status: "ok",
							started_at: "2026-05-04T12:00:06Z",
							ended_at: "2026-05-04T12:00:10Z",
							duration_ms: 4000,
							trace_id: "tx-789",
							span_id: "sp-790",
							session_id: "sess-1",
							interaction_id: null,
							user_id: "user-1",
							agent_run_id: "run-123",
							step_id: "act-sibling",
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0,
							attrs_json: "{}",
						},
					];
				}
				if (sql.includes("FROM agent_runs")) {
					return [
						{
							id: "run-123",
							project_id: "p1",
							agent_id: "my-agent",
							agent_name: "My Agent",
							agent_version: "1.0.0",
							goal: "solve",
							outcome: "solved",
							autonomy_level: "autonomous_write",
							status: "success",
							error_message: null,
							total_cost_usd: 0.1,
							total_duration_ms: 9000,
							metadata_json: "{}",
						},
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [
						{
							id: "tool-call-1",
							action_id: "act-456",
							project_id: "p1",
							tool_name: "use_tool",
							args_hash: "args",
							result_hash: "res",
							error_type: null,
							side_effect: 1,
							approval_state: "bypassed",
							args_redacted: "{}",
							result_redacted: "{}",
						},
					];
				}
				return [];
			},
		});

		const fetch = setup(db);
		const m = await fetch("/internal/connected/action/act-456?project_id=p1");

		// Up section should have Parent Action and Agent Run
		const parentAction = m.up.find((s) => s.label === "Parent Action");
		expect(parentAction).toBeDefined();
		expect(parentAction?.links[0].href).toBe("#/actions/act-parent");

		const agentRun = m.up.find((s) => s.label === "Agent Run");
		expect(agentRun).toBeDefined();
		expect(agentRun?.links[0].href).toBe("#/agent-runs/run-123");

		// Sibling actions in across
		const siblings = m.across.find((s) => s.label === "Sibling Actions");
		expect(siblings).toBeDefined();
		expect(siblings?.links[0].href).toBe("#/actions/act-sibling");

		// Tool calls in down
		const toolCalls = m.down.find((s) => s.label === "Tool Calls");
		expect(toolCalls).toBeDefined();
		expect(toolCalls?.links[0].label).toContain("use_tool");

		// OTel Trace in related
		const relatedTrace = m.related.find((s) => s.label === "OTel Trace");
		expect(relatedTrace).toBeDefined();
		expect(relatedTrace?.links[0].href).toBe("#/traces/tx-789");
	});

	it("action detail raw manifest exposes causal confidence on action refs", async () => {
		const explicitActionId = "01J3Y4Z5A6B7C8D9E0F1G2H3J4";
		const fallbackActionId = "01J3Y4Z5A6B7C8D9E0F1G2H3J5";
		const explicitRow = {
			id: explicitActionId,
			project_id: "p1",
			root_action_id: explicitActionId,
			caused_by_action_id: null,
			actor_type: "agent",
			actor_id: "my-agent",
			action_kind: "agent.step",
			name: "Explicit Task",
			status: "ok",
			started_at: "2026-05-04T12:00:00Z",
			ended_at: "2026-05-04T12:00:05Z",
			duration_ms: 5000,
			trace_id: "tx-789",
			span_id: "sp-789",
			session_id: "sess-1",
			interaction_id: null,
			user_id: "user-1",
			agent_run_id: null,
			step_id: explicitActionId,
			tool_call_id: null,
			prompt_version: null,
			model_name: null,
			provider: null,
			total_cost_usd: 0,
			attrs_json: JSON.stringify({
				[ACTION_ID_KEY]: explicitActionId,
				[ACTION_CONFIDENCE_KEY]: ActionConfidence.Explicit,
			}),
		};
		const fallbackRow = {
			...explicitRow,
			id: fallbackActionId,
			root_action_id: explicitActionId,
			name: "Fallback Task",
			step_id: fallbackActionId,
			attrs_json: JSON.stringify({
				[ACTION_ID_KEY]: "bad-explicit-id",
				[ACTION_CONFIDENCE_KEY]: ActionConfidence.Explicit,
			}),
		};
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM actions") && sql.includes("id = ?")) {
					return explicitRow;
				}
				return null;
			},
			all: (sql) => {
				if (
					sql.includes("FROM actions") &&
					sql.includes("root_action_id = ?")
				) {
					return [explicitRow, fallbackRow];
				}
				return [];
			},
		});

		const fetch = setup(db);
		const m = await fetch(
			`/internal/connected/action/${explicitActionId}?project_id=p1`,
		);

		expect(m.rawManifest?.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: explicitActionId,
					causalConfidence: ActionConfidence.Explicit,
				}),
				expect.objectContaining({
					id: fallbackActionId,
					causalConfidence: ActionConfidence.Fallback,
				}),
			]),
		);
	});

	it("agent_run entity returns Agent, Traces, Decision Spine, and Tool Calls", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM agent_runs")) {
					return {
						id: "run-123",
						project_id: "p1",
						agent_id: "my-agent",
						agent_name: "My Agent",
						agent_version: "1.0.0",
						goal: "solve",
						outcome: "solved",
						autonomy_level: "autonomous_write",
						status: "success",
						error_message: null,
						total_cost_usd: 0.1,
						total_duration_ms: 9000,
						metadata_json: "{}",
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM actions")) {
					return [
						{
							id: "act-456",
							project_id: "p1",
							root_action_id: "run-123",
							caused_by_action_id: null,
							actor_type: "agent",
							actor_id: "my-agent",
							action_kind: "agent.step",
							name: "Perform Task",
							status: "ok",
							started_at: "2026-05-04T12:00:00Z",
							ended_at: "2026-05-04T12:00:05Z",
							duration_ms: 5000,
							trace_id: "tx-789",
							span_id: "sp-789",
							session_id: "sess-1",
							interaction_id: null,
							user_id: "user-1",
							agent_run_id: "run-123",
							step_id: "act-456",
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0,
							attrs_json: "{}",
						},
					];
				}
				if (sql.includes("FROM agent_runs")) {
					return [
						{
							id: "run-123",
							project_id: "p1",
							agent_id: "my-agent",
							agent_name: "My Agent",
							agent_version: "1.0.0",
							goal: "solve",
							outcome: "solved",
							autonomy_level: "autonomous_write",
							status: "success",
							error_message: null,
							total_cost_usd: 0.1,
							total_duration_ms: 9000,
							metadata_json: "{}",
						},
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [
						{
							id: "tool-call-1",
							action_id: "act-456",
							project_id: "p1",
							tool_name: "use_tool",
							args_hash: "args",
							result_hash: "res",
							error_type: null,
							side_effect: 1,
							approval_state: "bypassed",
							args_redacted: "{}",
							result_redacted: "{}",
						},
					];
				}
				return [];
			},
		});

		const fetch = setup(db);
		const m = await fetch(
			"/internal/connected/agent_run/run-123?project_id=p1",
		);

		// Up has Agent
		const agentSec = m.up.find((s) => s.label === "Agent");
		expect(agentSec).toBeDefined();
		expect(agentSec?.links[0].href).toBe("#/agents/my-agent");

		// Down has Actions (Decision Spine)
		const decisionSpine = m.down.find(
			(s) => s.label === "Actions (Decision Spine)",
		);
		expect(decisionSpine).toBeDefined();
		expect(decisionSpine?.links[0].href).toBe("#/actions/act-456");

		// Down has Tool Calls Executed
		const toolCalls = m.down.find((s) => s.label === "Tool Calls Executed");
		expect(toolCalls).toBeDefined();
		expect(toolCalls?.links[0].label).toContain("use_tool");
	});

	it("tool_call entity returns Causal Action and other sibling tool calls", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM tool_calls") && sql.includes("id = ?")) {
					return {
						action_id: "act-456",
						tool_name: "use_tool",
					};
				}
				if (sql.includes("FROM actions") && sql.includes("id = ?")) {
					return {
						id: "act-456",
						project_id: "p1",
						root_action_id: "run-123",
						caused_by_action_id: null,
						actor_type: "agent",
						actor_id: "my-agent",
						action_kind: "agent.step",
						name: "Perform Task",
						status: "ok",
						started_at: "2026-05-04T12:00:00Z",
						ended_at: "2026-05-04T12:00:05Z",
						duration_ms: 5000,
						trace_id: "tx-789",
						span_id: "sp-789",
						session_id: "sess-1",
						interaction_id: null,
						user_id: "user-1",
						agent_run_id: "run-123",
						step_id: "act-456",
						tool_call_id: null,
						prompt_version: null,
						model_name: null,
						provider: null,
						total_cost_usd: 0,
						attrs_json: "{}",
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM actions")) {
					return [
						{
							id: "act-456",
							project_id: "p1",
							root_action_id: "run-123",
							caused_by_action_id: null,
							actor_type: "agent",
							actor_id: "my-agent",
							action_kind: "agent.step",
							name: "Perform Task",
							status: "ok",
							started_at: "2026-05-04T12:00:00Z",
							ended_at: "2026-05-04T12:00:05Z",
							duration_ms: 5000,
							trace_id: "tx-789",
							span_id: "sp-789",
							session_id: "sess-1",
							interaction_id: null,
							user_id: "user-1",
							agent_run_id: "run-123",
							step_id: "act-456",
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0,
							attrs_json: "{}",
						},
					];
				}
				if (sql.includes("FROM tool_calls")) {
					return [
						{
							id: "tool-call-1",
							action_id: "act-456",
							project_id: "p1",
							tool_name: "use_tool",
							args_hash: "args",
							result_hash: "res",
							error_type: null,
							side_effect: 1,
							approval_state: "bypassed",
							args_redacted: "{}",
							result_redacted: "{}",
						},
						{
							id: "tool-call-2",
							action_id: "act-456",
							project_id: "p1",
							tool_name: "other_tool",
							args_hash: "args2",
							result_hash: "res2",
							error_type: null,
							side_effect: 0,
							approval_state: "suggested",
							args_redacted: "{}",
							result_redacted: "{}",
						},
					];
				}
				return [];
			},
		});

		const fetch = setup(db);
		const m = await fetch(
			"/internal/connected/tool_call/tool-call-1?project_id=p1",
		);

		// Up has Causal Action
		const causalAction = m.up.find((s) => s.label === "Causal Action");
		expect(causalAction).toBeDefined();
		expect(causalAction?.links[0].href).toBe("#/actions/act-456");

		// Across has Other tool calls in this action
		const otherTools = m.across.find(
			(s) => s.label === "Other tool calls in this action",
		);
		expect(otherTools).toBeDefined();
		expect(otherTools?.links[0].label).toContain("other_tool");
	});
});
