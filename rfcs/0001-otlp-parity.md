# RFC 0001: OTLP Receiver Parity

- **Status:** Shipped (with deferrals — see §Post-implementation audit)
- **Author:** @sawanruparel
- **Created:** 2026-04-17
- **Updated:** 2026-04-17
- **Target:** `@obs-unified/collector`

## Summary

Bring the collector's OTLP receivers to behavioral parity with the reference
OpenTelemetry Go receiver (`receiver/otlpreceiver`) over HTTP, so that any OTel
SDK, OTel Collector, or third-party tool that works against the Go receiver
works against ours unchanged. Scope is the **HTTP surface only**; gRPC is
explicitly out of scope because Cloudflare Workers cannot host it.

## Motivation

Today the collector accepts a narrow slice of OTLP:

- `/v1/traces` — real `ExportTraceServiceRequest` shape, but **JSON only** and
  hard-rejects batches >500 spans.
- `/v1/logs` — a **custom** `{ logs: [...] }` shape, not OTLP.
- `/v1/metrics` — not implemented.

A stock OTel SDK with default configuration fails against us because:

1. SDKs default to `http/protobuf` — we only parse JSON.
2. SDKs send gzip-compressed bodies by default — we don't decompress.
3. SDKs export logs using the OTLP `resourceLogs` shape — we reject it.
4. No metrics pipeline exists.

This RFC defines "parity" as a testable bar and stages the work to reach it.

## Definition of parity

**Behavioral parity with the OTLP/HTTP contract**, not feature-for-feature
parity with the Go collector. Specifically, the following three acceptance tests
must pass green:

1. **Stock SDK test.** An OpenTelemetry JS SDK with default config (protobuf +
   gzip) emitting traces, logs, and metrics to our endpoint results in all data
   arriving intact with correct semantics.
2. **Go collector forward test.** `otelcol-contrib` configured with an
   `otlphttp` exporter pointed at our collector successfully forwards a fixture
   batch of traces, logs, and metrics.
3. **Partial-success test.** A batch containing one malformed span and 99 valid
   spans returns `200 OK` with
   `partial_success { rejected_spans: 1, error_message: "..." }` and stores 99
   spans.

If all three pass, the receiver is at parity.

## Non-goals

Explicitly out of scope:

- OTLP/gRPC on port 4317 (Workers runtime cannot host it).
- The experimental Profiles signal.
- `zstd` request body compression.
- OTel Arrow encoding.
- OTTL transform rules (that's a processor concern, not a receiver concern).
- Multi-tenant project routing beyond what already exists.

## Proposed design

### Scope per signal

| Signal        | Status                         | Target                                       |
| ------------- | ------------------------------ | -------------------------------------------- |
| `/v1/traces`  | JSON-only, custom 500-span cap | OTLP JSON + protobuf + gzip, partial_success |
| `/v1/logs`    | Custom shape                   | Real OTLP `ExportLogsServiceRequest`         |
| `/v1/metrics` | Missing                        | Full OTLP `ExportMetricsServiceRequest`      |

### Transport & encoding

- **HTTP/JSON** via proto-JSON mapping: lowercase-hex IDs, camelCase fields,
  `stringValue`/`intValue`/etc. anyvalue shape.
- **HTTP/protobuf** via `@bufbuild/protobuf` (protobuf-es v2). Chosen over
  `protobufjs` because: ESM-native with first-class tree-shaking, no Node
  built-in dependencies, generates plain TS types (no runtime reflection
  overhead), and its sibling project `@connectrpc/connect-cloudflare-workers`
  proves the runtime is production-tested on Workers. Content-type dispatch on
  `application/x-protobuf` vs `application/json`.
- **gzip** request bodies via the Web Streams API `DecompressionStream`
  (available in Workers).
- Response content-type **mirrors** request content-type.

### Response contract

Replace the current `{ success, inserted, traceCount, ... }` ad-hoc JSON with
the real OTLP response envelope:

```proto
message ExportTraceServiceResponse {
  ExportTracePartialSuccess partial_success = 1;
}
message ExportTracePartialSuccess {
  int64 rejected_spans = 1;
  string error_message = 2;
}
```

Status code matrix:

| Condition                    | Status                | Body                                            |
| ---------------------------- | --------------------- | ----------------------------------------------- |
| All accepted                 | `200`                 | Empty `ExportXServiceResponse{}`                |
| Some rejected (validation)   | `200`                 | `partial_success { rejected_X, error_message }` |
| Malformed body (can't parse) | `400`                 | Plain error                                     |
| Auth failure                 | `401` / `403`         | Plain error                                     |
| Throttled                    | `429` + `Retry-After` | Plain error                                     |
| Overloaded                   | `503` + `Retry-After` | Plain error                                     |
| Server error                 | `5xx` (retryable)     | Plain error                                     |

### Schema conformance

Decode the full `Export{Trace,Logs,Metrics}ServiceRequest` without loss for:

**Traces:**

- `kind` (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER)
- `status` with code + message
- `events[]` (name, timestamp, attributes, droppedAttributesCount)
- `links[]` (traceId, spanId, traceState, attributes)
- `droppedAttributesCount`, `droppedEventsCount`, `droppedLinksCount`
- `traceState` (W3C)
- All `AnyValue` variants: string, bool, int, double, **bytes**, array, kvlist

**Logs:**

- `body` as `AnyValue` (not just string)
- `severityNumber` (1–24) AND `severityText`
- `flags`, `traceId`, `spanId`
- `observedTimeUnixNano` vs `timeUnixNano` — both preserved

**Metrics (phased):**

- Phase 4: `gauge`, `sum` (with aggregationTemporality + isMonotonic),
  `histogram` (buckets, min, max, sum), `exemplars[]`
- Phase 5: `exponentialHistogram`, `summary`

### Semantic correctness

- **Timestamps:** uint64 nanoseconds since Unix epoch. Preserve ns internally;
  truncate only at display boundaries.
- **IDs:** trace_id = 16 bytes, span_id = 8 bytes. Proto = raw bytes; JSON =
  lowercase hex. Both decode paths validate length.
- **Resource** / **InstrumentationScope** hierarchy is preserved —
  `service.name` stays queryable at the resource level, `scope.name` stays
  queryable at the scope level. We do not flatten into spans.

### File layout

```
packages/obs-collector/
├── src/
│   ├── lib/
│   │   ├── otlp/
│   │   │   ├── proto.ts        # protobufjs-loaded proto schemas
│   │   │   ├── decode.ts       # content-type + gzip dispatch
│   │   │   ├── response.ts     # partial_success envelope helpers
│   │   │   ├── traces.ts       # → StoredSpan[] (moved from lib/otlp.ts)
│   │   │   ├── logs.ts         # → StoredLog[] (new)
│   │   │   └── metrics.ts      # → StoredMetric[] (new)
│   └── plugins/
│       ├── otlp-receiver.ts    # /v1/traces (refactored)
│       ├── logs-receiver.ts    # /v1/logs (rewritten to OTLP shape)
│       └── metrics-receiver.ts # /v1/metrics (new)
```

### Metrics storage (Phase 4 detail)

A separate design sub-RFC will cover the metrics storage schema. Rough sketch:

```
metric_series(id, project_id, name, unit, type, attrs_hash, attrs_json)
metric_point(series_id, ts_ns, value, exemplar_trace_id, exemplar_span_id)
metric_histogram_point(series_id, ts_ns, count, sum, min, max, bounds_json, bucket_counts_json)
```

Details (rollups, temporality handling, cardinality limits) deferred to
RFC 0002.

## Migration / compatibility

Hard cut — no compatibility shim:

- `/v1/logs` is rewritten to accept real OTLP `ExportLogsServiceRequest`. The
  custom `{ logs: [...] }` shape is removed.
- `@obs-unified/telemetry-sdk`'s logger is updated in the same change to emit
  real OTLP log payloads.
- Trace endpoint wire shape doesn't change — only the response envelope. The SDK
  ignores response bodies today, so this is transparent.
- Any external caller hitting `/v1/logs` with the old shape will fail with
  `400 Bad Request` after this lands. This is acceptable — there are no known
  external consumers, only the in-repo SDK.

## Implementation plan

| Phase     | Scope                                                            | Est.           |
| --------- | ---------------------------------------------------------------- | -------------- |
| 1         | Protobuf decode + gzip + content-type dispatch on `/v1/traces`   | 2d             |
| 2         | Rewrite `/v1/logs` to OTLP shape + update SDK emitter (hard cut) | 1d             |
| 3         | Partial-success response envelope on traces + logs               | 1d             |
| 4         | `/v1/metrics` — gauge, sum, histogram, exemplars                 | 4d             |
| 5         | Exponential histogram + summary                                  | 2d             |
| 6         | 429/503 + `Retry-After`, backpressure                            | 1d             |
| 7         | Acceptance tests (SDK + Go collector forward + partial-success)  | 2d             |
| **Total** |                                                                  | **~2.5 weeks** |

## Open questions

1. **Max body size policy** — Go collector defaults to unlimited for HTTP. We
   probably want a per-signal cap (~10MB default) with 413 + partial_success
   when exceeded. Confirm in Phase 3.
2. **Metrics cardinality cap** — how many unique series per project before we
   refuse new ones with 429? Deferred to RFC 0002.
3. **Exemplar storage** — inline on each point vs a separate exemplar table?
   Deferred to RFC 0002.

## Resolved decisions

- **Runtime target:** Cloudflare Workers only. No Node/Bun support promised.
- **Protobuf library:** `@bufbuild/protobuf` v2.
- **Migration:** hard cut. `/v1/logs` old shape removed in one change.

## References

- OpenTelemetry Protocol spec:
  https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/otlp.md
- opentelemetry-proto: https://github.com/open-telemetry/opentelemetry-proto
- Go receiver source:
  https://github.com/open-telemetry/opentelemetry-collector/tree/main/receiver/otlpreceiver

## Post-implementation audit

Written after Phase 7 landed. Tracks what actually shipped vs what the RFC
defined, so future parity work starts from reality instead of the plan.

### Shipped

**Transport & encoding**

- HTTP/JSON and HTTP/protobuf on `/v1/traces`, `/v1/logs`, `/v1/metrics`
- Content-type dispatch via `@bufbuild/protobuf` (`fromBinary` / `fromJson`)
- gzip request decompression via `DecompressionStream`
- Response content-type mirrors request
- Hex AND base64 trace/span IDs accepted in JSON (Go receiver behavior)

**Response contract**

- `200` + empty envelope on full success
- `200` + `partial_success { rejected_*, error_message }` on over-cap truncation
- `200` + `partial_success` on **per-record validation failures** (RFC bar #3) —
  invalid trace/span IDs are rejected individually while valid siblings in the
  same batch are stored
- `400` on malformed body
- `415` on unknown content-type / encoding
- `503 + Retry-After` on storage failure (spec-compliant retryable error)

**Schema conformance**

- Traces: kind, status (code + message), events (with droppedAttributesCount),
  links (with traceState + droppedAttributesCount), span-level
  droppedAttributesCount / droppedEventsCount / droppedLinksCount, span-level
  traceState — all round-tripped end-to-end
- Logs: body as `AnyValue`, severityNumber + severityText, flags,
  droppedAttributesCount, traceId/spanId, timeUnixNano + observedTimeUnixNano
- Metrics: all 5 types (gauge, sum, histogram, exponentialHistogram, summary)
  with aggregationTemporality, isMonotonic, bucket bounds, min/max/sum,
  exemplars

**Non-goals honored** — no gRPC, no Profiles, no zstd, no Arrow, no OTTL, no
multi-tenant routing beyond existing.

### Deferred / not shipped

- **Acceptance test #1 (Stock OTel JS SDK fixture)** — current suite uses
  `@bufbuild/protobuf` to construct payloads. The hex-vs-base64 ID bug that
  shipped and was caught in dev testing would have been caught by a real-SDK
  fixture. _Recommended follow-up: capture one real payload per signal from
  `@opentelemetry/sdk-node` and pin it as a golden fixture._
- **Acceptance test #2 (Go `otelcol-contrib` forward)** — never implemented.
  Requires the `otelcol` binary as a test dependency. _Follow-up: add as an
  optional CI job._
- **Rate-limited 429 + Retry-After** — helper `otlpRetryableError` supports 429,
  but no code path emits it. Single-system scope, acceptable gap.
- **`AnyValue.bytesValue` distinguishability** — encoded as base64 string on
  output, indistinguishable from `stringValue` downstream. Real SDKs use this
  only for unusual attribute types; low-impact deferral.
- **Max body size policy** — no explicit byte cap. Per-signal record caps (500
  spans / 1000 logs / 2000 metric points) are the only limit. _Follow-up if we
  ever see memory pressure._
- **Metrics cardinality cap** — deferred to RFC 0002 (metrics storage).
- **Metrics query endpoints** — outside receiver scope; lives with the dashboard
  redesign.

### Resolved design decisions

- **Runtime target:** Cloudflare Workers only.
- **Protobuf library:** `@bufbuild/protobuf` v2.
- **Migration strategy:** hard cut. `/v1/logs` custom shape removed in one
  change; SDK updated in the same PR.
- **Metric type coverage:** all 5 types supported (exp-histogram + summary use a
  generic `extra_json` column to avoid schema churn).
- **Exemplar storage:** inline as `exemplars_json` on each point row.

### Acceptance test status

| Bar                                                       | Status     | Notes                                                                                         |
| --------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| 1. Stock SDK emits traces/logs/metrics, all arrive intact | ⚠️ partial | Buf fixtures cover wire shape; real-SDK fixture deferred. Live dev-loop verifies end-to-end.  |
| 2. Go collector forwards to us via `otlphttp`             | ❌         | Deferred — requires `otelcol-contrib`                                                         |
| 3. Malformed span in batch → partial_success              | ✅         | Covered by acceptance test `accepts valid spans and rejects malformed ones in the same batch` |

### File layout — actual vs RFC

RFC said `src/lib/otlp/*.ts`; shipped as `src/otlp/*.ts`. Everything else
matches. The `lib/otlp.ts` file (legacy `toStoredSpans`) was preserved rather
than moved, to keep the diff tractable.

### Tests

- **Unit:**
  [src/otlp/decode.test.ts](../packages/obs-collector/src/otlp/decode.test.ts) —
  19 tests covering decode + adapters
- **Unit:**
  [src/otlp/response.test.ts](../packages/obs-collector/src/otlp/response.test.ts)
  — 8 tests covering envelope encoding + retryable errors
- **Live acceptance:**
  [src/otlp/acceptance.test.ts](../packages/obs-collector/src/otlp/acceptance.test.ts)
  — 14 tests; run via `pnpm run e2e:otlp`

Total: 41 OTLP-specific tests, all green.
