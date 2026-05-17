# Migrating from Honeycomb

If you're on Honeycomb, you're already on OpenTelemetry — that's the
easy half. obs-unified accepts OTLP/HTTP traces and logs at the
standard endpoints, so the wire-level swap is one config change.

## The five-minute version

Point your existing OTel exporter at the obs-unified collector:

```diff
- OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
- OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<api-key>
+ OTEL_EXPORTER_OTLP_ENDPOINT=https://obs.my-app.com
+ OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <obs-ingest-key>
```

Everything else — span names, attributes, resource conventions, trace
context propagation — just works. obs-unified follows the OTel
semantic conventions.

## Concept mapping

| Honeycomb | obs-unified |
| --- | --- |
| Dataset | Service (`service.name` attribute) |
| Trace / span | Trace / span (OTel) |
| Query (BubbleUp, GroupBy) | The dashboard's filterable views per tab |
| SLO | Alert rule with derived signal (roadmap; bare alerts ship today) |
| Trigger | Alert rule |
| Marker | (not yet — use deployment.environment + `service.version` for release tracking) |

## What you GAIN

- **Usage events + session replay** correlated to your existing OTel
  spans. The browser SDK auto-injects an `x-obs-interaction` header
  that the server stamps on the root span; the dashboard then pivots
  from "click" to "trace" in one click.
- **AI call surface.** Honeycomb has the building blocks (custom
  attributes on spans) but no first-class AI tab. obs-unified
  denormalizes LLM spans into an `ai_calls` table with model, cost,
  tokens, and per-user attribution.
- **Self-hosted.** Honeycomb is hosted-only at meaningful scale.
  obs-unified runs on your infra.

## What you LOSE (today)

- **Honeycomb's query speed at scale.** Their columnar store is
  faster than D1/Postgres for wide queries over billions of spans.
  obs-unified at scale needs ClickHouse — which is on the storage
  adapter roadmap but not shipping today.
- **BubbleUp / heatmaps.** Honeycomb's per-attribute outlier detection
  is hard to match. obs-unified's analyses framework can grow into
  this; today it covers top-offenders and latency outliers only.
- **Long retention.** Default 72h with retention cleanup. Configurable
  but unbounded retention pushes you into ClickHouse territory.

## When NOT to migrate

If your span volume is >10k/s sustained, obs-unified's D1/Postgres
storage will hurt. Wait for the ClickHouse adapter (storage interface
seam is already in — see [RFC 0008](../../rfcs/0008-storage-interface.md))
or stay on Honeycomb.
