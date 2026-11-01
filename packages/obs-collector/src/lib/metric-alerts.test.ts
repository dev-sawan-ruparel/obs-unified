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
	it("divides by max(denominator, 1) only above minDenominator", () => {
		expect(metricRatio(1, 10, 5)).toBe(0.1);
		expect(metricRatio(4, 4, 5)).toBe(0);
		expect(metricRatio(3, 0, 0)).toBe(3);
		expect(metricRatio(1, 0.5, 0)).toBe(1);
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
	const evaluate = (
		query: AlertQueryMetrics,
		windowMins = 5,
		ruleCreatedAt = new Date(at(2)).toISOString(),
	) =>
		evaluateMetricQuery(db, query, {
			projectId: project.id,
			windowMins,
			ruleCreatedAt,
			now: NOW,
		});
	return { db, project, ingest, evaluate };
};

describe("evaluateMetricQuery (SQLite)", () => {
	it("sums per-series increases across series and metric names, filtered by attributes", async () => {
		const { db, ingest, evaluate } = await setup();
		const series = (name: string, code: number, minsAgo: number, v: number) =>
			decoded(name, { attrs: { code, route: "/call" }, minsAgo, value: v });
		// Outside the window (7 min ago): ignored, not even a baseline.
		await ingest(7, [series("calls_in_total", 500, 7, 1)]);
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
		db.close();
	});
});
