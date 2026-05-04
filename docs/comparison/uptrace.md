# obs-unified vs Uptrace

A feature-by-feature comparison aimed at teams currently running [Uptrace](https://uptrace.dev) and evaluating obs-unified.

Legend: ✅ supported · ❌ not supported · 🟡 partial · ☁️ Cloudflare-only

---

## Ingest

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| OTLP/HTTP — protobuf | ✅ | ✅ | [otlp/decode.ts](../../packages/obs-collector/src/otlp/decode.ts) |
| OTLP/HTTP — JSON | ✅ | ✅ | Both encodings on every `/v1/*` endpoint |
| OTLP/HTTP — gzip | ✅ | ✅ | |
| **OTLP/gRPC** | ✅ | **❌** | Migration friction for SDKs defaulting to gRPC — flip exporter to `otlphttp` or front with an OTel collector |
| Proprietary high-throughput proto | ✅ Uptrace native | ❌ | |
| Custom backend SDK (typed) | ❌ | ✅ `@obs/telemetry-sdk` | |
| Custom frontend SDK (typed) | ❌ | ✅ `@obs/analytics-sdk` | |
| Per-request size limit | configurable | 🟡 hard-coded 2000 metric points/req | [metrics-receiver.ts:13](../../packages/obs-collector/src/plugins/metrics-receiver.ts) |
| API key auth on ingest | ✅ project tokens | ✅ ingest API key | |

## Storage

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Primary store | ClickHouse | SQLite / Cloudflare D1 | |
| Metadata store | PostgreSQL | (same SQLite) | |
| Replay/blob storage | ❌ N/A | R2 (Cloudflare) or filesystem | |
| Columnar compression | ✅ | ❌ row-store | |
| Horizontal scale | ✅ via CH cluster | ❌ single-DB | |
| Practical row ceiling | billions | ~100M hot rows ([RFC 0002](../../rfcs/0002-application-aware-analyses.md)) | |
| Retention TTL | months (CH partitions) | hours-days (cron sweep) | default 72h |

## Traces

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Span ingest + storage | ✅ | ✅ | |
| Trace waterfall view | ✅ | ✅ | |
| Span search by attribute | ✅ via UQL | 🟡 facet filters | No full query language |
| Span links (async edges) | ✅ | ✅ | |
| Span events | ✅ | ✅ | |
| Span status / error grouping | ✅ | ✅ Issues dashboard | |
| W3C trace context propagation | ✅ | ✅ | |
| Drop counts / sampling decisions | ✅ | ✅ | [migration 017](../../packages/obs-collector/src/migrations/017_span_dropped_counts.sql) |

## Logs

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| OTLP log ingest | ✅ | ✅ | |
| Severity filtering | ✅ | ✅ | |
| Log → trace correlation | ✅ | ✅ via `trace_id` | [logs-receiver.ts](../../packages/obs-collector/src/plugins/logs-receiver.ts) |
| Log facet filters | ✅ | ✅ | |
| Live tail | ✅ | ✅ | |
| Structured attribute search | ✅ via UQL | 🟡 substring + facets | |
| Log detail drawer | ✅ | ✅ | |

## Metrics

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Gauge | ✅ | ✅ | |
| Sum (counter) | ✅ | ✅ | |
| Histogram (explicit buckets) | ✅ | ✅ | |
| Exponential histogram | ✅ | ✅ | [migration 016](../../packages/obs-collector/src/migrations/016_metrics_exp_histogram_summary.sql), stored in `extra_json` |
| Summary | ✅ | 🟡 stored, not surfaced | |
| Exemplars (metric → trace) | ✅ | ✅ | `exemplars_json` column |
| **PromQL / equivalent query language** | ✅ UQL | **❌** | Power-user gap |
| Custom dashboards / panels | ✅ | 🟡 via Analyses, not free-form panels | Different paradigm — see [RFC 0002](../../rfcs/0002-application-aware-analyses.md) |
| Recording rules | ✅ | ❌ | |

## Service map

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Auto-derived from spans | ✅ | ✅ | [store.ts:870](../../packages/obs-collector/src/lib/store.ts) |
| Sync edges (parent_span_id) | ✅ | ✅ | |
| Async edges (span links — Kafka/SQS/RabbitMQ) | 🟡 | ✅ explicit UNION | obs-unified handles this cleanly |
| Per-edge p50/p95/RPS/error rate | ✅ | ✅ | |
| Click-through to spans | ✅ | ✅ | |
| DB / cache / external dep nodes | ✅ | 🟡 only services with `service.name` | |

## Alerting

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Threshold rules | ✅ | ✅ | [migration 012](../../packages/obs-collector/src/migrations/012_alert_rules.sql) |
| Anomaly detection | ✅ | ❌ | |
| Multi-condition rules | ✅ | 🟡 single-metric | |
| Alert evaluation history | ✅ | ✅ | [migration 013](../../packages/obs-collector/src/migrations/013_alert_evaluations.sql) |
| Alert state (firing/resolved) | ✅ | ✅ | [migration 014](../../packages/obs-collector/src/migrations/014_alert_state.sql) |
| **Alert → Analysis binding** (alert payload includes narrative explaining cause) | ❌ | ✅ Stage 6 | [migration 025](../../packages/obs-collector/src/migrations/025_stage6_autopinning_alerts.sql) — **differentiator** |

## Notification channels

| Channel | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Webhook (generic) | ✅ | ✅ | [alerts-evaluator.ts](../../packages/obs-collector/src/plugins/alerts-evaluator.ts) |
| Slack (native) | ✅ | ❌ — webhook only | Wire it via Slack incoming webhook |
| PagerDuty | ✅ | ❌ — webhook only | |
| Email / SMTP | ✅ | ❌ | |
| OpsGenie / VictorOps | ✅ | ❌ | |

## Frontend / RUM (Uptrace's blind spot)

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Page views | ❌ | ✅ | |
| Interaction events | ❌ | ✅ | |
| Frontend errors (uncaught + boundary) | ❌ | ✅ | |
| UTM / referrer tracking | ❌ | ✅ | [migration 003](../../packages/obs-collector/src/migrations/003_usage_analytics_columns.sql) |
| Bot filtering | ❌ | ✅ | [bot-filter.ts](../../packages/obs-collector/src/plugins/bot-filter.ts) |
| User-agent enrichment | ❌ | ✅ | |
| Visitor → user identity link | ❌ | ✅ | [migration 006](../../packages/obs-collector/src/migrations/006_user_profiles.sql) |
| Privacy / PII redaction | ❌ | ✅ | [usage-privacy.ts](../../packages/obs-collector/src/plugins/usage-privacy.ts) |

## Session replay

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| rrweb DOM recording | ❌ | ✅ | |
| Replay storage (R2 or fs) | ❌ | ✅ | |
| Replay → trace/log linkage | ❌ | ✅ via `session_id` | [migration 022](../../packages/obs-collector/src/migrations/022_span_log_session_id.sql) |
| Replay query/filter | ❌ | ✅ | [replay-query-routes.ts](../../packages/obs-collector/src/plugins/replay-query-routes.ts) |

## AI / LLM observability

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| LLM call ingest (model, tokens, cost, latency) | ❌ | ✅ | [migration 005](../../packages/obs-collector/src/migrations/005_ai_calls.sql) |
| Provider pricing tables | ❌ | ✅ | [ai-pricing.ts](../../packages/obs-collector/src/lib/ai-pricing.ts) |
| GenAI semantic-conv normalizer | ❌ | ✅ | [gen-ai-normalizer.ts](../../packages/obs-collector/src/plugins/gen-ai-normalizer.ts) |
| Prompt/response payload capture | ❌ | ✅ | [migration 019](../../packages/obs-collector/src/migrations/019_ai_span_payloads.sql) |
| Eval framework | ❌ | ✅ | [migration 020](../../packages/obs-collector/src/migrations/020_ai_span_evaluations.sql) |
| AI session grouping | ❌ | ✅ | [migration 021](../../packages/obs-collector/src/migrations/021_ai_span_session.sql) |

## Application-aware Analyses

The [RFC 0002](../../rfcs/0002-application-aware-analyses.md) thesis: the unit of value is an **answer**, not a query. Existing platforms ship primitives and assume the user can synthesize. obs-unified makes synthesis the default.

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Free-form panels | ✅ first-class | 🟡 power-user only | Different paradigm |
| **Narrative answers** ("p95 doubled in 8m, payment-svc 200→700ms, deploy at 10:42") | ❌ | ✅ Stage 3 | requires LLM API key |
| **NL Ask box** | ❌ | ✅ Stage 5 | [ask-routes.ts](../../packages/obs-collector/src/plugins/ask-routes.ts) — requires LLM API key |
| **Investigations** (multi-step, cohort joins, LLM-synthesized) | ❌ | ✅ Stage 4 | |
| **Auto-pinning** (Health tab learns from what people ask) | ❌ | ✅ Stage 6 | observational, not curated |
| LLM provider — Anthropic | ❌ | ✅ | |
| LLM provider — OpenAI | ❌ | ✅ | |
| Narrative gating + cache (LLM bill cap) | ❌ | ✅ | [narrate-gate.ts](../../packages/obs-collector/src/lib/narrate-gate.ts) |

## Infrastructure / host metrics

This is the largest *current* gap for non-Cloudflare deployments.

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| **Generic CPU / memory / disk via OTel `hostmetrics` receiver** | ✅ any Linux/Docker/k8s | **❌** | If your services emit `system.cpu.*` etc. as OTLP metrics, points *land* in `metric_point` — but no curated host view renders them |
| Cloudflare Worker CPU ms | N/A | ☁️ 🟡 | [platform-routes.ts](../../packages/obs-collector/src/plugins/platform-routes.ts) returns `0` + `"Needs Cloudflare Auth Token for live metrics"` |
| Cloudflare Worker memory | N/A | ☁️ 🟡 | same — needs GraphQL Analytics API token |
| Cloudflare Worker request count | N/A | ☁️ 🟡 | same |
| D1 row density | N/A | ☁️ ✅ | Cloudflare-specific |
| R2 storage bytes (replays) | N/A | ☁️ ✅ | Cloudflare-specific |
| **Generic Docker container metrics** | ✅ via OTel hostmetrics | **❌ no curated view** | Resources dashboard is Cloudflare-shaped — a Docker-deployed obs-unified will see "—" |
| k8s pod / node metrics | ✅ | ❌ | |
| Node Exporter / Prometheus receiver | ✅ | ❌ | |

> **Be upfront with users:** "Resources" today means *Cloudflare platform resources* (D1 / R2 / Worker), not *your application's host metrics*. Teams running obs-unified in a generic Docker container won't see CPU/memory of their app there. They can still emit OTLP metrics from their app and those land in the metrics tables — but no equivalent of Uptrace's `Hosts` view exists yet.

## Profiling

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Continuous profiling (pprof / pyroscope) | ✅ | ❌ | |
| Profile → span linkage | ✅ | ❌ | |

## Auth, multi-tenancy, governance

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Multi-user accounts | ✅ | ❌ single password | |
| RBAC (roles per project) | ✅ | ❌ | |
| SSO (OIDC / SAML) | ✅ | ❌ | |
| Audit log | ✅ | ❌ | |
| Multi-project (tenancy) | ✅ | ✅ | [migration 009](../../packages/obs-collector/src/migrations/009_projects_and_keys.sql) |
| Per-project ingest keys | ✅ | ✅ | |
| API token management | ✅ | 🟡 single ingest key per project | |

## Deployment / operations

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Cloudflare Workers compatible | ❌ | ✅ | |
| Generic Node.js / Bun / Deno | 🟡 (Go binary, not Node) | ✅ Hono | |
| Single-binary deploy | ✅ Go | ✅ Worker / Node process | |
| docker-compose recipe | ✅ official | 🟡 [demo only](../../demo/) | |
| Helm chart | ✅ | ❌ | |
| Backup / restore | manual on CH | manual on D1 / SQLite | |
| Self-observability | ✅ | 🟡 D1 row density only | |

## Extensibility

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Plugin system | ❌ | ✅ | [framework/collector.ts](../../packages/obs-collector/src/framework/collector.ts) |
| Embeddable dashboard components | ❌ | ✅ `<TelemetryDashboard />` | |
| Custom auth middleware | ❌ | ✅ `createIngestAuth` / `createDashboardAuth` | |
| Per-receiver enable/disable | partial | ✅ via plugin registration | |

## Data export / interop

| Feature | Uptrace | obs-unified | Notes |
|---|---|---|---|
| Direct ClickHouse access | ✅ | ❌ N/A | |
| Direct SQL on store | partial | ✅ SQLite is plain SQL | |
| OTLP forwarding to another backend | ✅ | ❌ | |
| Grafana data source | ✅ official | ❌ | |
| CSV / JSON export from UI | partial | ❌ | |

## License & maturity

| | Uptrace | obs-unified |
|---|---|---|
| License | AGPL-3.0 + commercial | (this repo) |
| GitHub stars / contributors | mature | new |
| Public docs | extensive | this README |
| Production deploys at scale | thousands | early |

---

## Where the delight lands

| Bucket | obs-unified > Uptrace |
|---|---|
| **Built-in scope** | RUM + replay + LLM obs in one tool — Uptrace is APM-only, you'd bolt on PostHog + LogRocket + Langfuse |
| **Answers, not queries** | Narrative analyses, AskBox, investigations, alerts that *explain* — Uptrace ships primitives only |
| **Footprint** | Single Worker/Node process + SQLite vs CH + PG cluster |
| **Embeddability** | Dashboard components drop into your admin app — no Uptrace equivalent |
| **Async service map** | Span-link edges (Kafka/SQS) handled cleanly |

## Where Uptrace wins

| Bucket | Uptrace > obs-unified |
|---|---|
| **OTLP/gRPC** | Native; obs-unified is HTTP-only |
| **Generic infra metrics** | Uptrace shows your hosts'/containers' CPU & memory; obs-unified's "Resources" is Cloudflare-only and partially stubbed |
| **Query language** | UQL for ad-hoc trace/log/metric queries |
| **Scale & retention** | ClickHouse: months × billions of rows |
| **Multi-user / RBAC / SSO** | Required for any org with >1 team |
| **Notification channels** | Native Slack/PagerDuty/Email; obs-unified is webhook-only |
| **Continuous profiling** | Not in obs-unified at all |
| **Anomaly-detection alerts** | Threshold-only in obs-unified |
| **Grafana data source** | Doesn't exist for obs-unified |
| **Maturity** | Years of production users; obs-unified is early |

## TL;DR

If you're a small team using Uptrace mostly for traces + service map + threshold alerts, obs-unified gives you that **plus** narrative analyses, RUM, replay, and LLM cost tracking — at the price of OTLP/HTTP-only ingest, no SSO, no Slack/PagerDuty, no continuous profiling, and a Resources tab that today only knows about Cloudflare. The migration cost is highest if you depend on UQL ad-hoc queries or OTLP/gRPC; lowest if your value from Uptrace is the dashboard, not the query language.
