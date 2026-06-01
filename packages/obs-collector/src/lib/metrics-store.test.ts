import { describe, expect, it } from "vitest";
import type { DecodedMetricPoint } from "../otlp/decode";
import { MetricsStore } from "./metrics-store";
import { MemSqlDb } from "./test-utils/mem-sql-db";

const point = (
	overrides: Partial<DecodedMetricPoint> = {},
): DecodedMetricPoint => ({
	name: "http.server.duration",
	description: null,
	unit: "ms",
	type: "histogram",
	isMonotonic: null,
	temporality: 2,
	scopeName: "@opentelemetry/instrumentation-http",
	scopeVersion: "1.0.0",
	serviceName: "checkout",
	resourceAttrsJson: JSON.stringify({ "service.name": "checkout" }),
	attributesJson: JSON.stringify({ route: "/checkout" }),
	identity: "metric-identity",
	tsNs: "1800000000000000000",
	startTsNs: null,
	value: null,
	count: 1,
	sum: 42,
	min: null,
	max: null,
	boundsJson: JSON.stringify([50]),
	bucketCountsJson: JSON.stringify([1]),
	extraJson: null,
	exemplarsJson: null,
	...overrides,
});

describe("MetricsStore", () => {
	it("indexes metric exemplars by trace/span during ingest", async () => {
		const db = new MemSqlDb({
			all: (sql, binds) => {
				if (sql.includes("FROM metric_series")) {
					return [{ id: "series-1", identity: binds[1] }];
				}
				return [];
			},
		});
		const store = new MetricsStore(db);

		await store.ingestBatch({
			projectId: "p1",
			receivedAt: "2026-06-01T00:00:00.000Z",
			expiresAt: "2026-06-02T00:00:00.000Z",
			points: [
				point({
					exemplarsJson: JSON.stringify([
						{
							value: 42,
							traceId: "01010101010101010101010101010101",
							spanId: "0202020202020202",
							tsNs: "1800000000000000001",
						},
						{
							value: 41,
							traceId: null,
							spanId: null,
							tsNs: "1800000000000000002",
						},
						{
							value: 40,
							traceId: "03030303030303030303030303030303",
							spanId: null,
							tsNs: "1800000000000000003",
						},
					]),
				}),
			],
		});

		expect(db.callsMatching("INSERT INTO metric_point")).toHaveLength(1);
		const exemplarInserts = db.callsMatching("INSERT INTO metric_exemplars");
		expect(exemplarInserts).toHaveLength(2);
		expect(exemplarInserts[0].binds.slice(3)).toEqual([
			"p1",
			"http.server.duration",
			"checkout",
			"01010101010101010101010101010101",
			"0202020202020202",
			"1800000000000000001",
			42,
			"2026-06-01T00:00:00.000Z",
			"2026-06-02T00:00:00.000Z",
		]);
		expect(exemplarInserts[1].binds[6]).toBe(
			"03030303030303030303030303030303",
		);
		expect(exemplarInserts[1].binds[7]).toBeNull();
	});

	it("queries exemplars for a trace", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM metric_exemplars")) {
					return [
						{
							id: "ex-1",
							point_id: "point-1",
							series_id: "series-1",
							metric_name: "http.server.duration",
							service_name: "checkout",
							trace_id: "trace-1",
							span_id: "span-1",
							ts_ns: "1800000000000000001",
							value: 42,
							received_at: "2026-06-01T00:00:00.000Z",
						},
					];
				}
				return [];
			},
		});
		const store = new MetricsStore(db);

		const rows = await store.exemplarsForTrace("p1", "trace-1", 5);

		expect(rows).toEqual([
			{
				id: "ex-1",
				pointId: "point-1",
				seriesId: "series-1",
				metricName: "http.server.duration",
				serviceName: "checkout",
				traceId: "trace-1",
				spanId: "span-1",
				tsNs: "1800000000000000001",
				value: 42,
				receivedAt: "2026-06-01T00:00:00.000Z",
			},
		]);
		expect(db.calls[0].binds).toEqual(["p1", "trace-1", 5]);
	});
});
