//! Project-id propagation. obs-unified is multi-tenant: every emission
//! carries a `project.id` so the dashboard can filter by project.

use opentelemetry::trace::TraceContextExt;
use opentelemetry::{Context, KeyValue};

/// Resource / span attribute key used by obs-unified to scope every
/// emission to a project.
pub const PROJECT_ID_ATTRIBUTE: &str = "project.id";

/// HTTP header used to propagate project id across service boundaries.
pub const PROJECT_ID_HEADER: &str = "X-Project-Id";

/// Stamps `project.id` on the span associated with the given context.
/// No-op if there's no active span in the context.
pub fn set_project_id(cx: &Context, project_id: impl Into<String>) {
    let span = cx.span();
    if span.span_context().is_valid() {
        span.set_attribute(KeyValue::new(PROJECT_ID_ATTRIBUTE, project_id.into()));
    }
}
