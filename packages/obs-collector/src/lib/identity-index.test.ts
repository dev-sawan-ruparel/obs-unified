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
			(c) =>
				c.sql.includes("session_id") && c.binds.includes("proj-1"),
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
	it("throws NotImplemented rather than returning an empty manifest", async () => {
		const db = new MemSqlDb({ all: noRows, first: noFirst });
		const index = new IdentityIndex(db);
		await expect(index.byUser("proj-1", "user-1")).rejects.toThrow(
			/not implemented/i,
		);
	});
});
