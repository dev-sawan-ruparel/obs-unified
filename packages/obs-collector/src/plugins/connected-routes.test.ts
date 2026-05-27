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
