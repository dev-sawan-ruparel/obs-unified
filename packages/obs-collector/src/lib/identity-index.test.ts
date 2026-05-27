/**
 * IdentityIndex tests — the SQL primitive every connected-rail and
 * timeline section is built on. We use MemSqlDb to assert which queries
 * the index issues and how it maps rows back into the EntityManifest
 * shape. Real D1 grammar is covered by integration tests; this is
 * decision coverage.
 */

import { describe, expect, it } from "vitest";
import { IdentityIndex } from "./identity-index";
import { MemSqlDb } from "./test-utils/mem-sql-db";

const noRows = () => [];
const noFirst = () => null;

describe("IdentityIndex.bySession", () => {
	it("issues one query per signal table + replay metadata and maps rows", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "t1",
							span_id: "s1",
							parent_span_id: null,
							service_name: "checkout",
							span_name: "POST /buy",
							status_code: "OK",
							status_message: null,
							start_time: "2026-05-01T00:00:00Z",
							duration_ms: 12,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM logs")) {
					return [
						{
							log_id: "l1",
							trace_id: "t1",
							span_id: "s1",
							service_name: "checkout",
							logger_name: "app",
							severity: "ERROR",
							message: "boom",
							occurred_at: "2026-05-01T00:00:01Z",
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM usage_events")) return [];
				if (sql.includes("FROM ai_calls")) return [];
				return [];
			},
			first: (sql) => {
				if (sql.includes("session_replay_metadata")) {
					return {
						first_chunk_at: "2026-05-01T00:00:00Z",
						last_chunk_at: "2026-05-01T00:00:30Z",
						chunk_count: 3,
						events_count: 42,
					};
				}
				return null;
			},
		});
		const index = new IdentityIndex(db);
		const manifest = await index.bySession("proj-1", "sess-123");

		expect(manifest.spans).toHaveLength(1);
		expect(manifest.spans[0].traceId).toBe("t1");
		expect(manifest.logs).toHaveLength(1);
		expect(manifest.logs[0].severity).toBe("ERROR");
		expect(manifest.usageEvents).toEqual([]);
		expect(manifest.aiCalls).toEqual([]);
		expect(manifest.replay).toEqual({
			sessionId: "sess-123",
			firstChunkAt: "2026-05-01T00:00:00Z",
			lastChunkAt: "2026-05-01T00:00:30Z",
			chunkCount: 3,
			eventsCount: 42,
		});

		// All five queries pin (project_id, session_id) — replay lookup uses
		// just session_id since replay is global.
		const allCalls = db.calls.filter((c) => c.op !== "first" || c.binds.length);
		const sessionQueries = allCalls.filter(
			(c) => c.sql.includes("session_id") && c.binds.includes("proj-1"),
		);
		expect(sessionQueries.length).toBeGreaterThanOrEqual(4);
	});

	it("returns null replay when session_replay_metadata is empty", async () => {
		const db = new MemSqlDb({ all: noRows, first: noFirst });
		const index = new IdentityIndex(db);
		const manifest = await index.bySession("proj-1", "sess-empty");
		expect(manifest.replay).toBeNull();
	});
});

describe("IdentityIndex.byTrace", () => {
	it("queries three tables, returns null replay (replays are session-scoped)", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "tx",
							span_id: "s1",
							parent_span_id: null,
							service_name: "api",
							span_name: "GET /",
							status_code: "OK",
							status_message: null,
							start_time: "2026-05-01T00:00:00Z",
							duration_ms: 5,
							interaction_id: "click-1",
						},
					];
				}
				return [];
			},
			first: noFirst,
		});
		const index = new IdentityIndex(db);
		const manifest = await index.byTrace("proj-1", "tx");

		expect(manifest.spans).toHaveLength(1);
		expect(manifest.spans[0].interactionId).toBe("click-1");
		expect(manifest.replay).toBeNull();

		const traceCalls = db.callsMatching("trace_id = ?");
		expect(traceCalls.length).toBeGreaterThanOrEqual(3);
	});
});

describe("IdentityIndex.byInteraction", () => {
	it("queries the four interaction-bearing tables", async () => {
		const db = new MemSqlDb({ all: noRows, first: noFirst });
		const index = new IdentityIndex(db);
		await index.byInteraction("proj-1", "click-abc");
		// spans + logs + usage + ai_calls — all keyed on interaction_id.
		const interactionCalls = db.callsMatching("interaction_id = ?");
		expect(interactionCalls.length).toBe(4);
		for (const c of interactionCalls) {
			expect(c.binds).toContain("proj-1");
			expect(c.binds).toContain("click-abc");
		}
	});
});

describe("IdentityIndex.byUser", () => {
	it("returns an empty manifest when no user_profiles row matches", async () => {
		const db = new MemSqlDb({ all: noRows, first: noFirst });
		const index = new IdentityIndex(db);
		const manifest = await index.byUser("proj-1", "user-nope");
		expect(manifest.spans).toEqual([]);
		expect(manifest.usageEvents).toEqual([]);
		expect(manifest.replay).toBeNull();
		// Only the user_profiles lookup should fire; we never get to the
		// session enumeration step.
		expect(db.callsMatching("FROM user_profiles")).toHaveLength(1);
		expect(db.callsMatching("FROM telemetry_spans")).toHaveLength(0);
	});

	it("returns empty (but does not error) when user exists with no usage sessions", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM user_profiles")) {
					return { visitor_id: "v-1" };
				}
				return null;
			},
			all: () => [],
		});
		const index = new IdentityIndex(db);
		const manifest = await index.byUser("proj-1", "user-1");
		expect(manifest.usageEvents).toEqual([]);
		expect(manifest.spans).toEqual([]);
		// User_profiles + session enumeration ran; signal tables did not.
		expect(db.callsMatching("FROM user_profiles")).toHaveLength(1);
		expect(db.callsMatching("DISTINCT session_id")).toHaveLength(1);
		expect(db.callsMatching("FROM telemetry_spans")).toHaveLength(0);
	});

	it("fans out across the user's recent sessions with IN-list binds", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM user_profiles")) return { visitor_id: "v-1" };
				return null;
			},
			all: (sql) => {
				if (sql.includes("DISTINCT session_id")) {
					return [
						{ session_id: "sess-A", last_at: "2026-05-04T12:00:00Z" },
						{ session_id: "sess-B", last_at: "2026-05-04T11:00:00Z" },
					];
				}
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							trace_id: "t1",
							span_id: "s1",
							parent_span_id: null,
							service_name: "api",
							span_name: "POST /buy",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-04T12:00:00Z",
							duration_ms: 200,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("FROM ai_calls")) {
					return [
						{
							call_id: "ai-1",
							trace_id: "t1",
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
		const index = new IdentityIndex(db);
		const manifest = await index.byUser("proj-1", "user-1");

		expect(manifest.spans).toHaveLength(1);
		expect(manifest.aiCalls).toHaveLength(1);
		expect(manifest.aiCalls[0].totalCostUsd).toBe(0.42);

		// Spans query must include both session_ids in the IN-list binds.
		const spanCall = db.callsMatching("FROM telemetry_spans")[0];
		expect(spanCall).toBeDefined();
		expect(spanCall.sql).toContain("session_id IN");
		expect(spanCall.binds).toContain("sess-A");
		expect(spanCall.binds).toContain("sess-B");
	});

	it("clamps sessions option to a safe upper bound", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM user_profiles")) return { visitor_id: "v-1" };
				return null;
			},
			all: () => [],
		});
		const index = new IdentityIndex(db);
		await index.byUser("proj-1", "user-1", { sessions: 9999 });

		const sessionsCall = db.callsMatching("DISTINCT session_id")[0];
		// Last bind is the LIMIT; should be clamped to ≤20.
		const limit = sessionsCall.binds[sessionsCall.binds.length - 1] as number;
		expect(limit).toBeLessThanOrEqual(20);
	});
});

describe("IdentityIndex.byAction", () => {
	it("materializes the entire causal decision tree and related signals", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("actions") && sql.includes("id = ?")) {
					return {
						id: "action-1",
						project_id: "proj-1",
						root_action_id: "root-1",
						caused_by_action_id: null,
						actor_type: "agent",
						actor_id: "agent-1",
						action_kind: "agent.run",
						name: "test-action",
						status: "ok",
						started_at: "2026-05-01T00:00:00Z",
						ended_at: "2026-05-01T00:00:10Z",
						duration_ms: 10000,
						trace_id: "t1",
						span_id: "s1",
						session_id: "sess-1",
						interaction_id: null,
						user_id: "user-1",
						agent_run_id: "root-1",
						step_id: null,
						tool_call_id: null,
						prompt_version: null,
						model_name: null,
						provider: null,
						total_cost_usd: 0.05,
						attrs_json: "{}",
					};
				}
				if (sql.includes("session_replay_metadata")) {
					return {
						session_id: "sess-1",
						first_chunk_at: "2026-05-01T00:00:00Z",
						last_chunk_at: "2026-05-01T00:00:30Z",
						chunk_count: 2,
						events_count: 20,
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("actions") && sql.includes("root_action_id = ?")) {
					return [
						{
							id: "action-1",
							project_id: "proj-1",
							root_action_id: "root-1",
							caused_by_action_id: null,
							actor_type: "agent",
							actor_id: "agent-1",
							action_kind: "agent.run",
							name: "test-action",
							status: "ok",
							started_at: "2026-05-01T00:00:00Z",
							ended_at: "2026-05-01T00:00:10Z",
							duration_ms: 10000,
							trace_id: "t1",
							span_id: "s1",
							session_id: "sess-1",
							interaction_id: null,
							user_id: "user-1",
							agent_run_id: "root-1",
							step_id: null,
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0.05,
							attrs_json: "{}",
						},
					];
				}
				if (sql.includes("agent_runs")) {
					return [
						{
							id: "root-1",
							project_id: "proj-1",
							agent_id: "agent-1",
							agent_name: "test-agent",
							agent_version: "1.0.0",
							goal: "test goal",
							outcome: "test success",
							autonomy_level: "autonomous_write",
							status: "success",
							error_message: null,
							total_cost_usd: 0.05,
							total_duration_ms: 10000,
							metadata_json: "{}",
						},
					];
				}
				if (sql.includes("tool_calls")) {
					return [
						{
							id: "tool-1",
							action_id: "action-1",
							project_id: "proj-1",
							tool_name: "test_tool",
							args_hash: "hash1",
							result_hash: "hash2",
							error_type: null,
							side_effect: 0,
							approval_state: "suggested",
							args_redacted: "{}",
							result_redacted: "{}",
						},
					];
				}
				if (sql.includes("retrieval_events")) return [];
				if (sql.includes("eval_results")) return [];
				if (sql.includes("artifacts")) return [];
				if (sql.includes("telemetry_spans")) {
					return [
						{
							trace_id: "t1",
							span_id: "s1",
							parent_span_id: null,
							service_name: "agent-service",
							span_name: "agent-run-span",
							status_code: 1,
							status_message: null,
							start_time: "2026-05-01T00:00:00Z",
							duration_ms: 10000,
							interaction_id: null,
						},
					];
				}
				if (sql.includes("logs")) return [];
				if (sql.includes("ai_calls")) return [];
				return [];
			},
		});

		const index = new IdentityIndex(db);
		const manifest = await index.byAction("proj-1", "action-1");

		expect(manifest.actions).toHaveLength(1);
		expect(manifest.actions[0].id).toBe("action-1");
		expect(manifest.actions[0].projectId).toBe("proj-1");
		expect(manifest.agentRuns).toHaveLength(1);
		expect(manifest.agentRuns[0].agentId).toBe("agent-1");
		expect(manifest.toolCalls).toHaveLength(1);
		expect(manifest.toolCalls[0].toolName).toBe("test_tool");
		expect(manifest.spans).toHaveLength(1);
		expect(manifest.spans[0].traceId).toBe("t1");
		expect(manifest.replay).not.toBeNull();
		expect(manifest.replay?.sessionId).toBe("sess-1");
	});

	it("returns empty structure when action does not exist", async () => {
		const db = new MemSqlDb({ first: noFirst, all: noRows });
		const index = new IdentityIndex(db);
		const manifest = await index.byAction("proj-1", "action-none");
		expect(manifest.actions).toEqual([]);
		expect(manifest.agentRuns).toEqual([]);
		expect(manifest.toolCalls).toEqual([]);
		expect(manifest.spans).toEqual([]);
	});
});

describe("IdentityIndex.byAgentRun", () => {
	it("resolves all child elements for a specific agent run", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("agent_runs")) {
					return {
						id: "run-123",
						project_id: "proj-1",
						agent_id: "my-agent",
						agent_name: "Agent 007",
						agent_version: "1.2.3",
						goal: "save the world",
						outcome: "world saved",
						autonomy_level: "autonomous_write",
						status: "success",
						error_message: null,
						total_cost_usd: 0.1,
						total_duration_ms: 5000,
						metadata_json: "{}",
					};
				}
				return null;
			},
			all: (sql) => {
				if (
					sql.includes("actions") &&
					(sql.includes("root_action_id") || sql.includes("agent_run_id"))
				) {
					return [
						{
							id: "action-root",
							project_id: "proj-1",
							root_action_id: "run-123",
							caused_by_action_id: null,
							actor_type: "agent",
							actor_id: "my-agent",
							action_kind: "agent.run",
							name: "root-run",
							status: "ok",
							started_at: "2026-05-01T12:00:00Z",
							ended_at: "2026-05-01T12:00:05Z",
							duration_ms: 5000,
							trace_id: "tx-123",
							span_id: "sp-123",
							session_id: "sess-123",
							interaction_id: null,
							user_id: null,
							agent_run_id: "run-123",
							step_id: null,
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: 0.1,
							attrs_json: "{}",
						},
					];
				}
				if (sql.includes("agent_runs")) {
					return [
						{
							id: "run-123",
							project_id: "proj-1",
							agent_id: "my-agent",
							agent_name: "Agent 007",
							agent_version: "1.2.3",
							goal: "save the world",
							outcome: "world saved",
							autonomy_level: "autonomous_write",
							status: "success",
							error_message: null,
							total_cost_usd: 0.1,
							total_duration_ms: 5000,
							metadata_json: "{}",
						},
					];
				}
				return [];
			},
		});

		const index = new IdentityIndex(db);
		const manifest = await index.byAgentRun("proj-1", "run-123");

		expect(manifest.agentRuns).toHaveLength(1);
		expect(manifest.agentRuns[0].agentId).toBe("my-agent");
		expect(manifest.actions).toHaveLength(1);
		expect(manifest.actions[0].id).toBe("action-root");
	});
});

describe("IdentityIndex.byActor", () => {
	it("retrieves recent actions and sub-elements for a specific actor", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("actions") && sql.includes("actor_type")) {
					return [
						{
							id: "action-actor",
							project_id: "proj-1",
							root_action_id: "run-abc",
							caused_by_action_id: null,
							actor_type: "user",
							actor_id: "actor-123",
							action_kind: "user.command",
							name: "execute command",
							status: "ok",
							started_at: "2026-05-01T15:00:00Z",
							ended_at: "2026-05-01T15:00:01Z",
							duration_ms: 1000,
							trace_id: null,
							span_id: null,
							session_id: null,
							interaction_id: null,
							user_id: null,
							agent_run_id: null,
							step_id: null,
							tool_call_id: null,
							prompt_version: null,
							model_name: null,
							provider: null,
							total_cost_usd: null,
							attrs_json: "{}",
						},
					];
				}
				return [];
			},
		});

		const index = new IdentityIndex(db);
		const manifest = await index.byActor("proj-1", "user", "actor-123");

		expect(manifest.actions).toHaveLength(1);
		expect(manifest.actions[0].actorId).toBe("actor-123");
		expect(manifest.actions[0].actorType).toBe("user");
	});
});
