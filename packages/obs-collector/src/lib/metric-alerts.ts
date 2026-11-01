/**
 * `metrics` alert signal: validation and evaluation of an
 * `AlertQueryMetrics` against `metric_series` / `metric_point`.
 *
 * Evaluation, per selector (numerator, then the optional denominator):
 *
 *   1. Series: `metric_series` rows of the project whose name is one of the
 *      selector's names (and whose `service_name` matches, when given), kept
 *      when every listed data-point / resource attribute equals the rule's
 *      value. Attribute values are compared as strings, so `200` matches a
 *      stored `"200"` and vice versa.
 *   2. Points: the series' points whose `received_at` (the collector's clock,
 *      as for every other alert signal) is inside the rule window, ordered by
 *      producer time (`ts_ns`). The number read is `field` (`value`, or a
 *      histogram/summary `count` / `sum`); points without it are skipped.
 *   3. Each series is reduced on its own (`reduceSeries`), and the per-series
 *      results are summed. A series with no usable point in the window adds
 *      nothing; with no series or no points the selector yields 0.
 *
 * `age_seconds` ignores the window: it is the seconds since the newest
 * `received_at` of any matching series. When no matching series has any
 * stored point (never reported, or everything aged out of retention) it is
 * the seconds since the rule was created, a finite number that grows until
 * the threshold is crossed, so "never reported" fires after the same grace
 * period as "stopped reporting".
 *
 * Ratio: with a `denominator`, value = numerator / max(denominator, 1) when
 * denominator >= minDenominator (default 0), else 0.
 */

import type {
	AlertMetricAggregation,
	AlertMetricAttributeValue,
	AlertMetricField,
	AlertMetricSelector,
	AlertQueryMetrics,
} from "@obsunified/types";
import type { SqlDb } from "./sql-db";

export const METRIC_AGGREGATIONS: readonly AlertMetricAggregation[] = [
	"last",
	"min",
	"max",
	"avg",
	"sum",
	"increase",
	"rate",
	"age_seconds",
];

export const METRIC_FIELDS: readonly AlertMetricField[] = [
	"value",
	"count",
	"sum",
];

/** OTLP `AggregationTemporality`. */
const TEMPORALITY_DELTA = 1;

const MAX_METRIC_NAMES = 20;
const MAX_ATTRIBUTE_KEYS = 32;
/** A rule matching more series than this is refused at evaluation time. */
export const MAX_MATCHED_SERIES = 1000;
/** Keeps each statement under D1's ~100 bound-parameter limit. */
const ID_CHUNK = 50;

const SELECTOR_KEYS = [
	"metric",
	"attributes",
	"resourceAttributes",
	"serviceName",
	"field",
];
const QUERY_KEYS = [
	...SELECTOR_KEYS,
	"aggregation",
	"denominator",
	"minDenominator",
];
const DENOMINATOR_KEYS = [...SELECTOR_KEYS, "aggregation"];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const validateAttributes = (value: unknown, path: string): void => {
	if (value === undefined) return;
	if (!isPlainObject(value))
		throw new Error(`${path} must be an object of attribute: value pairs`);
	const entries = Object.entries(value);
	if (entries.length > MAX_ATTRIBUTE_KEYS)
		throw new Error(`${path} may list at most ${MAX_ATTRIBUTE_KEYS} keys`);
	for (const [key, v] of entries) {
		if (!key.trim()) throw new Error(`${path} has an empty attribute name`);
		const ok =
			typeof v === "string" ||
			typeof v === "boolean" ||
			(typeof v === "number" && Number.isFinite(v));
		if (!ok)
			throw new Error(
				`${path}.${key} must be a string, finite number or boolean`,
			);
	}
};

const validateSelector = (
	q: Record<string, unknown>,
	path: string,
	allowedKeys: string[],
): void => {
	for (const key of Object.keys(q)) {
		if (!allowedKeys.includes(key))
			throw new Error(
				`${path}.${key} is not a metrics query field (allowed: ${allowedKeys.join(", ")})`,
			);
	}
	const metric = q.metric;
	if (typeof metric === "string") {
		if (!metric.trim()) throw new Error(`${path}.metric must not be empty`);
	} else if (Array.isArray(metric)) {
		if (metric.length === 0)
			throw new Error(`${path}.metric must name at least one metric`);
		if (metric.length > MAX_METRIC_NAMES)
			throw new Error(
				`${path}.metric may name at most ${MAX_METRIC_NAMES} metrics`,
			);
		for (const m of metric) {
			if (typeof m !== "string" || !m.trim())
				throw new Error(`${path}.metric entries must be non-empty strings`);
		}
	} else {
		throw new Error(
			`${path}.metric is required: a metric name or a list of names`,
		);
	}
	validateAttributes(q.attributes, `${path}.attributes`);
	validateAttributes(q.resourceAttributes, `${path}.resourceAttributes`);
	if (
		q.serviceName !== undefined &&
		(typeof q.serviceName !== "string" || !q.serviceName.trim())
	)
		throw new Error(`${path}.serviceName must be a non-empty string`);
	if (
		q.field !== undefined &&
		!METRIC_FIELDS.includes(q.field as AlertMetricField)
	)
		throw new Error(
			`${path}.field must be one of: ${METRIC_FIELDS.join(", ")}`,
		);
};

/** Throws an Error with a user-facing message when `query` is malformed. */
export function validateMetricQuery(query: unknown): void {
	if (!isPlainObject(query))
		throw new Error("query must be an object for the metrics signal");
	validateSelector(query, "query", QUERY_KEYS);
	const aggregation = query.aggregation;
	if (!METRIC_AGGREGATIONS.includes(aggregation as AlertMetricAggregation))
		throw new Error(
			`query.aggregation must be one of: ${METRIC_AGGREGATIONS.join(", ")}`,
		);
	if (query.denominator === undefined) {
		if (query.minDenominator !== undefined)
			throw new Error("query.minDenominator requires query.denominator");
		return;
	}
	if (aggregation === "age_seconds")
		throw new Error("query.denominator cannot be used with age_seconds");
	if (!isPlainObject(query.denominator))
		throw new Error("query.denominator must be an object");
	validateSelector(query.denominator, "query.denominator", DENOMINATOR_KEYS);
	const denAgg = query.denominator.aggregation;
	if (denAgg !== undefined) {
		if (
			denAgg === "age_seconds" ||
			!METRIC_AGGREGATIONS.includes(denAgg as AlertMetricAggregation)
		)
			throw new Error(
				`query.denominator.aggregation must be one of: ${METRIC_AGGREGATIONS.filter((a) => a !== "age_seconds").join(", ")}`,
			);
	}
	if (
		query.minDenominator !== undefined &&
		(typeof query.minDenominator !== "number" ||
			!Number.isFinite(query.minDenominator) ||
			query.minDenominator < 0)
	)
		throw new Error("query.minDenominator must be a finite number >= 0");
}

// ── Pure reduction ─────────────────────────────────────────────────────────

export interface MetricPointSample {
	tsNs: string;
	startTsNs: string | null;
	value: number | null;
	count: number | null;
	sum: number | null;
	receivedAt: string;
}

export interface SeriesReduceOptions {
	aggregation: Exclude<AlertMetricAggregation, "age_seconds">;
	field: AlertMetricField;
	/** `metric_series.temporality`: 1 delta, 2 cumulative, null for gauges. */
	temporality: number | null;
	/** Start of the window in Unix nanoseconds. */
	windowStartNs: bigint;
	windowSecs: number;
}

const toBigInt = (ns: string | null): bigint | null => {
	if (!ns) return null;
	try {
		return BigInt(ns);
	} catch {
		return null;
	}
};

const readField = (p: MetricPointSample, field: AlertMetricField) => {
	const raw = field === "count" ? p.count : field === "sum" ? p.sum : p.value;
	const n = typeof raw === "string" ? Number(raw) : raw;
	return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** Orders by producer time, then receive time (stable for equal ts_ns). */
export const sortPoints = (points: MetricPointSample[]): MetricPointSample[] =>
	[...points].sort((a, b) => {
		const ta = toBigInt(a.tsNs) ?? 0n;
		const tb = toBigInt(b.tsNs) ?? 0n;
		if (ta !== tb) return ta < tb ? -1 : 1;
		return a.receivedAt < b.receivedAt
			? -1
			: a.receivedAt > b.receivedAt
				? 1
				: 0;
	});

/**
 * Counter growth over consecutive cumulative points (Prometheus `increase`
 * without extrapolation). A drop, or a change of the point's start time,
 * is a counter reset: the new value counts in full, as growth from 0. The
 * first point counts in full only when its start time is inside the window
 * (the counter was born there); otherwise it is the baseline.
 */
const cumulativeIncrease = (
	points: Array<{ v: number; start: bigint | null }>,
	windowStartNs: bigint,
): number => {
	if (points.length === 0) return 0;
	const first = points[0];
	let total =
		first.start !== null && first.start >= windowStartNs ? first.v : 0;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const cur = points[i];
		const restarted =
			cur.start !== null && prev.start !== null && cur.start !== prev.start;
		if (restarted || cur.v < prev.v) total += cur.v;
		else total += cur.v - prev.v;
	}
	return total;
};

/**
 * Reduces one series' window points to a number, or null when the series
 * has no point carrying `field` in the window.
 */
export function reduceSeries(
	points: MetricPointSample[],
	opts: SeriesReduceOptions,
): number | null {
	const usable: Array<{ v: number; start: bigint | null }> = [];
	for (const p of sortPoints(points)) {
		const v = readField(p, opts.field);
		if (v !== null) usable.push({ v, start: toBigInt(p.startTsNs) });
	}
	if (usable.length === 0) return null;
	const values = usable.map((u) => u.v);
	switch (opts.aggregation) {
		case "last":
			return values[values.length - 1];
		case "min":
			return values.reduce((a, b) => (b < a ? b : a));
		case "max":
			return values.reduce((a, b) => (b > a ? b : a));
		case "sum":
			return values.reduce((a, b) => a + b, 0);
		case "avg":
			return values.reduce((a, b) => a + b, 0) / values.length;
		case "increase":
		case "rate": {
			const increase =
				opts.temporality === TEMPORALITY_DELTA
					? values.reduce((a, b) => a + b, 0)
					: cumulativeIncrease(usable, opts.windowStartNs);
			return opts.aggregation === "rate"
				? increase / opts.windowSecs
				: increase;
		}
	}
}

/** numerator / max(denominator, 1) when denominator >= minDenominator, else 0. */
export const metricRatio = (
	numerator: number,
	denominator: number,
	minDenominator: number,
): number =>
	denominator >= minDenominator ? numerator / Math.max(denominator, 1) : 0;

// ── Database evaluation ────────────────────────────────────────────────────

interface SeriesRow {
	id: string;
	temporality: number | string | null;
	attributes_json: unknown;
	resource_attrs_json: unknown;
}

interface PointRow {
	series_id: string;
	ts_ns: string;
	start_ts_ns: string | null;
	value: number | null;
	count: number | null;
	sum: number | null;
	received_at: string;
}

const parseAttrs = (raw: unknown): Record<string, unknown> => {
	if (raw === null || raw === undefined) return {};
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			return isPlainObject(parsed) ? parsed : {};
		} catch {
			return {};
		}
	}
	return isPlainObject(raw) ? raw : {};
};

const attrsMatch = (
	stored: Record<string, unknown>,
	wanted: Record<string, AlertMetricAttributeValue> | undefined,
): boolean => {
	if (!wanted) return true;
	for (const [key, expected] of Object.entries(wanted)) {
		const actual = stored[key];
		if (actual === undefined || actual === null) return false;
		if (typeof actual === "object") return false;
		if (String(actual) !== String(expected)) return false;
	}
	return true;
};

const metricNames = (selector: AlertMetricSelector): string[] => [
	...new Set(
		(Array.isArray(selector.metric) ? selector.metric : [selector.metric]).map(
			(m) => m.trim(),
		),
	),
];

const chunks = <T>(items: T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
};

async function matchingSeries(
	db: SqlDb,
	projectId: string,
	selector: AlertMetricSelector,
): Promise<Array<{ id: string; temporality: number | null }>> {
	const names = metricNames(selector);
	let sql = `SELECT id, temporality, attributes_json, resource_attrs_json
		FROM metric_series
		WHERE project_id = ? AND name IN (${names.map(() => "?").join(", ")})`;
	const binds: unknown[] = [projectId, ...names];
	if (selector.serviceName) {
		sql += ` AND service_name = ?`;
		binds.push(selector.serviceName);
	}
	const rs = await db
		.prepare(sql)
		.bind(...binds)
		.all<SeriesRow>();
	const matched = (rs.results ?? []).filter(
		(row) =>
			attrsMatch(parseAttrs(row.attributes_json), selector.attributes) &&
			attrsMatch(
				parseAttrs(row.resource_attrs_json),
				selector.resourceAttributes,
			),
	);
	if (matched.length > MAX_MATCHED_SERIES)
		throw new Error(
			`metrics query matches ${matched.length} series (limit ${MAX_MATCHED_SERIES}); narrow it with attributes or serviceName`,
		);
	return matched.map((row) => ({
		id: row.id,
		temporality:
			row.temporality === null || row.temporality === undefined
				? null
				: Number(row.temporality),
	}));
}

export interface MetricEvalContext {
	projectId: string;
	windowMins: number;
	/** The rule's `createdAt`; the reference for "never reported". */
	ruleCreatedAt: string;
	now: Date;
}

async function evaluateSelector(
	db: SqlDb,
	selector: AlertMetricSelector,
	aggregation: Exclude<AlertMetricAggregation, "age_seconds">,
	ctx: MetricEvalContext,
): Promise<number> {
	const series = await matchingSeries(db, ctx.projectId, selector);
	if (series.length === 0) return 0;
	const windowStartMs = ctx.now.getTime() - ctx.windowMins * 60_000;
	const cutoff = new Date(windowStartMs).toISOString();
	const bySeries = new Map<string, MetricPointSample[]>();
	for (const chunk of chunks(series, ID_CHUNK)) {
		const rs = await db
			.prepare(
				`SELECT series_id, ts_ns, start_ts_ns, value, count, sum, received_at
				FROM metric_point
				WHERE project_id = ? AND series_id IN (${chunk.map(() => "?").join(", ")})
				  AND received_at >= ?`,
			)
			.bind(ctx.projectId, ...chunk.map((s) => s.id), cutoff)
			.all<PointRow>();
		for (const row of rs.results ?? []) {
			const list = bySeries.get(row.series_id) ?? [];
			list.push({
				tsNs: String(row.ts_ns),
				startTsNs: row.start_ts_ns === null ? null : String(row.start_ts_ns),
				value: row.value,
				count: row.count,
				sum: row.sum,
				receivedAt: row.received_at,
			});
			bySeries.set(row.series_id, list);
		}
	}
	const field = selector.field ?? "value";
	const windowStartNs = BigInt(windowStartMs) * 1_000_000n;
	let total = 0;
	for (const s of series) {
		const reduced = reduceSeries(bySeries.get(s.id) ?? [], {
			aggregation,
			field,
			temporality: s.temporality,
			windowStartNs,
			windowSecs: ctx.windowMins * 60,
		});
		if (reduced !== null) total += reduced;
	}
	return total;
}

async function ageSeconds(
	db: SqlDb,
	selector: AlertMetricSelector,
	ctx: MetricEvalContext,
): Promise<number> {
	const series = await matchingSeries(db, ctx.projectId, selector);
	let newest: string | null = null;
	for (const chunk of chunks(series, ID_CHUNK)) {
		const row = await db
			.prepare(
				`SELECT MAX(received_at) AS newest FROM metric_point
				WHERE project_id = ? AND series_id IN (${chunk.map(() => "?").join(", ")})`,
			)
			.bind(ctx.projectId, ...chunk.map((s) => s.id))
			.first<{ newest: string | null }>();
		if (row?.newest && (newest === null || row.newest > newest))
			newest = row.newest;
	}
	const reference = Date.parse(newest ?? ctx.ruleCreatedAt);
	if (!Number.isFinite(reference)) return 0;
	return Math.max(0, (ctx.now.getTime() - reference) / 1000);
}

/** Evaluates a validated metrics query to a finite number. */
export async function evaluateMetricQuery(
	db: SqlDb,
	query: AlertQueryMetrics,
	ctx: MetricEvalContext,
): Promise<number> {
	if (query.aggregation === "age_seconds") return ageSeconds(db, query, ctx);
	const numerator = await evaluateSelector(db, query, query.aggregation, ctx);
	if (!query.denominator) return numerator;
	const denominator = await evaluateSelector(
		db,
		query.denominator,
		query.denominator.aggregation ?? query.aggregation,
		ctx,
	);
	return metricRatio(numerator, denominator, query.minDenominator ?? 0);
}
