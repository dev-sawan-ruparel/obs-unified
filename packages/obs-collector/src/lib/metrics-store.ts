/**
 * Metrics storage.
 *
 * Each ingest collapses points to their series identity, upserts the series
 * row, then batch-inserts points. Series upsert is per-unique-identity per
 * request — at small batch sizes this is cheap; a followup can switch to a
 * single SELECT-many + batched INSERT-missing when volume demands it.
 */

import type { DecodedMetricPoint } from "../otlp/decode";
import { dialectFor, type SqlDb, type SqlStatement } from "./sql-db";

interface SeriesRow {
	id: string;
	identity: string;
}

interface StoredExemplar {
	value: number;
	traceId: string | null;
	spanId: string | null;
	tsNs: string;
}

export interface MetricExemplarPoint {
	id: string;
	pointId: string;
	seriesId: string;
	metricName: string;
	serviceName: string | null;
	traceId: string | null;
	spanId: string | null;
	tsNs: string;
	value: number;
	receivedAt: string;
}

const parseExemplars = (raw: string | null): StoredExemplar[] => {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(exemplar): exemplar is StoredExemplar =>
				typeof exemplar === "object" &&
				exemplar !== null &&
				typeof exemplar.value === "number" &&
				Number.isFinite(exemplar.value) &&
				typeof exemplar.tsNs === "string" &&
				(exemplar.traceId === null || typeof exemplar.traceId === "string") &&
				(exemplar.spanId === null || typeof exemplar.spanId === "string"),
		);
	} catch {
		return [];
	}
};

export class MetricsStore {
	constructor(private readonly db: SqlDb) {}

	async purgeExpired(): Promise<number> {
		const dialect = dialectFor(this.db);
		const [exemplarResult, pointResult] = await this.db.batch([
			this.db.prepare(
				`DELETE FROM metric_exemplars WHERE expires_at < ${dialect.now()}`,
			),
			this.db.prepare(
				`DELETE FROM metric_point WHERE expires_at < ${dialect.now()}`,
			),
		]);
		return (
			(exemplarResult?.meta.changes ?? 0) + (pointResult?.meta.changes ?? 0)
		);
	}

	async ingestBatch(opts: {
		projectId: string;
		points: DecodedMetricPoint[];
		receivedAt: string;
		expiresAt: string;
	}): Promise<void> {
		const { projectId, points, receivedAt, expiresAt } = opts;
		if (points.length === 0) return;

		const seriesByIdentity = await this.resolveSeries(projectId, points);

		const pointStmt = this.db.prepare(`
			INSERT INTO metric_point (
				id, series_id, project_id, ts_ns, start_ts_ns,
				value, count, sum, min, max, bounds_json, bucket_counts_json,
				extra_json, exemplars_json, received_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const exemplarStmt = this.db.prepare(`
			INSERT INTO metric_exemplars (
				id, point_id, series_id, project_id, metric_name, service_name,
				trace_id, span_id, ts_ns, value, received_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const batch: SqlStatement[] = [];
		for (const p of points) {
			const series = seriesByIdentity.get(p.identity);
			if (!series) throw new Error(`series not resolved: ${p.identity}`);
			const pointId = crypto.randomUUID();
			batch.push(
				pointStmt.bind(
					pointId,
					series.id,
					projectId,
					p.tsNs,
					p.startTsNs,
					p.value,
					p.count,
					p.sum,
					p.min,
					p.max,
					p.boundsJson,
					p.bucketCountsJson,
					p.extraJson,
					p.exemplarsJson,
					receivedAt,
					expiresAt,
				),
			);
			for (const exemplar of parseExemplars(p.exemplarsJson)) {
				if (!exemplar.traceId && !exemplar.spanId) continue;
				batch.push(
					exemplarStmt.bind(
						crypto.randomUUID(),
						pointId,
						series.id,
						projectId,
						p.name,
						p.serviceName,
						exemplar.traceId,
						exemplar.spanId,
						exemplar.tsNs,
						exemplar.value,
						receivedAt,
						expiresAt,
					),
				);
			}
		}

		await this.db.batch(batch);
	}

	async exemplarsForTrace(
		projectId: string,
		traceId: string,
		limit = 50,
	): Promise<MetricExemplarPoint[]> {
		const rows = await this.db
			.prepare(
				`SELECT id, point_id, series_id, metric_name, service_name,
						trace_id, span_id, ts_ns, value, received_at
					FROM metric_exemplars
					WHERE project_id = ? AND trace_id = ?
					ORDER BY ts_ns DESC LIMIT ?`,
			)
			.bind(projectId, traceId, limit)
			.all<{
				id: string;
				point_id: string;
				series_id: string;
				metric_name: string;
				service_name: string | null;
				trace_id: string | null;
				span_id: string | null;
				ts_ns: string;
				value: number;
				received_at: string;
			}>();
		return rows.results.map((row) => ({
			id: row.id,
			pointId: row.point_id,
			seriesId: row.series_id,
			metricName: row.metric_name,
			serviceName: row.service_name,
			traceId: row.trace_id,
			spanId: row.span_id,
			tsNs: row.ts_ns,
			value: row.value,
			receivedAt: row.received_at,
		}));
	}

	async recentExemplars(opts: {
		projectId: string;
		serviceName?: string | null;
		metricPrefix?: string | null;
		limit?: number;
	}): Promise<MetricExemplarPoint[]> {
		const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
		const where = ["project_id = ?"];
		const binds: unknown[] = [opts.projectId];
		if (opts.serviceName) {
			where.push("service_name = ?");
			binds.push(opts.serviceName);
		}
		if (opts.metricPrefix) {
			where.push("metric_name LIKE ?");
			binds.push(`${opts.metricPrefix}%`);
		}
		const rows = await this.db
			.prepare(
				`SELECT id, point_id, series_id, metric_name, service_name,
						trace_id, span_id, ts_ns, value, received_at
					FROM metric_exemplars
					WHERE ${where.join(" AND ")}
					ORDER BY received_at DESC, ts_ns DESC
					LIMIT ?`,
			)
			.bind(...binds, limit)
			.all<{
				id: string;
				point_id: string;
				series_id: string;
				metric_name: string;
				service_name: string | null;
				trace_id: string | null;
				span_id: string | null;
				ts_ns: string;
				value: number;
				received_at: string;
			}>();
		return rows.results.map((row) => ({
			id: row.id,
			pointId: row.point_id,
			seriesId: row.series_id,
			metricName: row.metric_name,
			serviceName: row.service_name,
			traceId: row.trace_id,
			spanId: row.span_id,
			tsNs: row.ts_ns,
			value: row.value,
			receivedAt: row.received_at,
		}));
	}

	/**
	 * Ensures a `metric_series` row exists for every unique identity in the
	 * batch. Returns a map of identity → series row for point linking.
	 */
	private async resolveSeries(
		projectId: string,
		points: DecodedMetricPoint[],
	): Promise<Map<string, SeriesRow>> {
		const byIdentity = new Map<string, DecodedMetricPoint>();
		for (const p of points) {
			if (!byIdentity.has(p.identity)) byIdentity.set(p.identity, p);
		}
		const identities = Array.from(byIdentity.keys());

		// Lookup existing series in one query (chunked to stay under D1's
		// ~100-param limit per statement).
		const existing = new Map<string, SeriesRow>();
		for (let i = 0; i < identities.length; i += 50) {
			const chunk = identities.slice(i, i + 50);
			const placeholders = chunk.map(() => "?").join(",");
			const rows = await this.db
				.prepare(
					`SELECT id, identity FROM metric_series
					 WHERE project_id = ? AND identity IN (${placeholders})`,
				)
				.bind(projectId, ...chunk)
				.all<SeriesRow>();
			for (const row of rows.results) {
				existing.set(row.identity, row);
			}
		}

		// Insert missing series.
		const insertStmt = this.db.prepare(`
			INSERT INTO metric_series (
				id, project_id, name, description, unit, type,
				is_monotonic, temporality, scope_name, scope_version, service_name,
				resource_attrs_json, attributes_json, identity, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		const toInsert: SqlStatement[] = [];
		const createdAt = new Date().toISOString();
		for (const [identity, p] of byIdentity.entries()) {
			if (existing.has(identity)) continue;
			const id = crypto.randomUUID();
			existing.set(identity, { id, identity });
			toInsert.push(
				insertStmt.bind(
					id,
					projectId,
					p.name,
					p.description,
					p.unit,
					p.type,
					p.isMonotonic === null ? null : p.isMonotonic ? 1 : 0,
					p.temporality,
					p.scopeName,
					p.scopeVersion,
					p.serviceName,
					p.resourceAttrsJson,
					p.attributesJson,
					identity,
					createdAt,
				),
			);
		}
		if (toInsert.length) await this.db.batch(toInsert);
		return existing;
	}
}
