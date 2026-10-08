//! Thin OpenTelemetry SDK wrapper for obs-unified.
//!
//! See `README.md` for the full quickstart. The exposed surface:
//!
//! - [`init`] — configures the OTel global trace + log providers with
//!   OTLP/HTTP exporters pointed at your collector.
//! - [`with_llm_span`] / [`with_tool_span`] — OpenInference-shaped spans
//!   for LLM call sites and agent-loop tool dispatches.
//! - [`set_project_id`] / [`PROJECT_ID_HEADER`] — multi-tenant project
//!   propagation.
//!
//! The OTel ecosystem (tower-http / tracing-opentelemetry / per-driver
//! crates) provides HTTP / DB / RPC instrumentation. This crate only adds
//! what OTel doesn't ship.

mod init;
mod interaction;
mod llm;
mod project;

pub use init::{init, Config, ObsGuard};
pub use interaction::{
    is_valid_interaction_id, stamp_interaction, HeaderCarrier, INTERACTION_ATTRIBUTE,
    INTERACTION_HEADER,
};
pub use llm::{
    with_llm_span, with_tool_span, LlmOptions, LlmResult, LlmUsage, ToolOptions, ToolResult,
};
pub use project::{set_project_id, PROJECT_ID_ATTRIBUTE, PROJECT_ID_HEADER};

/// Errors from this crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("config field `{0}` is required")]
    ConfigMissing(&'static str),
    #[error("OTLP exporter setup failed: {0}")]
    Exporter(String),
}
