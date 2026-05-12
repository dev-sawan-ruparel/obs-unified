/**
 * Metrics storage.
 *
 * Each ingest collapses points to their series identity, upserts the series
 * row, then batch-inserts points. Series upsert is per-unique-identity per
 * request — at small batch sizes this is cheap; a followup can switch to a
 * single SELECT-many + batched INSERT-missing when volume demands it.
 */

import type { DecodedMetricPoint } from "../otlp/decode";
import type { SqlDb, SqlStatement } from "./sql-db";

interface SeriesRow {
	id: string;
	identity: string;
}

export class MetricsStore {
	constructor(private readonly db: SqlDb) {}

	async purgeExpired(): Promise<number> {
		const result = await this.db
			.prepare(`DELETE FROM metric_point WHERE expires_at < datetime('now')`)
			.run();
		return result.meta.changes ?? 0;
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

		const stmt = this.db.prepare(`
			INSERT INTO metric_point (
				id, series_id, project_id, ts_ns, start_ts_ns,
				value, count, sum, min, max, bounds_json, bucket_counts_json,
				extra_json, exemplars_json, received_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const batch = points.map((p) => {
			const series = seriesByIdentity.get(p.identity);
			if (!series) throw new Error(`series not resolved: ${p.identity}`);
			return stmt.bind(
				crypto.randomUUID(),
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
			);
		});

		await this.db.batch(batch);
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
