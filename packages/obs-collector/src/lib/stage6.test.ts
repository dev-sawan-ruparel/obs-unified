/**
 * RFC 0002 Stage 6 — auto-pinning + alert→analysis binding behaviour tests.
 *
 * Uses the shared MemSqlDb test double from RFC 0008. The test asserts on
 * the *decisions* — which SQL we issue, which value the evaluator returns —
 * not the SQL grammar.
 */

import type { AlertRule } from "@obs-unified/types";
import { describe, expect, it } from "vitest";
import { AlertsStore } from "./alerts-store";
import { AnalysesStore } from "./analyses-store";
import { MemSqlDb } from "./test-utils/mem-sql-db";

// ── Auto-pin ──

describe("AnalysesStore.recordAskEvidence", () => {
	it("inserts one row per unique analysis id", async () => {
		const db = new MemSqlDb();
		const store = new AnalysesStore(db);
		await store.recordAskEvidence("default", [
			"a",
			"b",
			"a", // dedupe
		]);
		const inserts = db.callsMatching("INSERT INTO ask_evidence_events");
		expect(inserts).toHaveLength(2);
		expect(inserts.map((c) => c.binds[1])).toEqual(
			expect.arrayContaining(["a", "b"]),
		);
	});

	it("is a no-op when no ids supplied", async () => {
		const db = new MemSqlDb();
		const store = new AnalysesStore(db);
		await store.recordAskEvidence("default", []);
		expect(db.calls).toHaveLength(0);
	});
});

describe("AnalysesStore.getTopAskedAnalyses", () => {
	it("orders by citation count desc, returns analysisId+citations", async () => {
		const db = new MemSqlDb({
			all: () => [
				{ analysis_id: "service_error_rate::checkout", citations: 7 },
				{ analysis_id: "overall_error_rate", citations: 3 },
			],
		});
		const store = new AnalysesStore(db);
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
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM analysis_results")) return { primary_value: 42 };
				return null;
			},
		});
		const store = new AlertsStore(db);
		const rule = baseRule({ analysisId: "overall_error_rate" });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(42);
		// And we never fell through to the spans evaluator.
		expect(db.callsMatching("FROM telemetry_spans")).toHaveLength(0);
	});

	it("returns 0 when the analysis has no result yet (rule treats as 'no signal')", async () => {
		const db = new MemSqlDb({
			first: () => null,
		});
		const store = new AlertsStore(db);
		const rule = baseRule({ analysisId: "brand_new_analysis" });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(0);
	});

	it("falls through to legacy signal evaluator when analysisId is not set", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM telemetry_spans")) return { c: 5 };
				return null;
			},
		});
		const store = new AlertsStore(db);
		const rule = baseRule({ analysisId: null });
		const value = await store.evaluateRule(rule);
		expect(value).toBe(5);
	});
});

describe("AlertsStore.getAnalysisNarrative", () => {
	it("returns the most recent narrative + status row", async () => {
		const db = new MemSqlDb({
			first: () => ({
				narrative: "p95 jumped to 320ms (was 90ms) starting 8m ago",
				status: "warn",
			}),
		});
		const store = new AlertsStore(db);
		const out = await store.getAnalysisNarrative(
			"default",
			"latency_p95_overall",
		);
		expect(out).toEqual({
			narrative: "p95 jumped to 320ms (was 90ms) starting 8m ago",
			status: "warn",
		});
	});

	it("returns null when there's no result yet", async () => {
		const db = new MemSqlDb({ first: () => null });
		const store = new AlertsStore(db);
		const out = await store.getAnalysisNarrative("default", "nope");
		expect(out).toBeNull();
	});
});

describe("AlertsStore.listEvaluations evidence references", () => {
	it("adds alert and bound-analysis evidence references to evaluation rows", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM alert_rules")) {
					return {
						id: "rule-1",
						project_id: "default",
						name: "Checkout latency",
						signal: "spans",
						query_json: "{}",
						threshold: 100,
						window_mins: 5,
						comparison: ">",
						channels_json: "[]",
						enabled: 1,
						created_at: "2026-05-01T00:00:00.000Z",
						updated_at: "2026-05-01T00:00:00.000Z",
						analysis_id: "latency.p95",
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM alert_evaluations")) {
					return [
						{
							id: "eval-1",
							rule_id: "rule-1",
							project_id: "default",
							evaluated_at: "2026-05-01T00:05:00.000Z",
							value: 320,
							state: "firing",
							notified: 1,
						},
					];
				}
				return [];
			},
		});
		const store = new AlertsStore(db);

		const evaluations = await store.listEvaluations({
			ruleId: "rule-1",
			projectId: "default",
			hours: 24,
		});

		expect(evaluations[0].evidenceReferences).toEqual([
			expect.objectContaining({
				evidenceId: "alert:rule-1:evaluation:eval-1",
				entityKind: "alert",
				entityId: "rule-1",
				route: "#/alerts?alert=rule-1",
				source: "alert_evaluations",
			}),
			expect.objectContaining({
				evidenceId: "alert:rule-1:evaluation:eval-1:analysis:latency.p95",
				entityKind: "analysis",
				entityId: "latency.p95",
				route: "#/investigate/latency.p95",
				source: "alert_rules.analysis_id",
			}),
		]);
	});
});
