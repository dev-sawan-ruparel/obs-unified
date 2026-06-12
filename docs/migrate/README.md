# Migration guides

Moving from another observability tool? Each guide below maps that tool's mental
model to obs-unified's and explains the SDK swap.

| From      | Guide                                    |
| --------- | ---------------------------------------- |
| PostHog   | [from-posthog.md](./from-posthog.md)     |
| Sentry    | [from-sentry.md](./from-sentry.md)       |
| Honeycomb | [from-honeycomb.md](./from-honeycomb.md) |

Don't see your tool? File an issue — Datadog, New Relic, Grafana Cloud, Uptrace,
and SigNoz comparisons are tracked in [`docs/comparison/`](../comparison/).

## Cutover pattern

Most users dual-write for 1–2 weeks then turn off the old tool. The
[`@obsunified/analytics-sdk`](../../packages/analytics-sdk) doesn't conflict
with other SDKs running in the same browser — multiple SDKs can capture clicks
independently. The OTel SDK on the server side supports `MultiSpanProcessor` for
sending to two backends at once.
