# obs-unified SDKs

Thin per-language packages that sit on top of OpenTelemetry and add
obs-unified-specific conventions:

- One-line init that points the OTel SDK at your collector.
- OpenInference-shaped helpers for LLM and tool-call spans (so the AI tab
  in the dashboard renders correctly).
- Project-id propagation for multi-tenant deployments.
- Loop-guard header for services that ingest their own telemetry.

The heavy lifting — HTTP / DB / RPC auto-instrumentation — comes from the
OpenTelemetry ecosystem of your language. Our SDKs are ergonomics +
conventions, not coverage.

## Available

| Language | Path | Status |
|---|---|---|
| Node.js / TypeScript | [`node/`](./node) | initial |
| Go | [`go/`](./go) | initial |
| Rust | [`rust/`](./rust) | initial |

For Cloudflare Workers TypeScript, use [`packages/telemetry-sdk`](../packages/telemetry-sdk)
instead — that one is Workers-shaped and ships with `wrapD1` / `wrapR2` /
`wrapFetch` Cloudflare-binding wrappers.

## Cross-language API shape

All three SDKs expose the same surface — the names map idiomatically:

| Concept | Node | Go | Rust |
|---|---|---|---|
| Init | `init(config)` | `obs.Init(ctx, cfg)` | `obs_unified::init(cfg)` |
| LLM span | `withLLMSpan(opts, fn)` | `obs.WithLLMSpan(ctx, opts, fn)` | `obs_unified::with_llm_span(opts, fn).await` |
| Tool span | `withToolSpan(opts, fn)` | `obs.WithToolSpan(ctx, opts, fn)` | `obs_unified::with_tool_span(opts, fn).await` |
| Project ID | `setProjectId(id)` | `obs.SetProjectID(ctx, id)` | `obs_unified::set_project_id(id)` |

## What you do *not* get from these SDKs

- HTTP server / client instrumentation. Use OTel's
  `@opentelemetry/instrumentation-http` (Node), `otelhttp` (Go),
  `tower-http` + `tracing-opentelemetry` (Rust).
- Database client instrumentation. Use OTel's per-driver packages
  (`@opentelemetry/instrumentation-pg`, `otelpgx`, `sqlx-otel`, ...).
- Domain-specific span boundaries. You add those manually with the
  OTel tracer at points where blame-attribution matters.

The full design rationale is in [`packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md`](../packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md).
