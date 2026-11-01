/**
 * `metrics` alert signal: the per-series reductions, query validation, and
 * evaluation against the real migrated SQLite schema with points written by
 * the OTLP metrics ingest path (`MetricsStore.ingestBatch`).
 */

import type { AlertQueryMetrics, AlertRuleInput } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import type { DecodedMetricPoint } from "../otlp/decode";
import { AlertsStore } from "./alerts-store";
import {
	evaluateMetricQuery,
	type MetricPointSample,
	metricRatio,
	reduceSeries,
	validateMetricQuery,
} from "./metric-alerts";
import { MetricsStore } from "./metrics-store";
import { ProjectsStore } from "./projects-store";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const MIN = 60_000;
const ns = (ms: number) => (BigInt(ms) * 1_000_000n).toString();
const at = (minsAgo: number) => NOW.getTime() - minsAgo * MIN;

const pt = (
	minsAgo: number,
	value: number | null,
	over: Partial<MetricPointSample> = {},
): MetricPointSample => ({
	tsNs: ns(at(minsAgo)),
	startTsNs: ns(at(600)),
	value,
	count: null,
	sum: null,
	receivedAt: new Date(at(minsAgo)).toISOString(),
	...over,
});

const reduce = (
	points: MetricPointSample[],
	aggregation: Parameters<typeof reduceSeries>[1]["aggregation"],
	over: Partial<Parameters<typeof reduceSeries>[1]> = {},
) =>
	reduceSeries(points, {
		aggregation,
		field: "value",
		temporality: 2,
		windowStartNs: BigInt(at(5)) * 1_000_000n,
		windowSecs: 300,
		...over,
	});

describe("reduceSeries", () => {
	// Deliberately out of order: reductions follow producer time.
	const gauge = [pt(1, 7), pt(4, 3), pt(2, 5)];

	it("last / min / max / avg / sum", () => {
		expect(reduce(gauge, "last", { temporality: null })).toBe(7);
		expect(reduce(gauge, "min", { temporality: null })).toBe(3);
		expect(reduce(gauge, "max", { temporality: null })).toBe(7);
		expect(reduce(gauge, "avg", { temporality: null })).toBe(5);
		expect(reduce(gauge, "sum", { temporality: null })).toBe(15);
	});

	it("returns null for a series without usable points", () => {
		expect(reduce([], "last")).toBeNull();
		expect(reduce([pt(1, null)], "sum")).toBeNull();
	});

	it("cumulative increase sums positive deltas", () => {
		expect(reduce([pt(4, 10), pt(3, 12), pt(1, 15)], "increase")).toBe(5);
		// A single point of a long-running counter is only the baseline.
		expect(reduce([pt(1, 15)], "increase")).toBe(0);
	});

	it("cumulative increase treats a drop as a counter reset", () => {
		// 10 → 14 (+4), reset to 2 (+2), → 5 (+3)
		expect(reduce([pt(4, 10), pt(3, 14), pt(2, 2), pt(1, 5)], "increase")).toBe(
			9,
		);
	});

	it("cumulative increase treats a new start time as a reset", () => {
		const restart = ns(at(2.5));
		expect(
			reduce(
				[
					pt(4, 10),
					pt(3, 14),
					pt(2, 20, { startTsNs: restart }),
					pt(1, 21, { startTsNs: restart }),
				],
				"increase",
			),
		).toBe(4 + 20 + 1);
	});

	it("counts the first point in full when the counter started in the window", () => {
		const born = ns(at(3));
		expect(
			reduce(
				[pt(2, 1, { startTsNs: born }), pt(1, 3, { startTsNs: born })],
				"increase",
			),
		).toBe(3);
	});

	it("delta increase sums the values; rate divides by the window", () => {
		const deltas = [pt(4, 2), pt(3, 0), pt(1, 4)];
		expect(reduce(deltas, "increase", { temporality: 1 })).toBe(6);
		expect(reduce(deltas, "rate", { temporality: 1 })).toBeCloseTo(6 / 300);
		expect(reduce([pt(4, 10), pt(1, 40)], "rate")).toBeCloseTo(30 / 300);
	});

	it("reads histogram count and sum", () => {
		const hist = [
			pt(3, null, { count: 10, sum: 2.5 }),
			pt(1, null, { count: 16, sum: 4 }),
		];
		expect(reduce(hist, "increase", { field: "count" })).toBe(6);
		expect(reduce(hist, "increase", { field: "sum" })).toBe(1.5);
		expect(reduce(hist, "last", { field: "value" })).toBeNull();
	});
});

describe("metricRatio", () => {
	it("divides by the real denominator, only when it is > 0 and >= minDenominator", () => {
		expect(metricRatio(1, 10, 5)).toBe(0.1);
		expect(metricRatio(4, 4, 5)).toBe(0);
		// No attempts: no ratio, even with minDenominator 0.
		expect(metricRatio(3, 0, 0)).toBe(0);
		expect(metricRatio(3, -1, 0)).toBe(0);
		// Fractional denominators (rates) are not clamped to 1.
		expect(metricRatio(0.1, 0.5, 0)).toBeCloseTo(0.2);
	});
});

describe("reduceSeries bornInWindow", () => {
	it("counts a new series' first cumulative point as growth from 0", () => {
		const longRunningProcess = ns(at(600));
		const firstErrors = [
			pt(3, 2, { startTsNs: longRunningProcess }),
			pt(1, 5, { startTsNs: longRunningProcess }),
		];
		expect(reduce(firstErrors, "increase")).toBe(3);
		expect(reduce(firstErrors, "increase", { bornInWindow: true })).toBe(5);
		expect(
			reduce([pt(2, 4, { startTsNs: null })], "increase", {
				bornInWindow: true,
			}),
		).toBe(4);
		// Delta series are unaffected.
		expect(
			reduce(firstErrors, "increase", { bornInWindow: true, temporality: 1 }),
		).toBe(7);
	});
});

describe("validateMetricQuery", () => {
	const ok: AlertQueryMetrics = {
		metric: ["a_total", "b_total"],
		attributes: { route: "/x", code: 500, ok: false },
		resourceAttributes: { "service.namespace": "voice" },
		serviceName: "vbox",
		field: "value",
		aggregation: "increase",
		denominator: { metric: "c_total", aggregation: "increase" },
		minDenominator: 5,
	};

	it("accepts a full query", () => {
		expect(() => validateMetricQuery(ok)).not.toThrow();
		expect(() =>
			validateMetricQuery({ metric: "up", aggregation: "age_seconds" }),
		).not.toThrow();
	});

	it.each([
		[null, /query must be an object/],
		[{ aggregation: "last" }, /query.metric is required/],
		[{ metric: "", aggregation: "last" }, /query.metric must not be empty/],
		[{ metric: [], aggregation: "last" }, /at least one metric/],
		[{ metric: ["a", 3], aggregation: "last" }, /non-empty strings/],
		[{ metric: "a" }, /query.aggregation must be one of/],
		[{ metric: "a", aggregation: "p99" }, /query.aggregation must be one of/],
		[{ metric: "a", aggregation: "last", field: "bucket" }, /query.field/],
		[{ metric: "a", aggregation: "last", attributes: [] }, /query.attributes/],
		[
			{ metric: "a", aggregation: "last", attributes: { x: { y: 1 } } },
			/query.attributes.x must be a string/,
		],
		[
			{ metric: "a", aggregation: "last", metrics: "typo" },
			/query.metrics is not a metrics query field/,
		],
		[
			{ metric: "a", aggregation: "last", minDenominator: 5 },
			/minDenominator requires query.denominator/,
		],
		[
			{
				metric: "a",
				aggregation: "age_seconds",
				denominator: { metric: "b" },
			},
			/cannot be used with age_seconds/,
		],
		[
			{
				metric: "a",
				aggregation: "increase",
				denominator: { metric: "b", aggregation: "age_seconds" },
			},
			/query.denominator.aggregation must be one of/,
		],
		[
			{ metric: "a", aggregation: "increase", denominator: { metric: "" } },
			/query.denominator.metric must not be empty/,
		],
		[
			{
				metric: "a",
				aggregation: "increase",
				denominator: { metric: "b" },
				minDenominator: -1,
			},
			/minDenominator must be a finite number >= 0/,
		],
	])("rejects %j", (query, message) => {
		expect(() => validateMetricQuery(query)).toThrow(message);
	});
});

// ── Against the real SQLite schema ──────────────────────────────────────────

const decoded = (
	name: string,
	opts: {
		type?: DecodedMetricPoint["type"];
		temporality?: number | null;
		attrs?: Record<string, unknown>;
		resource?: Record<string, unknown>;
		service?: string;
		minsAgo: number;
		value?: number | null;
		count?: number | null;
		startMinsAgo?: number;
	},
): DecodedMetricPoint => {
	const resource = { "service.name": opts.service ?? "vbox", ...opts.resource };
	const attrs = opts.attrs ?? {};
	return {
		name,
		description: null,
		unit: null,
		type: opts.type ?? "sum",
		isMonotonic: (opts.type ?? "sum") === "sum" ? true : null,
		temporality: opts.temporality === undefined ? 2 : opts.temporality,
		scopeName: "test",
		scopeVersion: null,
		serviceName: opts.service ?? "vbox",
		resourceAttrsJson: JSON.stringify(resource),
		attributesJson: Object.keys(attrs).length ? JSON.stringify(attrs) : null,
		identity: JSON.stringify([resource, name, attrs]),
		tsNs: ns(at(opts.minsAgo)),
		startTsNs: ns(at(opts.startMinsAgo ?? 600)),
		value: opts.value === undefined ? null : opts.value,
		count: opts.count ?? null,
		sum: null,
		min: null,
		max: null,
		boundsJson: null,
		bucketCountsJson: null,
		extraJson: null,
		exemplarsJson: null,
	};
};

const setup = async () => {
	const db = createMigratedSqliteDb();
	const project = await new ProjectsStore(db).createProject({
		name: "M",
		slug: "m",
	});
	const metrics = new MetricsStore(db);
	/** Each call is one export, received `minsAgo` before NOW. */
	const ingest = async (minsAgo: number, points: DecodedMetricPoint[]) =>
		metrics.ingestBatch({
			projectId: project.id,
			points,
			receivedAt: new Date(at(minsAgo)).toISOString(),
			expiresAt: new Date(NOW.getTime() + 24 * 60 * MIN).toISOString(),
		});
	const evaluateFull = (
		query: AlertQueryMetrics,
		windowMins = 5,
		ruleCreatedAt = new Date(at(2)).toISOString(),
		maxLoadedPoints?: number,
	) =>
		evaluateMetricQuery(db, query, {
			projectId: project.id,
			windowMins,
			ruleCreatedAt,
			now: NOW,
			maxLoadedPoints,
		});
	const evaluate = async (
		query: AlertQueryMetrics,
		windowMins = 5,
		ruleCreatedAt = new Date(at(2)).toISOString(),
	) => (await evaluateFull(query, windowMins, ruleCreatedAt)).value;
	return { db, project, ingest, evaluate, evaluateFull };
};

describe("evaluateMetricQuery (SQLite)", () => {
	it("sums per-series increases across series and metric names, filtered by attributes", async () => {
		const { db, ingest, evaluate } = await setup();
		const series = (name: string, code: number, minsAgo: number, v: number) =>
			decoded(name, { attrs: { code, route: "/call" }, minsAgo, value: v });
		// History before the window (7 min ago): not counted, not a baseline,
		// but it makes these series "not new".
		await ingest(7, [
			series("calls_in_total", 500, 7, 1),
			series("calls_in_total", 200, 7, 40),
			series("calls_out_total", 500, 7, 9),
		]);
		await ingest(4, [
			series("calls_in_total", 500, 4, 2),
			series("calls_in_total", 200, 4, 50),
			series("calls_out_total", 500, 4, 10),
		]);
		await ingest(1, [
			series("calls_in_total", 500, 1, 5),
			series("calls_in_total", 200, 1, 80),
			series("calls_out_total", 500, 1, 11),
		]);

		expect(
			await evaluate({
				metric: ["calls_in_total", "calls_out_total"],
				attributes: { code: "500" },
				aggregation: "increase",
			}),
		).toBe(3 + 1);
		expect(
			await evaluate({ metric: "calls_in_total", aggregation: "increase" }),
		).toBe(3 + 30);
		expect(
			await evaluate({
				metric: "calls_in_total",
				attributes: { code: 200, route: "/call" },
				aggregation: "rate",
			}),
		).toBeCloseTo(30 / 300);
		// Filters that match nothing yield 0.
		expect(
			await evaluate({
				metric: "calls_in_total",
				attributes: { code: 404 },
				aggregation: "increase",
			}),
		).toBe(0);
		expect(
			await evaluate({
				metric: "calls_in_total",
				serviceName: "other",
				aggregation: "increase",
			}),
		).toBe(0);
		db.close();
	});

	it("matches resource attributes and reads gauges and histogram counts", async () => {
		const { db, ingest, evaluate } = await setup();
		await ingest(9, [
			decoded("turn_ms", { type: "histogram", minsAgo: 9, count: 4 }),
		]);
		await ingest(3, [
			decoded("pg_up", {
				type: "gauge",
				temporality: null,
				resource: { "deployment.environment": "prod" },
				minsAgo: 3,
				value: 1,
			}),
			decoded("pg_up", {
				type: "gauge",
				temporality: null,
				resource: { "deployment.environment": "staging" },
				minsAgo: 3,
				value: 1,
			}),
			decoded("turn_ms", {
				type: "histogram",
				minsAgo: 3,
				count: 10,
			}),
		]);
		await ingest(1, [
			decoded("pg_up", {
				type: "gauge",
				temporality: null,
				resource: { "deployment.environment": "prod" },
				minsAgo: 1,
				value: 0,
			}),
			decoded("turn_ms", { type: "histogram", minsAgo: 1, count: 25 }),
		]);
		expect(
			await evaluate({
				metric: "pg_up",
				resourceAttributes: { "deployment.environment": "prod" },
				aggregation: "last",
			}),
		).toBe(0);
		expect(await evaluate({ metric: "pg_up", aggregation: "max" })).toBe(2);
		expect(
			await evaluate({
				metric: "turn_ms",
				field: "count",
				aggregation: "increase",
			}),
		).toBe(15);
		db.close();
	});

	it("handles counter resets and delta temporality from stored points", async () => {
		const { db, ingest, evaluate } = await setup();
		await ingest(7, [decoded("c_total", { minsAgo: 7, value: 99 })]);
		await ingest(4, [decoded("c_total", { minsAgo: 4, value: 100 })]);
		await ingest(3, [decoded("c_total", { minsAgo: 3, value: 104 })]);
		// Process restart: new start time, counter back near zero.
		await ingest(2, [
			decoded("c_total", { minsAgo: 2, value: 3, startMinsAgo: 2.5 }),
		]);
		await ingest(1, [
			decoded("c_total", { minsAgo: 1, value: 5, startMinsAgo: 2.5 }),
		]);
		const delta = (minsAgo: number, v: number) =>
			decoded("d_total", { temporality: 1, minsAgo, value: v });
		await ingest(3, [delta(3, 4)]);
		await ingest(1, [delta(1, 6)]);
		expect(await evaluate({ metric: "c_total", aggregation: "increase" })).toBe(
			4 + 3 + 2,
		);
		expect(await evaluate({ metric: "d_total", aggregation: "increase" })).toBe(
			10,
		);
		db.close();
	});

	it("computes an error ratio only above minDenominator", async () => {
		const { db, ingest, evaluate } = await setup();
		const attempts = (minsAgo: number, v: number) =>
			decoded("attempts_total", { minsAgo, value: v });
		const errors = (minsAgo: number, v: number) =>
			decoded("errors_total", { minsAgo, value: v });
		await ingest(8, [attempts(8, 100), errors(8, 7)]);
		await ingest(4, [attempts(4, 100), errors(4, 7)]);
		await ingest(1, [attempts(1, 104), errors(1, 9)]);
		const query: AlertQueryMetrics = {
			metric: "errors_total",
			aggregation: "increase",
			denominator: { metric: "attempts_total" },
			minDenominator: 5,
		};
		// 4 attempts < 5: not enough traffic to judge.
		expect(await evaluate(query)).toBe(0);
		await ingest(0.5, [attempts(0.5, 110)]);
		// 2 errors / 10 attempts
		expect(await evaluate(query)).toBeCloseTo(0.2);
		db.close();
	});

	it("age_seconds measures the newest point regardless of the window", async () => {
		const { db, ingest, evaluate } = await setup();
		await ingest(30, [
			decoded("heartbeat", {
				type: "gauge",
				temporality: null,
				minsAgo: 30,
				value: 1,
			}),
		]);
		await ingest(20, [
			decoded("heartbeat", {
				type: "gauge",
				temporality: null,
				attrs: { node: "b" },
				minsAgo: 20,
				value: 1,
			}),
		]);
		expect(
			await evaluate({ metric: "heartbeat", aggregation: "age_seconds" }, 1),
		).toBe(20 * 60);
		expect(
			await evaluate(
				{
					metric: "heartbeat",
					attributes: { node: "b" },
					aggregation: "age_seconds",
				},
				1,
			),
		).toBe(20 * 60);
		db.close();
	});

	it("age_seconds with no points at all counts from the rule's creation", async () => {
		const { db, evaluate } = await setup();
		const value = await evaluate(
			{ metric: "never_reported", aggregation: "age_seconds" },
			1,
			new Date(at(3)).toISOString(),
		);
		expect(value).toBe(180);
		expect(Number.isFinite(value)).toBe(true);
		expect(JSON.parse(JSON.stringify({ value }))).toEqual({ value: 180 });
		db.close();
	});
});

describe("evaluateMetricQuery review fixes (SQLite)", () => {
	const gauge = (name: string, host: string, minsAgo: number, value: number) =>
		decoded(name, {
			type: "gauge",
			temporality: null,
			resource: { "host.name": host },
			minsAgo,
			value,
		});

	it("counts the first errors of a series that appeared inside the window", async () => {
		const { db, ingest, evaluate } = await setup();
		const errors = (code: number, minsAgo: number, v: number) =>
			decoded("errors_total", {
				attrs: { code },
				minsAgo,
				value: v,
				startMinsAgo: 600,
			});
		// code=503 has history; code=500 is first seen 3 minutes ago.
		await ingest(9, [errors(503, 9, 4)]);
		await ingest(3, [errors(503, 3, 4), errors(500, 3, 2)]);
		await ingest(1, [errors(503, 1, 5), errors(500, 1, 3)]);
		expect(
			await evaluate({ metric: "errors_total", aggregation: "increase" }),
		).toBe(1 + 3);
		db.close();
	});

	it("drops series whose newest point is older than staleSecs", async () => {
		const { db, ingest, evaluate } = await setup();
		// host a stopped 8 minutes ago; host b replaced it.
		await ingest(8, [gauge("active_calls", "a", 8, 4)]);
		await ingest(1, [gauge("active_calls", "b", 1, 4)]);
		expect(
			await evaluate({ metric: "active_calls", aggregation: "last" }, 10),
		).toBe(4);
		expect(
			await evaluate(
				{ metric: "active_calls", aggregation: "last", staleSecs: 600 },
				10,
			),
		).toBe(8);
		db.close();
	});

	it("reports no data when no series is fresh, but never for age_seconds", async () => {
		const { db, ingest, evaluateFull } = await setup();
		await ingest(8, [gauge("pg_up", "a", 8, 1)]);
		expect(
			await evaluateFull({ metric: "pg_up", aggregation: "last" }, 10),
		).toEqual({ value: 0, noData: true });
		expect(
			await evaluateFull({ metric: "nothing", aggregation: "increase" }),
		).toEqual({ value: 0, noData: true });
		expect(
			await evaluateFull({ metric: "pg_up", aggregation: "age_seconds" }, 1),
		).toEqual({ value: 480, noData: false });
		expect(
			await evaluateFull({ metric: "nothing", aggregation: "age_seconds" }, 1),
		).toMatchObject({ noData: false });
		db.close();
	});

	it("a ratio has data when either side does", async () => {
		const { db, ingest, evaluateFull } = await setup();
		const attempts = (minsAgo: number, v: number) =>
			decoded("attempts_total", { minsAgo, value: v });
		await ingest(9, [attempts(9, 10)]);
		await ingest(2, [attempts(2, 20)]);
		expect(
			await evaluateFull({
				metric: "errors_total",
				aggregation: "increase",
				denominator: { metric: "attempts_total" },
			}),
		).toEqual({ value: 0, noData: false });
		db.close();
	});

	it("fails instead of computing a partial value past the point cap", async () => {
		const { db, ingest, evaluateFull } = await setup();
		for (const minsAgo of [4, 3, 2, 1]) {
			await ingest(minsAgo, [gauge("busy", "a", minsAgo, 1)]);
		}
		expect(
			(
				await evaluateFull(
					{ metric: "busy", aggregation: "sum" },
					5,
					undefined,
					4,
				)
			).value,
		).toBe(4);
		await expect(
			evaluateFull({ metric: "busy", aggregation: "sum" }, 5, undefined, 3),
		).rejects.toThrow(/loads more than 3 points/);
		db.close();
	});
});

describe("AlertsStore with metrics rules (SQLite)", () => {
	const input = (over: Partial<AlertRuleInput> = {}): AlertRuleInput => ({
		name: "pg down",
		signal: "metrics",
		query: { metric: "pg_up", aggregation: "last" },
		threshold: 0,
		windowMins: 1,
		comparison: "==",
		channels: [{ type: "webhook", url: "https://hooks.example.com/a" }],
		pendingSecs: 30,
		...over,
	});

	it("stores, lists and evaluates a metrics rule with pendingSecs", async () => {
		const { db, project, ingest } = await setup();
		const store = new AlertsStore(db);
		const rule = await store.createRule(project.id, input());
		expect(rule).toMatchObject({
			signal: "metrics",
			comparison: "==",
			pendingSecs: 30,
			pendingSince: null,
			query: { metric: "pg_up", aggregation: "last" },
		});
		await ingest(0.5, [
			decoded("pg_up", {
				type: "gauge",
				temporality: null,
				minsAgo: 0.5,
				value: 0,
			}),
		]);
		expect(await store.evaluateRule(rule, NOW)).toBe(0);
		expect(await store.evaluateRuleWithStatus(rule, NOW)).toEqual({
			value: 0,
			noData: false,
		});
		const updated = await store.updateRule(rule.id, project.id, {
			pendingSecs: 0,
		});
		expect(updated?.pendingSecs).toBe(0);
		expect((await store.listRules(project.id))[0].pendingSecs).toBe(0);
		db.close();
	});

	it("rejects malformed metric queries and pending durations", async () => {
		const { db, project } = await setup();
		const store = new AlertsStore(db);
		await expect(
			store.createRule(project.id, input({ query: { metric: "x" } as never })),
		).rejects.toThrow(/query.aggregation must be one of/);
		await expect(
			store.createRule(project.id, input({ pendingSecs: 1.5 })),
		).rejects.toThrow(/pendingSecs must be an integer/);
		await expect(
			store.createRule(project.id, input({ pendingSecs: 90_000 })),
		).rejects.toThrow(/pendingSecs must be an integer from 0 to 86400/);
		await expect(
			store.createRule(project.id, input({ windowMins: 1441 })),
		).rejects.toThrow(/windowMins must be <= 1440 for the metrics signal/);
		await expect(
			store.createRule(
				project.id,
				input({
					query: { metric: "x", aggregation: "last", staleSecs: 0 },
				}),
			),
		).rejects.toThrow(/staleSecs must be an integer from 1 to 86400/);
		await expect(
			store.createRule(
				project.id,
				input({
					query: {
						metric: "x",
						aggregation: "last",
						noData: "ignore",
					} as never,
				}),
			),
		).rejects.toThrow(/noData must be one of: zero, keep/);
		db.close();
	});
});
