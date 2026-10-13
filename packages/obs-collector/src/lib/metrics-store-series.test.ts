/**
 * Two ingest batches that both see a brand-new metric identity used to race
 * on `UNIQUE(project_id, identity)`: the loser's whole batch failed and its
 * points were lost. The insert is now conflict-tolerant and the loser adopts
 * the winner's series id. Executed against the real migrated schema.
 */

import { describe, expect, it } from "vitest";
import type { DecodedMetricPoint } from "../otlp/decode";
import { MetricsStore } from "./metrics-store";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const point = (over: Partial<DecodedMetricPoint> = {}): DecodedMetricPoint => ({
	name: "http.server.duration",
	description: null,
	unit: "ms",
	type: "gauge",
	isMonotonic: null,
	temporality: null,
	scopeName: "test",
	scopeVersion: "1",
	serviceName: "checkout",
	resourceAttrsJson: "{}",
	attributesJson: "{}",
	identity: "identity-shared",
	tsNs: "1800000000000000000",
	startTsNs: null,
	value: 1,
	count: null,
	sum: null,
	min: null,
	max: null,
	boundsJson: null,
	bucketCountsJson: null,
	extraJson: null,
	exemplarsJson: null,
	...over,
});

describe("MetricsStore series resolution under concurrency", () => {
	it("lets concurrent first-sight ingests share one series row", async () => {
		const db = createMigratedSqliteDb();
		const store = new MetricsStore(db);
		const now = new Date().toISOString();
		const later = new Date(Date.now() + 3_600_000).toISOString();

		// Both calls run their lookup (miss) before either inserts.
		await Promise.all([
			store.ingestBatch({
				projectId: "alpha",
				points: [point({ value: 1 })],
				receivedAt: now,
				expiresAt: later,
			}),
			store.ingestBatch({
				projectId: "alpha",
				points: [point({ value: 2 })],
				receivedAt: now,
				expiresAt: later,
			}),
		]);

		const series = await db
			.prepare(`SELECT id FROM metric_series WHERE project_id = ?`)
			.bind("alpha")
			.all<{ id: string }>();
		expect(series.results).toHaveLength(1);
		const points = await db
			.prepare(
				`SELECT series_id, value FROM metric_point WHERE project_id = ? ORDER BY value`,
			)
			.bind("alpha")
			.all<{ series_id: string; value: number }>();
		expect(points.results.map((p) => p.value)).toEqual([1, 2]);
		expect(new Set(points.results.map((p) => p.series_id))).toEqual(
			new Set([series.results[0]?.id]),
		);
		db.close();
	});

	it("keeps series separate per project", async () => {
		const db = createMigratedSqliteDb();
		const store = new MetricsStore(db);
		const now = new Date().toISOString();
		for (const projectId of ["alpha", "beta"]) {
			await store.ingestBatch({
				projectId,
				points: [point()],
				receivedAt: now,
				expiresAt: now,
			});
		}
		const rows = await db
			.prepare(`SELECT project_id FROM metric_series ORDER BY project_id`)
			.all<{ project_id: string }>();
		expect(rows.results.map((r) => r.project_id)).toEqual(["alpha", "beta"]);
		db.close();
	});
});
