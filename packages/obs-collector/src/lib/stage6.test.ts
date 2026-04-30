/**
 * RFC 0002 Stage 6 — auto-pinning + alert→analysis binding behaviour tests.
 *
 * We don't spin up D1 here; instead we hand-roll a tiny FakeDb that records
 * the prepare/bind sequence and replays canned responses. The goal is
 * coverage of the *decisions* — which SQL we issue, which value the
 * evaluator returns — not the SQL grammar.
 */

import type { AlertRule } from "@obs/types";
import { describe, expect, it } from "vitest";
import { AlertsStore } from "./alerts-store";
import { AnalysesStore } from "./analyses-store";

// ── Fake D1 ──

type FirstResult = Record<string, unknown> | null;
interface AllResult<T = Record<string, unknown>> {
	results: T[];
}

interface FakeDbOptions {
	first?: (sql: string, binds: unknown[]) => FirstResult;
	all?: (sql: string, binds: unknown[]) => AllResult;
}

class FakeDb {
	calls: Array<{ sql: string; binds: unknown[] }> = [];
	constructor(private opts: FakeDbOptions = {}) {}
	prepare(sql: string) {
		const calls = this.calls;
		const opts = this.opts;
		let binds: unknown[] = [];
		const stmt: {
			bind: (...args: unknown[]) => typeof stmt;
			first: <T = Record<string, unknown>>() => Promise<T | null>;
			all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
			run: () => Promise<{ meta: { changes: number } }>;
		} = {
			bind: (...args: unknown[]) => {
				binds = args;
				return stmt;
			},
			first: async <T = Record<string, unknown>>() => {
				calls.push({ sql, binds });
				const r = opts.first ? opts.first(sql, binds) : null;
				return (r ?? null) as T | null;
			},
			all: async <T = Record<string, unknown>>() => {
				calls.push({ sql, binds });
				const r = opts.all ? opts.all(sql, binds) : { results: [] };
				return r as { results: T[] };
			},
			run: async () => {
				calls.push({ sql, binds });
				return { meta: { changes: 1 } };
			},
		};
		return stmt;
	}
}

// ── Auto-pin ──

describe("AnalysesStore.recordAskEvidence", () => {
	it("inserts one row per unique analysis id", async () => {
		const db = new FakeDb();
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AnalysesStore(db as any);
		await store.recordAskEvidence("default", [
			"a",
			"b",
			"a", // dedupe
		]);
		const inserts = db.calls.filter((c) =>
			c.sql.includes("INSERT INTO ask_evidence_events"),
		);
		expect(inserts).toHaveLength(2);
		expect(inserts.map((c) => c.binds[1])).toEqual(
			expect.arrayContaining(["a", "b"]),
		);
	});

	it("is a no-op when no ids supplied", async () => {
		const db = new FakeDb();
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AnalysesStore(db as any);
		await store.recordAskEvidence("default", []);
		expect(db.calls).toHaveLength(0);
	});
});

describe("AnalysesStore.getTopAskedAnalyses", () => {
	it("orders by citation count desc, returns analysisId+citations", async () => {
		const db = new FakeDb({
			all: () => ({
				results: [
					{ analysis_id: "service_error_rate::checkout", citations: 7 },
					{ analysis_id: "overall_error_rate", citations: 3 },
				],
			}),
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AnalysesStore(db as any);
		const top = await store.getTopAskedAnalyses("default");
		expect(top).toEqual([
			{ analysisId: "service_error_rate::checkout", citations: 7 },
			{ analysisId: "overall_error_rate", citations: 3 },
		]);
	});
});

// ── Alert binding ──

const baseRule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
	id: "r1",
	projectId: "default",
	name: "checkout errors",
	signal: "spans",
	query: { kind: "spans" } as unknown as AlertRule["query"],
	threshold: 1,
	windowMins: 5,
	comparison: ">",
	channels: [],
	enabled: true,
	createdAt: "2026-04-29T00:00:00Z",
	updatedAt: "2026-04-29T00:00:00Z",
	...overrides,
});

describe("AlertsStore.evaluateRule with analysisId binding", () => {
	it("reads analysis_results.primary_value when analysisId is set", async () => {
		const db = new FakeDb({
			first: (sql) => {
				if (sql.includes("FROM analysis_results"))
					return { primary_value: 42 };
				return null;
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AlertsStore(db as any);
		const rule = baseRule({ analysisId: "overall_error_rate" });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(42);
		// And we never fell through to the spans evaluator.
		const spanCalls = db.calls.filter((c) =>
			c.sql.includes("FROM telemetry_spans"),
		);
		expect(spanCalls).toHaveLength(0);
	});

	it("returns 0 when the analysis has no result yet (rule treats as 'no signal')", async () => {
		const db = new FakeDb({
			first: () => null,
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AlertsStore(db as any);
		const rule = baseRule({ analysisId: "brand_new_analysis" });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(0);
	});

	it("falls through to legacy signal evaluator when analysisId is not set", async () => {
		const db = new FakeDb({
			first: (sql) => {
				if (sql.includes("FROM telemetry_spans")) return { c: 5 };
				return null;
			},
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AlertsStore(db as any);
		const rule = baseRule({ analysisId: null });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(5);
	});
});

describe("AlertsStore.getAnalysisNarrative", () => {
	it("returns the most recent narrative + status row", async () => {
		const db = new FakeDb({
			first: () => ({
				narrative: "p95 jumped to 320ms (was 90ms) starting 8m ago",
				status: "warn",
			}),
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AlertsStore(db as any);
		const out = await store.getAnalysisNarrative("default", "latency_p95_overall");
		expect(out).toEqual({
			narrative: "p95 jumped to 320ms (was 90ms) starting 8m ago",
			status: "warn",
		});
	});

	it("returns null when there's no result yet", async () => {
		const db = new FakeDb({ first: () => null });
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const store = new AlertsStore(db as any);
		const out = await store.getAnalysisNarrative("default", "nope");
		expect(out).toBeNull();
	});
});
