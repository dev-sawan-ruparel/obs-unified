import type { TelemetrySpanDetail } from "@obs-unified/types";
import { describe, expect, it } from "vitest";
import { MemSqlDb } from "../test-utils/mem-sql-db";
import { ingestTelemetrySpans } from "./ingest";
import {
	buildTraceInstrumentationGaps,
	calibrateTelemetryInstrumentationGaps,
	extractCodeReference,
	getTelemetryTraceGaps,
} from "./trace-detail";

const span = (
	overrides: Partial<TelemetrySpanDetail>,
): TelemetrySpanDetail => ({
	traceId: "trace-1",
	spanId: "span-1",
	parentSpanId: null,
	serviceName: "api",
	scopeName: null,
	scopeVersion: null,
	spanName: "GET /checkout",
	spanKind: 2,
	statusCode: 1,
	statusMessage: null,
	startTime: "2026-06-01T00:00:00.000Z",
	endTime: "2026-06-01T00:00:00.500Z",
	durationMs: 500,
	attributes: {},
	resourceAttributes: {},
	events: [],
	links: [],
	...overrides,
});

describe("buildTraceInstrumentationGaps", () => {
	it("surfaces high self-time spans as structured blindspots", () => {
		const gaps = buildTraceInstrumentationGaps(
			"trace-1",
			[
				span({
					spanId: "root",
					spanName: "inventory.reserve",
					durationMs: 540,
				}),
				span({
					spanId: "child",
					parentSpanId: "root",
					spanName: "cache.get",
					durationMs: 40,
				}),
			],
			540,
			"2026-06-01T00:00:01.000Z",
		);

		expect(gaps).toMatchObject({
			traceId: "trace-1",
			totalDurationMs: 540,
			uninstrumentedTimeMs: 500,
			ratio: 500 / 540,
			timestamp: "2026-06-01T00:00:01.000Z",
		});
		expect(gaps.blindspots).toEqual([
			expect.objectContaining({
				parentSpanId: "root",
				parentServiceName: "api",
				parentSpanName: "inventory.reserve",
				durationMs: 500,
				childSpanCount: 1,
				asyncParent: false,
				thresholdVersion: "demo-calibrated-2026-06-03",
			}),
		]);
		expect(gaps.thresholds).toMatchObject({
			version: "demo-calibrated-2026-06-03",
			minDurationMs: 100,
			minSelfRatio: 0.7,
			maxChildSpanCount: 1,
			excludedSpanKinds: [3, 4, 5],
		});
	});

	it("does not flag async fan-out parents where child wall time exceeds parent", () => {
		const gaps = buildTraceInstrumentationGaps(
			"trace-1",
			[
				span({ spanId: "root", durationMs: 100 }),
				span({ spanId: "child-a", parentSpanId: "root", durationMs: 80 }),
				span({ spanId: "child-b", parentSpanId: "root", durationMs: 80 }),
			],
			100,
		);

		expect(gaps.uninstrumentedTimeMs).toBe(0);
		expect(gaps.blindspots).toEqual([]);
	});
});

describe("calibrateTelemetryInstrumentationGaps", () => {
	it("runs the calibrated rule over recent demo traces and reports firing rate", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (!sql.includes("FROM telemetry_spans")) return [];
				return [
					{
						project_id: "p1",
						trace_id: "trace-missing",
						span_id: "root",
						parent_span_id: null,
						service_name: "checkout-api",
						scope_name: null,
						scope_version: null,
						span_name: "POST /api/checkout",
						span_kind: 2,
						status_code: 1,
						status_message: null,
						duration_ms: 540,
						start_time: "2026-06-01T00:00:00.000Z",
						end_time: "2026-06-01T00:00:00.540Z",
						received_at: "2026-06-01T00:00:01.000Z",
						attributes_json: "{}",
						resource_attributes_json: "{}",
						events_json: "[]",
						links_json: "[]",
					},
					{
						project_id: "p1",
						trace_id: "trace-missing",
						span_id: "child",
						parent_span_id: "root",
						service_name: "checkout-api",
						scope_name: null,
						scope_version: null,
						span_name: "cache.get",
						span_kind: 3,
						status_code: 1,
						status_message: null,
						duration_ms: 40,
						start_time: "2026-06-01T00:00:00.010Z",
						end_time: "2026-06-01T00:00:00.050Z",
						received_at: "2026-06-01T00:00:01.000Z",
						attributes_json: "{}",
						resource_attributes_json: "{}",
						events_json: "[]",
						links_json: "[]",
					},
					{
						project_id: "p1",
						trace_id: "trace-dense",
						span_id: "root",
						parent_span_id: null,
						service_name: "checkout-api",
						scope_name: null,
						scope_version: null,
						span_name: "POST /api/checkout",
						span_kind: 2,
						status_code: 1,
						status_message: null,
						duration_ms: 540,
						start_time: "2026-06-01T00:01:00.000Z",
						end_time: "2026-06-01T00:01:00.540Z",
						received_at: "2026-06-01T00:01:01.000Z",
						attributes_json: "{}",
						resource_attributes_json: "{}",
						events_json: "[]",
						links_json: "[]",
					},
					{
						project_id: "p1",
						trace_id: "trace-dense",
						span_id: "child-a",
						parent_span_id: "root",
						service_name: "checkout-api",
						scope_name: null,
						scope_version: null,
						span_name: "payment.charge",
						span_kind: 3,
						status_code: 1,
						status_message: null,
						duration_ms: 220,
						start_time: "2026-06-01T00:01:00.010Z",
						end_time: "2026-06-01T00:01:00.230Z",
						received_at: "2026-06-01T00:01:01.000Z",
						attributes_json: "{}",
						resource_attributes_json: "{}",
						events_json: "[]",
						links_json: "[]",
					},
					{
						project_id: "p1",
						trace_id: "trace-dense",
						span_id: "child-b",
						parent_span_id: "root",
						service_name: "checkout-api",
						scope_name: null,
						scope_version: null,
						span_name: "db.query",
						span_kind: 3,
						status_code: 1,
						status_message: null,
						duration_ms: 180,
						start_time: "2026-06-01T00:01:00.240Z",
						end_time: "2026-06-01T00:01:00.420Z",
						received_at: "2026-06-01T00:01:01.000Z",
						attributes_json: "{}",
						resource_attributes_json: "{}",
						events_json: "[]",
						links_json: "[]",
					},
				];
			},
		});

		const calibration = await calibrateTelemetryInstrumentationGaps(db, {
			projectId: "p1",
			hours: 72,
		});

		expect(calibration).toMatchObject({
			thresholds: { version: "demo-calibrated-2026-06-03" },
			sampledSpanCount: 5,
			traceCount: 2,
			flaggedTraceCount: 1,
			blindspotCount: 1,
			flaggedTraceRate: 0.5,
			status: "noisy",
		});
		expect(calibration.topTraces[0]).toMatchObject({
			traceId: "trace-missing",
			blindspotCount: 1,
			topBlindspot: expect.objectContaining({
				parentSpanName: "POST /api/checkout",
				durationMs: 500,
			}),
		});
	});
});

describe("extractCodeReference", () => {
	it("extracts environment-neutral code metadata from span attributes", () => {
		expect(
			extractCodeReference({
				"code.filepath": "packages/api/src/checkout.ts",
				"code.function": "reserveInventory",
				"code.lineno": "42",
				"code.column": 7,
				"code.repository": "obs-unified",
			}),
		).toEqual({
			repoName: "obs-unified",
			originalPath: "packages/api/src/checkout.ts",
			relativePath: "packages/api/src/checkout.ts",
			symbolName: "reserveInventory",
			lineNumber: 42,
			columnNumber: 7,
		});
	});

	it("keeps absolute paths separate from repo-relative paths", () => {
		expect(
			extractCodeReference({
				"code.filepath": "/Users/example/project/src/index.ts",
				"code.lineno": 12,
			}),
		).toEqual({
			originalPath: "/Users/example/project/src/index.ts",
			absolutePath: "/Users/example/project/src/index.ts",
			lineNumber: 12,
		});
	});
});

describe("lazy (read-time) gaps", () => {
	it("does not materialize gaps on ingest, and computes them on read", async () => {
		const insertedSpans: unknown[][] = [];
		const deletedTraces: string[] = [];
		const insertedGaps: Array<{
			traceId: string;
			parentSpanId: string;
			parentServiceName: string;
			parentSpanName: string;
			offsetMs: number;
			durationMs: number;
			ratioOfParent: number;
			childSpanCount: number;
			asyncParent: boolean;
			recommendation: string;
		}> = [];

		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM telemetry_spans")) {
					return [
						{
							project_id: "p1",
							trace_id: "trace-ingest",
							span_id: "root",
							parent_span_id: null,
							service_name: "api",
							span_name: "inventory.reserve",
							duration_ms: 540,
							start_time: "2026-06-01T00:00:00.000Z",
							end_time: "2026-06-01T00:00:00.540Z",
							attributes_json: "{}",
							resource_attributes_json: "{}",
							events_json: "[]",
							links_json: "[]",
						},
						{
							project_id: "p1",
							trace_id: "trace-ingest",
							span_id: "child",
							parent_span_id: "root",
							service_name: "api",
							span_name: "cache.get",
							duration_ms: 40,
							start_time: "2026-06-01T00:00:00.000Z",
							end_time: "2026-06-01T00:00:00.040Z",
							attributes_json: "{}",
							resource_attributes_json: "{}",
							events_json: "[]",
							links_json: "[]",
						},
					];
				}
				if (sql.includes("FROM trace_instrumentation_gaps")) {
					return insertedGaps.map((g) => ({
						parent_span_id: g.parentSpanId,
						parent_service_name: g.parentServiceName,
						parent_span_name: g.parentSpanName,
						offset_ms: g.offsetMs,
						duration_ms: g.durationMs,
						ratio_of_parent: g.ratioOfParent,
						child_span_count: g.childSpanCount,
						async_parent: g.asyncParent ? 1 : 0,
						recommendation: g.recommendation,
					}));
				}
				return [];
			},
			run: (sql, binds: unknown[]) => {
				if (sql.includes("INSERT OR IGNORE INTO telemetry_spans")) {
					insertedSpans.push(binds);
				} else if (sql.includes("DELETE FROM trace_instrumentation_gaps")) {
					deletedTraces.push(String(binds[0]));
				} else if (sql.includes("INSERT INTO trace_instrumentation_gaps")) {
					insertedGaps.push({
						traceId: String(binds[0]),
						parentSpanId: String(binds[1]),
						parentServiceName: String(binds[2]),
						parentSpanName: String(binds[3]),
						offsetMs: Number(binds[4]),
						durationMs: Number(binds[5]),
						ratioOfParent: Number(binds[6]),
						childSpanCount: Number(binds[7]),
						asyncParent: binds[8] === 1,
						recommendation: String(binds[9]),
					});
				}
				return { changes: 1 };
			},
		});

		const spansToIngest = [
			{
				projectId: "p1",
				traceId: "trace-ingest",
				spanId: "root",
				parentSpanId: null,
				traceState: null,
				serviceName: "api",
				scopeName: null,
				scopeVersion: null,
				spanName: "inventory.reserve",
				spanKind: 2,
				statusCode: 1,
				statusMessage: null,
				startTime: "2026-06-01T00:00:00.000Z",
				endTime: "2026-06-01T00:00:00.540Z",
				durationMs: 540,
				attributesJson: "{}",
				droppedAttributesCount: 0,
				resourceAttributesJson: "{}",
				eventsJson: "[]",
				droppedEventsCount: 0,
				linksJson: "[]",
				droppedLinksCount: 0,
				receivedAt: "2026-06-01T00:00:01.000Z",
				expiresAt: "2026-06-02T00:00:00.000Z",
			},
		];

		await ingestTelemetrySpans(db, spansToIngest);

		// Assert spans were written
		expect(insertedSpans).toHaveLength(1);
		expect(insertedSpans[0][1]).toBe("trace-ingest");

		// Gaps are no longer materialized on the ingest hot path: ingest must
		// not touch the trace_instrumentation_gaps table at all.
		expect(deletedTraces).toHaveLength(0);
		expect(insertedGaps).toHaveLength(0);

		// They are computed on demand from the trace's spans at read time.
		const gaps = await getTelemetryTraceGaps(db, "trace-ingest", "p1");
		expect(gaps).toBeDefined();
		expect(gaps?.blindspots).toHaveLength(1);
		expect(gaps?.blindspots[0].durationMs).toBe(500);
	});
});
