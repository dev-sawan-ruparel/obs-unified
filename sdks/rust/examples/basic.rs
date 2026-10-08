//! Minimal example. Run with:
//!
//!   OBS_COLLECTOR_URL=http://localhost:8790 OBS_INGEST_KEY=obs_xxx \
//!     cargo run --example basic
//!
//! In a real app you'd also wire HTTP / DB instrumentation via
//! `tracing-opentelemetry`, `tower-http::trace`, and per-driver crates.

use std::env;

use obs_unified::{
    init, with_llm_span, with_tool_span, Config, LlmOptions, LlmResult, ToolOptions, ToolResult,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _guard = init(Config {
        collector_url: env::var("OBS_COLLECTOR_URL")
            .unwrap_or_else(|_| "http://localhost:8790".into()),
        ingest_key: env::var("OBS_INGEST_KEY").unwrap_or_default(),
        service_name: "example-agent".into(),
        service_version: Some("0.1.0".into()),
        environment: Some("dev".into()),
        project_id: Some("default".into()),
        ..Default::default()
    })?;

    let answer: String = with_llm_span::<_, std::io::Error, _, _>(
        LlmOptions {
            provider: "openai",
            model: "gpt-4o-mini",
            max_tokens: Some(256),
            turn_index: Some(0),
            ..Default::default()
        },
        || async {
            // Pretend HTTP call. Real apps: tracing-opentelemetry will
            // create a child span for the actual reqwest call.
            Ok(LlmResult::new("It is sunny.".to_string())
                .with_usage(42, 5)
                .with_finish_reason("stop"))
        },
    )
    .await?;

    let items: Vec<String> = with_tool_span::<_, std::io::Error, _, _>(
        ToolOptions {
            name: "list_widgets",
            args: Some(serde_json::json!({ "color": "blue" })),
            ..Default::default()
        },
        || async {
            let out = vec!["a".to_string(), "b".to_string(), "c".to_string()];
            let count = out.len() as i64;
            Ok(ToolResult::new(out)
                .with_outcome("ok")
                .with_result_count(count))
        },
    )
    .await?;

    println!("answer={answer:?} items={items:?}");
    Ok(())
}
