// Drive ingest + read traffic against a local collector and measure:
//   Q1 — live latency of /v1/traces ingest, trace-detail read, and the
//        read-time gaps read (DB span SELECT + buildTraceInstrumentationGaps).
//   Q3 — the read/write counting (traces viewed vs traces ingested). NOTE: the
//        ratio here is whatever you configure (READS/INGEST) — it validates the
//        counting mechanics, not the production rate. The real "<1% viewed"
//        figure must come from a self-instrumented deployment's telemetry
//        (count(query.trace_detail) / sum(traces.ingest → traces.trace_count)).
//
// Requires a running collector (see run.sh, which boots one in open mode).
// Node 18+ (global fetch / performance). Tunables via env:
//   BASE   collector base URL          (default http://localhost:18792)
//   INGEST traces to ingest            (default 1000)
//   READS  traces to read back         (default 100)
//   SPANS  spans per trace             (default 20)

const BASE = process.env.BASE ?? "http://localhost:18792";
const INGEST = Number(process.env.INGEST ?? 1000);
const READS = Number(process.env.READS ?? 100);
const SPANS_PER_TRACE = Number(process.env.SPANS ?? 20);

const hex = (n, len) => n.toString(16).padStart(len, "0");
const kv = (k, v) => ({ key: k, value: { stringValue: String(v) } });
const BASE_NANO = 1_700_000_000_000_000_000n;

// Deterministic synthetic trace: a binary tree of `SPANS_PER_TRACE` spans with
// durations that taper by depth, so the gap heuristic does real work.
function makeTrace(traceIdx) {
	const traceId = hex(traceIdx + 1, 32);
	const spans = [];
	for (let i = 0; i < SPANS_PER_TRACE; i++) {
		const parentIdx = i === 0 ? null : Math.floor((i - 1) / 2);
		const depth = i === 0 ? 0 : Math.floor(Math.log2(i + 1));
		const durMs = Math.max(5, 2000 - depth * 250);
		const start = BASE_NANO + BigInt(i) * 1000n;
		const end = start + BigInt(durMs) * 1_000_000n;
		spans.push({
			traceId,
			spanId: hex(i + 1, 16),
			parentSpanId: parentIdx === null ? "" : hex(parentIdx + 1, 16),
			name: `op.${i}`,
			kind: 2,
			startTimeUnixNano: start.toString(),
			endTimeUnixNano: end.toString(),
			status: { code: 1 },
			attributes: [kv("http.method", "GET"), kv("http.route", `/r/${i % 8}`)],
		});
	}
	return {
		traceId,
		body: {
			resourceSpans: [
				{
					resource: { attributes: [kv("service.name", `svc-${traceIdx % 5}`)] },
					scopeSpans: [{ scope: { name: "loadgen" }, spans }],
				},
			],
		},
	};
}

const pct = (sorted, p) =>
	sorted.length === 0
		? 0
		: sorted[
				Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
			];

function stats(arr) {
	const s = [...arr].sort((a, b) => a - b);
	const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
	return {
		n: s.length,
		mean_ms: +mean.toFixed(3),
		p50_ms: +pct(s, 50).toFixed(3),
		p95_ms: +pct(s, 95).toFixed(3),
		p99_ms: +pct(s, 99).toFixed(3),
		max_ms: +(s[s.length - 1] ?? 0).toFixed(3),
	};
}

async function timed(fn) {
	const t0 = performance.now();
	const r = await fn();
	return { ms: performance.now() - t0, r };
}

const ingestLat = [];
const traceIds = [];
let ingestOk = 0;

console.log(
	`Ingesting ${INGEST} traces (${SPANS_PER_TRACE} spans each) → ${BASE}`,
);
for (let i = 0; i < INGEST; i++) {
	const { traceId, body } = makeTrace(i);
	const { ms, r } = await timed(() =>
		fetch(`${BASE}/v1/traces`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
	ingestLat.push(ms);
	if (r.ok) {
		ingestOk++;
		traceIds.push(traceId);
	} else if (i === 0) {
		console.error("first ingest failed:", r.status, await r.text());
		process.exit(1);
	}
}

const detailLat = [];
const gapsLat = [];
let detailFound = 0;
let gapsFound = 0;
let blindspotTotal = 0;
const sample = Math.min(READS, traceIds.length);
console.log(`Reading ${sample} traces back (detail + gaps)…`);
for (let i = 0; i < sample; i++) {
	const tid = traceIds[Math.floor((i / sample) * traceIds.length)];
	const d = await timed(() =>
		fetch(`${BASE}/internal/telemetry/traces/${tid}`),
	);
	detailLat.push(d.ms);
	if (d.r.ok) detailFound++;
	const g = await timed(() =>
		fetch(`${BASE}/internal/telemetry/traces/${tid}/gaps`),
	);
	gapsLat.push(g.ms);
	if (g.r.ok) {
		gapsFound++;
		const j = await g.r.json();
		blindspotTotal += j.blindspots?.length ?? 0;
	}
}

console.log("\n===== RESULTS =====");
console.log(
	JSON.stringify(
		{
			ingest: { sent: INGEST, ok: ingestOk, ...stats(ingestLat) },
			trace_detail_read: { found: detailFound, ...stats(detailLat) },
			gaps_read: {
				found: gapsFound,
				blindspots_total: blindspotTotal,
				...stats(gapsLat),
			},
			read_write_ratio: {
				traces_ingested: ingestOk,
				traces_viewed: detailFound,
				ratio_pct: +((100 * detailFound) / (ingestOk || 1)).toFixed(3),
				note: "configured ratio — validates counting, not the production rate",
			},
		},
		null,
		2,
	),
);
