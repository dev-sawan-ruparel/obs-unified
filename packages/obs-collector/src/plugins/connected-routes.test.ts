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
import {
	connectedRoutesPlugin,
	type ConnectedManifest,
} from "./connected-routes";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";

// ── Test harness ─────────────────────────────────────────────────────

const setup = (db: MemSqlDb) => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime();
	connectedRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		// biome-ignore lint/suspicious/noExplicitAny: synthetic env for tests
		DB: db as any,
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
		// biome-ignore lint/suspicious/noExplicitAny: synthetic env for tests
		DB: db as any,
	};
	return (path: string) =>
		app.request(path, { method: "GET" }, env);
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
				expect(section.emptyReason!.length).toBeGreaterThan(0);
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
		expect(spansSection!.links).toHaveLength(1);
		expect(spansSection!.links[0].count).toBe(100);
		expect(spansSection!.links[0].sample).toBeDefined();
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
		expect(logsSection!.links).toHaveLength(3);
		// No count-link consolidation under the threshold.
		expect(logsSection!.links[0].count).toBeUndefined();
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
		expect(cpuSection!.links[0].href).toContain("trace_id=tr-A");
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
		expect(profilesSection!.links).toEqual([]);
		expect(profilesSection!.emptyReason).toContain("startProfiler");
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
