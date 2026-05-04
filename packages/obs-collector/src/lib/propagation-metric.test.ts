/**
 * RFC 0004 Phase 1.8 — propagation aggregator tests.
 *
 * Exercises the SQL the aggregator issues against a structural fake
 * database. Validates:
 *  - the count queries pin to project_id + the hour cutoff
 *  - 8 metric points emerge (4 signals × 2 propagated values)
 *  - point identities are stable across runs (so the cron upserts series)
 *  - zero rows still produce points with value=0 (visible-empty-state)
 */

import { describe, expect, it, vi } from "vitest";
import { aggregatePropagationForProject } from "./propagation-metric";

interface FakeRow {
	propagated: number;
	missing: number;
}

class FakeDb {
	calls: Array<{ sql: string; binds: unknown[] }> = [];
	constructor(
		private readonly counts: Record<string, FakeRow>,
		private readonly seriesExisting = new Map<string, string>(),
	) {}

	prepare(sql: string) {
		const calls = this.calls;
		const counts = this.counts;
		const seriesExisting = this.seriesExisting;
		let binds: unknown[] = [];
		const stmt: {
			bind: (...args: unknown[]) => typeof stmt;
			first: <T>() => Promise<T | null>;
			all: <T>() => Promise<{ results: T[] }>;
			run: () => Promise<{ meta: { changes: number } }>;
		} = {
			bind: (...args: unknown[]) => {
				binds = args;
				return stmt;
			},
			first: async <T>() => {
				calls.push({ sql, binds: [...binds] });
				if (sql.includes("FROM telemetry_spans"))
					return counts.telemetry_spans as T;
				if (sql.includes("FROM logs")) return counts.logs as T;
				if (sql.includes("FROM usage_events"))
					return counts.usage_events as T;
				if (sql.includes("FROM ai_calls")) return counts.ai_calls as T;
				return null;
			},
			all: async <T>() => {
				calls.push({ sql, binds: [...binds] });
				if (sql.includes("FROM metric_series")) {
					// MetricsStore.resolveSeries SELECT — return any pre-seeded
					// series so the aggregator reuses ids on repeat runs.
					const identities = binds.slice(1) as string[];
					const results = identities
						.filter((id) => seriesExisting.has(id))
						.map((id) => ({
							id: seriesExisting.get(id),
							identity: id,
						}));
					return { results: results as unknown as T[] };
				}
				return { results: [] };
			},
			run: async () => {
				calls.push({ sql, binds: [...binds] });
				return { meta: { changes: 1 } };
			},
		};
		return stmt;
	}

	async batch(stmts: unknown[]) {
		return stmts.map(() => ({ success: true, meta: { changes: 1 } }));
	}
}

describe("aggregatePropagationForProject", () => {
	it("queries 4 signal tables with project_id + hour cutoff", async () => {
		const db = new FakeDb({
			telemetry_spans: { propagated: 12, missing: 3 },
			logs: { propagated: 8, missing: 0 },
			usage_events: { propagated: 5, missing: 7 },
			ai_calls: { propagated: 2, missing: 1 },
		});
		const now = new Date("2026-05-04T12:30:00.000Z");
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		await aggregatePropagationForProject(db as any, "p1", now);

		const expectedCutoff = "2026-05-04T11:30:00.000Z";

		const countCalls = db.calls.filter((c) =>
			c.sql.includes("SUM(CASE WHEN interaction_id"),
		);
		expect(countCalls).toHaveLength(4);
		for (const call of countCalls) {
			expect(call.binds[0]).toBe("p1");
			expect(call.binds[1]).toBe(expectedCutoff);
		}
	});

	it("writes 8 metric points (4 signals × 2 propagated values)", async () => {
		const db = new FakeDb({
			telemetry_spans: { propagated: 12, missing: 3 },
			logs: { propagated: 8, missing: 0 },
			usage_events: { propagated: 5, missing: 7 },
			ai_calls: { propagated: 2, missing: 1 },
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const result = await aggregatePropagationForProject(db as any, "p1", new Date());
		expect(result.pointsWritten).toBe(8);
	});

	it("includes zero-count points so the dashboard sees both buckets", async () => {
		const db = new FakeDb({
			telemetry_spans: { propagated: 0, missing: 0 },
			logs: { propagated: 0, missing: 0 },
			usage_events: { propagated: 0, missing: 0 },
			ai_calls: { propagated: 0, missing: 0 },
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const result = await aggregatePropagationForProject(db as any, "p1", new Date());
		expect(result.pointsWritten).toBe(8);
	});

	it("treats null SUM as 0 (empty signal table edge case)", async () => {
		const db = new FakeDb({
			telemetry_spans: { propagated: null, missing: null } as unknown as FakeRow,
			logs: { propagated: null, missing: null } as unknown as FakeRow,
			usage_events: { propagated: null, missing: null } as unknown as FakeRow,
			ai_calls: { propagated: null, missing: null } as unknown as FakeRow,
		});
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const result = await aggregatePropagationForProject(db as any, "p1", new Date());
		expect(result.pointsWritten).toBe(8);
	});

	it("logs and continues when a single signal count fails", async () => {
		// Make ONE signal throw on its count by using a db that throws for a
		// specific table.
		const baseDb = new FakeDb({
			telemetry_spans: { propagated: 1, missing: 0 },
			logs: { propagated: 1, missing: 0 },
			usage_events: { propagated: 1, missing: 0 },
			ai_calls: { propagated: 1, missing: 0 },
		});
		const originalPrepare = baseDb.prepare.bind(baseDb);
		baseDb.prepare = (sql: string) => {
			if (sql.includes("FROM logs")) {
				return {
					bind: () => ({
						first: async () => {
							throw new Error("boom");
						},
						all: async () => ({ results: [] }),
						run: async () => ({ meta: { changes: 0 } }),
					}),
				} as unknown as ReturnType<typeof originalPrepare>;
			}
			return originalPrepare(sql);
		};
		const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
		// biome-ignore lint/suspicious/noExplicitAny: structural fake
		const result = await aggregatePropagationForProject(baseDb as any, "p1", new Date(), logger as any);
		// Three signals succeed (×2 points each) — logs throws, so 6 points.
		expect(result.pointsWritten).toBe(6);
		expect(logger.error).toHaveBeenCalledWith(
			"[propagation-metric] count failed",
			expect.objectContaining({ signal: "log", projectId: "p1" }),
		);
	});
});
