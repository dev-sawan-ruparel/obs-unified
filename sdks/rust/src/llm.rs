//! OpenInference-shaped LLM and tool span helpers.
//!
//! These wrap an async future in a span with the conventions the
//! obs-unified dashboard's AI tab reads (`openinference.span.kind`,
//! `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.*`, etc.).

use std::collections::HashMap;
use std::future::Future;

use opentelemetry::global;
use opentelemetry::trace::{Span as _, SpanKind, Status, Tracer as _, TracerProvider as _};
use opentelemetry::KeyValue;

const TRACER_NAME: &str = "obs-unified";

fn tracer() -> opentelemetry::global::BoxedTracer {
    global::tracer_provider().tracer(TRACER_NAME)
}

// ── LLM spans ────────────────────────────────────────────────────────────

/// Options for [`with_llm_span`].
#[derive(Clone, Debug, Default)]
pub struct LlmOptions<'a> {
    /// Provider, e.g. `"openai"`. Stamped as `gen_ai.system`.
    pub provider: &'a str,
    /// Model id, e.g. `"gpt-4o-mini"`. Stamped as `gen_ai.request.model`.
    pub model: &'a str,
    /// Optional max-tokens hint; stamped as `gen_ai.request.max_tokens`.
    pub max_tokens: Option<i64>,
    /// Optional system message (truncated to 1024 chars).
    pub system_message: Option<&'a str>,
    /// Optional turn index for agent loops; stamped as `llm.turn`.
    pub turn_index: Option<i64>,
    /// Free-form attributes merged onto the span before fn runs.
    pub attributes: HashMap<String, String>,
}

/// Post-call setters exposed to the closure passed to [`with_llm_span`].
pub struct LlmUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
}

/// Result returned from the closure — the value plus optional usage info
/// stamped onto the span before it ends.
pub struct LlmResult<T> {
    pub value: T,
    pub usage: Option<LlmUsage>,
    pub finish_reason: Option<String>,
    pub response_model: Option<String>,
}

impl<T> LlmResult<T> {
    pub fn new(value: T) -> Self {
        Self {
            value,
            usage: None,
            finish_reason: None,
            response_model: None,
        }
    }

    pub fn with_usage(mut self, input_tokens: i64, output_tokens: i64) -> Self {
        self.usage = Some(LlmUsage {
            input_tokens: Some(input_tokens),
            output_tokens: Some(output_tokens),
            total_tokens: Some(input_tokens + output_tokens),
        });
        self
    }

    pub fn with_finish_reason(mut self, reason: impl Into<String>) -> Self {
        self.finish_reason = Some(reason.into());
        self
    }

    pub fn with_response_model(mut self, model: impl Into<String>) -> Self {
        self.response_model = Some(model.into());
        self
    }
}

/// Wrap `fn` in an LLM-shaped span. Return [`LlmResult::new(value)`] from
/// the closure, optionally enriched with `.with_usage(..)` /
/// `.with_finish_reason(..)`.
///
/// ```ignore
/// let resp = obs_unified::with_llm_span(
///     LlmOptions { provider: "openai", model: "gpt-4o-mini", ..Default::default() },
///     |_span| async move {
///         let json = call_openai().await?;
///         Ok::<_, MyErr>(LlmResult::new(json.clone()).with_usage(
///             json.usage.prompt_tokens as i64,
///             json.usage.completion_tokens as i64,
///         ))
///     },
/// ).await?;
/// ```
pub async fn with_llm_span<T, E, F, Fut>(opts: LlmOptions<'_>, f: F) -> Result<T, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<LlmResult<T>, E>>,
    E: std::fmt::Display,
{
    let mut span = tracer()
        .span_builder(format!("llm.{}.chat", opts.provider))
        .with_kind(SpanKind::Client)
        .with_attributes([
            KeyValue::new("openinference.span.kind", "LLM"),
            KeyValue::new("gen_ai.system", opts.provider.to_string()),
            KeyValue::new("gen_ai.request.model", opts.model.to_string()),
        ])
        .start(&tracer());

    if let Some(mt) = opts.max_tokens {
        span.set_attribute(KeyValue::new("gen_ai.request.max_tokens", mt));
    }
    if let Some(sm) = opts.system_message {
        span.set_attribute(KeyValue::new("gen_ai.system_message", truncate(sm, 1024)));
    }
    if let Some(t) = opts.turn_index {
        span.set_attribute(KeyValue::new("llm.turn", t));
    }
    for (k, v) in opts.attributes {
        span.set_attribute(KeyValue::new(k, v));
    }

    let result = f().await;
    match &result {
        Ok(r) => {
            if let Some(u) = &r.usage {
                if let Some(it) = u.input_tokens {
                    span.set_attribute(KeyValue::new("gen_ai.usage.input_tokens", it));
                }
                if let Some(ot) = u.output_tokens {
                    span.set_attribute(KeyValue::new("gen_ai.usage.output_tokens", ot));
                }
                if let Some(tt) = u.total_tokens {
                    span.set_attribute(KeyValue::new("gen_ai.usage.total_tokens", tt));
                }
            }
            if let Some(fr) = r.finish_reason.as_ref() {
                span.set_attribute(KeyValue::new("gen_ai.response.finish_reason", fr.clone()));
            }
            if let Some(rm) = r.response_model.as_ref() {
                span.set_attribute(KeyValue::new("gen_ai.response.model", rm.clone()));
            }
            span.set_status(Status::Ok);
        }
        Err(err) => {
            span.set_status(Status::error(err.to_string()));
        }
    }
    span.end();
    result.map(|r| r.value)
}

// ── Tool spans ───────────────────────────────────────────────────────────

/// Options for [`with_tool_span`].
#[derive(Clone, Debug, Default)]
pub struct ToolOptions<'a> {
    /// Tool name, e.g. `"list_widgets"`. Span name becomes `tool.<name>`.
    pub name: &'a str,
    /// Args JSON-stringified into `tool.args` (truncated to 512 chars).
    pub args: Option<serde_json::Value>,
    /// Free-form attributes merged onto the span before fn runs.
    pub attributes: HashMap<String, String>,
}

/// Result returned from the tool closure.
pub struct ToolResult<T> {
    pub value: T,
    pub outcome: Option<String>,
    pub result_count: Option<i64>,
}

impl<T> ToolResult<T> {
    pub fn new(value: T) -> Self {
        Self {
            value,
            outcome: None,
            result_count: None,
        }
    }

    pub fn with_outcome(mut self, outcome: impl Into<String>) -> Self {
        self.outcome = Some(outcome.into());
        self
    }

    pub fn with_result_count(mut self, count: i64) -> Self {
        self.result_count = Some(count);
        self
    }
}

/// Wrap `fn` in a TOOL-shaped span.
pub async fn with_tool_span<T, E, F, Fut>(opts: ToolOptions<'_>, f: F) -> Result<T, E>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<ToolResult<T>, E>>,
    E: std::fmt::Display,
{
    let mut span = tracer()
        .span_builder(format!("tool.{}", opts.name))
        .with_kind(SpanKind::Internal)
        .with_attributes([
            KeyValue::new("openinference.span.kind", "TOOL"),
            KeyValue::new("tool.name", opts.name.to_string()),
        ])
        .start(&tracer());

    if let Some(args) = opts.args {
        if let Ok(s) = serde_json::to_string(&args) {
            span.set_attribute(KeyValue::new("tool.args", truncate(&s, 512)));
        }
    }
    for (k, v) in opts.attributes {
        span.set_attribute(KeyValue::new(k, v));
    }

    let result = f().await;
    match &result {
        Ok(r) => {
            if let Some(o) = r.outcome.as_ref() {
                span.set_attribute(KeyValue::new("tool.outcome", o.clone()));
            }
            if let Some(c) = r.result_count {
                span.set_attribute(KeyValue::new("tool.result_count", c));
            }
            span.set_status(Status::Ok);
        }
        Err(err) => span.set_status(Status::error(err.to_string())),
    }
    span.end();
    result.map(|r| r.value)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut out = s[..max].to_string();
        out.push('…');
        out
    }
}
