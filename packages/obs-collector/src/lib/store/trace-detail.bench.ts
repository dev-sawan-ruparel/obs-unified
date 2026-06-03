import type { TelemetrySpanDetail } from "@obs-unified/types";
import { bench, describe } from "vitest";
import { buildTraceInstrumentationGaps } from "./trace-detail";

/**
 * Q1 benchmark — read-time gap computation cost vs trace size.
 *
 * Since PR #21, trace instrumentation gaps are computed lazily at read time
 * from a trace's spans (`buildTraceInstrumentationGaps`) instead of being
 * materialized on ingest. This benchmark measures that pure-compute cost as a
 * function of spans-per-trace, to answer: is read-time computation fast enough
 * to serve on a trace-detail view without a cache, even for very large traces?
 *
 * This measures the trace-detail-page hot path, where spans are already loaded
 * in memory and passed straight into the gap computation. The standalone
 * `/internal/.../gaps` endpoint additionally pays a project-scoped span SELECT
 * + JSON parse; that DB-inclusive end-to-end cost is captured separately by the
 * read-path child-span instrumentation (the other half of "Q1 = Both"), not
 * here.
 *
 * Run: `pnpm --filter @obs-unified/collector bench` (excluded from `pnpm test`).
 */

const SIZES = [10, 100, 500, 1_000, 5_000, 10_000];

// Deterministic synthetic trace generator (no Math.random — reproducible runs).
// Builds a tree with branching factor 2 and durations that taper with depth so
// the gap heuristic does real work (self-time/ratio math + a child reduce for
// every span). Returns fully-formed TelemetrySpanDetail objects so we exercise
// the exact code path the read handler uses.
function makeTrace(spanCount: number): {
	spans: TelemetrySpanDetail[];
	rootDurationMs: number;
} {
	const BRANCH = 2;
	const baseStart = Date.parse("2026-06-01T00:00:00.000Z");
	const spans: TelemetrySpanDetail[] = [];

	for (let i = 0; i < spanCount; i++) {
		const parentIndex = i === 0 ? null : Math.floor((i - 1) / BRANCH);
		const depth = i === 0 ? 0 : Math.floor(Math.log2(i + 1));
		// Duration tapers with depth; kept > 0 so ratio math runs.
		const durationMs = Math.max(1, 2_000 - depth * 150);
		const startMs = baseStart + i; // monotonic, distinct
		spans.push({
			traceId: "bench-trace",
			spanId: `s${i}`,
			parentSpanId: parentIndex === null ? null : `s${parentIndex}`,
			serviceName: `svc-${i % 8}`,
			scopeName: null,
			scopeVersion: null,
			spanName: `op.${i % 32}`,
			spanKind: 2,
			statusCode: 1,
			statusMessage: null,
			startTime: new Date(startMs).toISOString(),
			endTime: new Date(startMs + durationMs).toISOString(),
			durationMs,
			attributes: { "http.method": "GET", "http.route": `/r/${i % 16}` },
			resourceAttributes: { "service.name": `svc-${i % 8}` },
			events: [],
			links: [],
		});
	}

	return { spans, rootDurationMs: spans[0]?.durationMs ?? 0 };
}

describe("buildTraceInstrumentationGaps (read-time gap compute)", () => {
	for (const size of SIZES) {
		const { spans, rootDurationMs } = makeTrace(size);
		bench(`${size} spans`, () => {
			buildTraceInstrumentationGaps("bench-trace", spans, rootDurationMs);
		});
	}
});
