import type { EvidenceBundle } from "@obs-unified/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { evidenceRetrievalRoutesPlugin } from "./evidence-retrieval-routes";

const BENCH_TRACE_ID = "trace-ccr-benchmark";
const BENCH_PROJECT_ID = "default";
const REPEATED_LOG_COUNT = 500;

const estimateTokens = (value: unknown): number =>
	Math.ceil(JSON.stringify(value).length / 4);

const jsonBytes = (value: unknown): number =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength;

const pctReduction = (before: number, after: number): number =>
	Number((((before - after) / before) * 100).toFixed(1));

const makeSpanRows = () => [
	{
		project_id: BENCH_PROJECT_ID,
		trace_id: BENCH_TRACE_ID,
		span_id: "root",
		parent_span_id: null,
		service_name: "checkout-api",
		scope_name: null,
		scope_version: null,
		span_name: "POST /checkout",
		span_kind: 2,
		status_code: 1,
		status_message: null,
		start_time: "2026-06-04T10:00:00.000Z",
		end_time: "2026-06-04T10:00:01.200Z",
		duration_ms: 1200,
		attributes_json: "{}",
		resource_attributes_json: "{}",
		events_json: "[]",
		links_json: "[]",
		received_at: "2026-06-04T10:00:01.200Z",
		expires_at: "2026-06-11T10:00:01.200Z",
	},
	{
		project_id: BENCH_PROJECT_ID,
		trace_id: BENCH_TRACE_ID,
		span_id: "payment",
		parent_span_id: "root",
		service_name: "checkout-api",
		scope_name: null,
		scope_version: null,
		span_name: "payment.authorize",
		span_kind: 3,
		status_code: 2,
		status_message: "Stripe timeout",
		start_time: "2026-06-04T10:00:00.120Z",
		end_time: "2026-06-04T10:00:01.000Z",
		duration_ms: 880,
		attributes_json: "{}",
		resource_attributes_json: "{}",
		events_json: "[]",
		links_json: "[]",
		received_at: "2026-06-04T10:00:01.200Z",
		expires_at: "2026-06-11T10:00:01.200Z",
	},
];

const makeLogRows = () =>
	Array.from({ length: REPEATED_LOG_COUNT }, (_, index) => ({
		project_id: BENCH_PROJECT_ID,
		log_id: `log-${index + 1}`,
		trace_id: BENCH_TRACE_ID,
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: `GET /api/products/${1000 + index} 404`,
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-04T10:00:00.500Z",
		received_at: "2026-06-04T10:00:00.500Z",
		expires_at: "2026-06-11T10:00:00.500Z",
	}));

const setupBenchmarkApp = () => {
	const spanRows = makeSpanRows();
	const logRows = makeLogRows();
	const db = new MemSqlDb({
		all: (sql, binds) => {
			if (sql.includes("FROM telemetry_spans")) return spanRows;
			if (sql.includes("FROM logs")) {
				const limit = binds.at(-1);
				return typeof limit === "number" ? logRows.slice(0, limit) : logRows;
			}
			if (sql.includes("FROM profile_trace_index")) return [];
			if (
				sql.includes("FROM retrieval_events") ||
				sql.includes("FROM artifacts") ||
				sql.includes("FROM metric_exemplars") ||
				sql.includes("FROM replay")
			) {
				return [];
			}
			return [];
		},
		first: (sql) => {
			if (sql.includes("FROM logs")) {
				return {
					totalLogs: logRows.length,
					errorLogs: logRows.length,
					warnLogs: 0,
				};
			}
			return null;
		},
	});
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime(undefined, undefined, () => db);
	evidenceRetrievalRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = { DB: db as unknown as D1Database };
	return { app, env, logRows, spanRows };
};

describe("evidence retrieval CCR benchmark", () => {
	it("compacts repeated logs while preserving the failed-span debugging anchor", async () => {
		const { app, env, logRows, spanRows } = setupBenchmarkApp();
		const bundleRes = await app.request(
			"/internal/evidence/bundle",
			{
				method: "POST",
				body: JSON.stringify({
					anchor: { entityKind: "trace", entityId: BENCH_TRACE_ID },
					intent: "debug_failure",
					budget: { targetTokens: 4000, detailLevel: "standard" },
				}),
				headers: { "content-type": "application/json" },
			},
			env,
		);
		expect(bundleRes.status).toBe(200);
		const bundle = (await bundleRes.json()) as EvidenceBundle;

		const traceRef = bundle.retrievalRefs.find(
			(ref) => ref.source === "evidence.bundle.trace_detail",
		);
		const logsRef = bundle.retrievalRefs.find(
			(ref) => ref.source === "evidence.bundle.correlated_logs",
		);
		expect(traceRef).toBeDefined();
		expect(logsRef).toBeDefined();

		const traceRes = await app.request(
			`/internal/evidence/refs/${traceRef?.refId}`,
			{ method: "GET" },
			env,
		);
		const logsRes = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}`,
			{ method: "GET" },
			env,
		);
		expect(traceRes.status).toBe(200);
		expect(logsRes.status).toBe(200);
		const rawTrace = (await traceRes.json()) as { data: unknown };
		const rawLogs = (await logsRes.json()) as {
			data: { logs: unknown[]; summary: unknown };
		};
		const rawContext = {
			trace: rawTrace.data,
			logs: rawLogs.data.logs,
			logSummary: rawLogs.data.summary,
		};

		const logCompaction = bundle.compactions.find(
			(compaction) =>
				compaction.kind === "logs" &&
				compaction.strategy === "signature_cluster",
		);
		expect(logCompaction).toEqual(
			expect.objectContaining({
				inputCount: REPEATED_LOG_COUNT,
				outputCount: 3,
			}),
		);
		expect(bundle.findings.map((finding) => finding.title)).toContain(
			"Failed span present",
		);
		expect(
			bundle.evidenceReferences.some(
				(ref) =>
					ref.entityKind === "span" &&
					ref.entityId === `${BENCH_TRACE_ID}:payment`,
			),
		).toBe(true);
		expect(logsRef?.compactedFrom?.recordCount).toBe(REPEATED_LOG_COUNT);
		expect(logsRef?.returned?.recordCount).toBe(3);

		const rawTokens = estimateTokens(rawContext);
		const ccrTokens = estimateTokens(bundle);
		const rawSizeBytes = jsonBytes(rawContext);
		const ccrSizeBytes = jsonBytes(bundle);
		const benchmarkResult = {
			scenario: "trace-repeated-404-burst",
			runDate: "2026-06-04",
			input: {
				traceSpans: spanRows.length,
				rawLogRecords: logRows.length,
				repeatedLogSignature: "GET /api/products/<num> 404",
			},
			rawEvidence: {
				jsonBytes: rawSizeBytes,
				tokenEstimate: rawTokens,
				logRecords: rawLogs.data.logs.length,
			},
			ccrEvidenceBundle: {
				jsonBytes: ccrSizeBytes,
				tokenEstimate: ccrTokens,
				logCompactionInput: logCompaction?.inputCount,
				logCompactionOutput: logCompaction?.outputCount,
				retrievalRefs: bundle.retrievalRefs.length,
				evidenceReferences: bundle.evidenceReferences.length,
				estimatedTokensInBundleBudget: bundle.budget?.estimatedTokens,
			},
			reduction: {
				jsonBytesPct: pctReduction(rawSizeBytes, ccrSizeBytes),
				tokenEstimatePct: pctReduction(rawTokens, ccrTokens),
				rawToCcrTokenRatio: Number((rawTokens / ccrTokens).toFixed(1)),
			},
			preservedSignals: {
				failedSpanFinding: true,
				failedPaymentSpanReference: true,
			},
		};
		console.info(
			`CCR_BENCHMARK_RESULT ${JSON.stringify(benchmarkResult, null, 2)}`,
		);

		expect(rawLogs.data.logs).toHaveLength(REPEATED_LOG_COUNT);
		expect(rawTokens / ccrTokens).toBeGreaterThan(5);
		expect(rawSizeBytes).toBeGreaterThan(ccrSizeBytes);
	});
});
