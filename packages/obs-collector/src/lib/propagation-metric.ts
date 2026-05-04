/**
 * RFC 0004 Phase 1.8 — interaction_id propagation metric.
 *
 * Hourly aggregator: counts how many records in each signal table for
 * each project carry an interaction_id versus null over the last hour.
 * Writes 8 metric points per project per hour to metric_point as the
 * standard OTel counter `obs.interaction.propagation` with attributes
 * `(signal, propagated)`. The Health dashboard's tile (Phase 1.10
 * follow-up or RFC 0006 Connected rail consumer) reads these series and
 * surfaces the ratio per signal.
 *
 * Why aggregate via cron rather than emit per-request:
 * - The signal tables already have the data; a hourly count is two
 *   indexed COUNT(*) queries per signal — sub-ms.
 * - Per-request emission adds a ~2x write amplification across every
 *   ingest path. The metric is operational, not analytical, and an
 *   hourly cadence is enough to surface drift.
 *
 * Series identity is stable so the cron upserts the same series rows
 * each run rather than creating new ones.
 */

import type { DecodedMetricPoint } from "../otlp/decode";
import type { Logger } from "../framework/logger";
import { MetricsStore } from "./metrics-store";

const PROPAGATION_METRIC_NAME = "obs.interaction.propagation";

type Signal = "span" | "log" | "usage" | "ai_call";

interface SignalQuery {
	signal: Signal;
	table: string;
}

const SIGNALS: SignalQuery[] = [
	{ signal: "span", table: "telemetry_spans" },
	{ signal: "log", table: "logs" },
	{ signal: "usage", table: "usage_events" },
	{ signal: "ai_call", table: "ai_calls" },
];

/**
 * Stable identity string for the (name, attributes) tuple. Mirrors the
 * format MetricsStore writes for OTLP-ingested points so a query joining
 * on metric_series.identity gets a consistent result regardless of
 * source.
 */
const propagationIdentity = (signal: Signal, propagated: boolean): string =>
	`${PROPAGATION_METRIC_NAME}|signal=${signal}|propagated=${propagated}`;

const buildPoint = (
	signal: Signal,
	propagated: boolean,
	count: number,
	tsNs: string,
): DecodedMetricPoint => ({
	name: PROPAGATION_METRIC_NAME,
	description:
		"Count of signal records ingested in the last hour, partitioned by whether they carry interaction_id (RFC 0004).",
	unit: "{records}",
	type: "sum",
	isMonotonic: false, // delta over a one-hour window, not cumulative
	temporality: 1, // DELTA
	scopeName: "obs.collector",
	scopeVersion: "1",
	serviceName: "obs-collector",
	resourceAttrsJson: null,
	attributesJson: JSON.stringify({ signal, propagated }),
	identity: propagationIdentity(signal, propagated),
	tsNs,
	startTsNs: null,
	value: count,
	count: null,
	sum: null,
	min: null,
	max: null,
	boundsJson: null,
	bucketCountsJson: null,
	extraJson: null,
	exemplarsJson: null,
});

const countsForSignal = async (
	db: D1Database,
	projectId: string,
	table: string,
	hourCutoffIso: string,
): Promise<{ propagated: number; missing: number }> => {
	const row = await db
		.prepare(
			`SELECT
			  SUM(CASE WHEN interaction_id IS NOT NULL THEN 1 ELSE 0 END) AS propagated,
			  SUM(CASE WHEN interaction_id IS NULL THEN 1 ELSE 0 END) AS missing
			FROM ${table}
			WHERE project_id = ? AND received_at >= ?`,
		)
		.bind(projectId, hourCutoffIso)
		.first<{ propagated: number | null; missing: number | null }>();
	return {
		propagated: row?.propagated ?? 0,
		missing: row?.missing ?? 0,
	};
};

/**
 * Aggregate propagation counts for a single project and write them as
 * metric points. Idempotent per hour-bucket (each run produces a new
 * point; series identity stays stable).
 */
export const aggregatePropagationForProject = async (
	db: D1Database,
	projectId: string,
	now: Date,
	logger?: Logger,
): Promise<{ pointsWritten: number }> => {
	const hourCutoff = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
	const tsNs = (BigInt(now.getTime()) * 1_000_000n).toString();
	const points: DecodedMetricPoint[] = [];

	for (const { signal, table } of SIGNALS) {
		try {
			const { propagated, missing } = await countsForSignal(
				db,
				projectId,
				table,
				hourCutoff,
			);
			points.push(buildPoint(signal, true, propagated, tsNs));
			points.push(buildPoint(signal, false, missing, tsNs));
		} catch (err) {
			logger?.error("[propagation-metric] count failed", {
				signal,
				table,
				projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	if (points.length === 0) return { pointsWritten: 0 };

	const store = new MetricsStore(db);
	await store.ingestBatch({
		projectId,
		points,
		receivedAt: now.toISOString(),
		// Keep propagation metrics on the same retention as everything else.
		expiresAt: new Date(
			now.getTime() + 72 * 60 * 60 * 1000,
		).toISOString(),
	});

	return { pointsWritten: points.length };
};

/**
 * Run the aggregation across all known projects. Designed for a once-per-hour
 * cron handler; cheap enough to run alongside retention cleanup.
 */
export const aggregatePropagation = async (
	db: D1Database,
	now: Date,
	logger?: Logger,
): Promise<{ projects: number; pointsWritten: number }> => {
	const projects = await db
		.prepare("SELECT id FROM projects")
		.all<{ id: string }>();

	let pointsWritten = 0;
	for (const p of projects.results) {
		const r = await aggregatePropagationForProject(db, p.id, now, logger);
		pointsWritten += r.pointsWritten;
	}
	return { projects: projects.results.length, pointsWritten };
};
