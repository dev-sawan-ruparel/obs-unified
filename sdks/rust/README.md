# obs-unified Rust SDK

Thin OpenTelemetry SDK wrapper for obs-unified. One-line init, OpenInference
LLM/tool helpers, and project propagation. The OTel ecosystem provides
HTTP/DB/RPC instrumentation; this crate adds what OTel doesn't ship out of the
box.

## Install

```toml
[dependencies]
obs-unified = "0.1"
opentelemetry = "0.27"
tokio = { version = "1", features = ["full"] }
```

For HTTP server / client tracing, also pull `tracing-opentelemetry` and
`tower-http`. For per-driver DB tracing, the matching `*-otel` crate.

## Quickstart

```rust
use obs_unified::{init, with_llm_span, Config, LlmOptions, LlmResult};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = init(Config {
        collector_url: std::env::var("OBS_COLLECTOR_URL")?,
        ingest_key: std::env::var("OBS_INGEST_KEY")?,
        service_name: "my-service".into(),
        service_version: Some("1.4.2".into()),
        environment: Some("production".into()),
        project_id: Some("default".into()),
        ..Default::default()
    })?;

    // ... your app ...
    Ok(())
}
```

`_guard` shuts down the providers on drop (flushing pending spans). Hold it for
the lifetime of `main`.

## LLM call instrumentation

```rust
use obs_unified::{with_llm_span, LlmOptions, LlmResult};

let response = with_llm_span(
    LlmOptions {
        provider: "openai",
        model: "gpt-4o-mini",
        max_tokens: Some(1024),
        turn_index: Some(turn),
        ..Default::default()
    },
    || async {
        let resp = client.chat(&req).await?;
        Ok(LlmResult::new(resp.clone())
            .with_usage(
                resp.usage.prompt_tokens as i64,
                resp.usage.completion_tokens as i64,
            )
            .with_finish_reason(resp.choices[0].finish_reason.clone()))
    },
).await?;
```

The wrap stamps `openinference.span.kind=LLM`, `gen_ai.system`,
`gen_ai.request.model`, and post-call `gen_ai.usage.*` attributes that the
dashboard's AI tab reads.

## Tool dispatch (agent loops)

```rust
use obs_unified::{with_tool_span, ToolOptions, ToolResult};

let result = with_tool_span(
    ToolOptions {
        name: "list_widgets",
        args: Some(serde_json::to_value(&parsed_args)?),
        ..Default::default()
    },
    || async {
        let out = dispatch(&parsed_args).await?;
        let count = out.items.len() as i64;
        Ok(ToolResult::new(out)
            .with_outcome("ok")
            .with_result_count(count))
    },
).await?;
```

## Project-id propagation

```rust
// Static default: passed to init via Config::project_id.
let _guard = init(Config { project_id: Some("tenant-acme".into()), .. })?;

// Per-request, after auth resolves the project:
use opentelemetry::Context;
use obs_unified::set_project_id;

let cx = Context::current();
set_project_id(&cx, project_id);
```

For service-to-service propagation, send the `obs_unified::PROJECT_ID_HEADER`
header on outbound requests; the receiver reads it and calls `set_project_id` in
its handler.

## Custom logical boundaries

For business operations worth naming, use OTel directly via the `tracing`
crate + `tracing-opentelemetry` bridge:

```rust
use tracing::instrument;

#[instrument(fields(order.id = %order_id, order.region = %region))]
async fn fulfill_order(order_id: &str, region: &str) -> Result<(), Error> {
    // ...
}
```

## Self-monitoring (rare)

If your service ingests its own telemetry through the same collector, set
`self_telemetry: true` in `Config`. Every export carries `X-Telemetry-Self: 1`
so the collector's request middleware short-circuits and avoids an export loop.
See
[`apps/collector/SELF_INSTRUMENTATION.md`](../../apps/collector/SELF_INSTRUMENTATION.md).

## Caveats

- **Tokio-only**: `init` uses `runtime::Tokio` for the OTLP exporter. If you're
  on `async-std` or another runtime, swap the runtime feature in
  `opentelemetry_sdk` (and the corresponding init code) accordingly.
- **OTel Rust API churn**: this crate targets the `0.27` line. The OTel Rust SDK
  has had API changes between minor releases historically — pin versions
  accordingly.
- **Continuous profiling and tracing complement each other.** This crate handles
  tracing; for CPU profiling, use Pyroscope, the `pprof` crate, or your
  platform's profiler.
