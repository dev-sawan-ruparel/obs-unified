# Recipes — adopting obs-unified from non-Tier-1 runtimes

obs-unified ships first-party SDKs for browsers, Node.js, Cloudflare
Workers, Go, Rust. For everything else, point the **standard OTel SDK
of your language** at the collector and use the small helper this page
links to for `interaction_id` stamping + AI-call attribute conventions.

## Tier 1 — first-party SDKs

- [`@obs-unified/analytics-sdk`](../../packages/analytics-sdk) — browser
- [`@obs-unified/telemetry-sdk`](../../packages/telemetry-sdk) — Node, Workers, Bun, Deno
- [`obs` (Go)](../../sdks/go)
- [`obs-unified` (Rust)](../../sdks/rust)

## Tier 2 — recipes

| Runtime | Recipe |
| --- | --- |
| Python | [python.md](./python.md) |
| Python + Flask walkthrough | [../howto/instrument-python-flask.md](../howto/instrument-python-flask.md) |
| JVM (Java / Kotlin) | [jvm.md](./jvm.md) |
| .NET | [dotnet.md](./dotnet.md) |

Each recipe is ~3 helper functions on top of the standard OTel SDK
of the language. They cover the three things the platform's "unified"
promise requires:

1. **OTLP/HTTP setup** pointing at the collector with the ingest key.
2. **`interaction_id` stamping** middleware that reads `x-obs-interaction`
   and adds `obs.interaction.id` to the active span.
3. **AI-call attribute conventions** — the OpenInference attribute
   names (`openinference.span.kind`, `gen_ai.*`) that the collector's
   `gen-ai-normalizer` plugin denormalizes into the `ai_calls` table.

## Want to contribute a first-party SDK?

See [`sdks/_template/`](../../sdks/_template) for the package skeleton,
required surface, and conformance test list. The wire spec is at
[`docs/spec/interaction-id.md`](../spec/interaction-id.md).

Community SDKs that pass the conformance tests get listed in
[`sdks/README.md`](../../sdks/README.md) under a "Community" column.
