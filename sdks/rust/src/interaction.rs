//! Click-scoped correlation key propagation (server side).
//!
//! The browser SDK (`@obsunified/analytics-sdk`) mints an
//! `interaction_id` on every click and sets it on the `x-obs-interaction`
//! header of outbound requests. This module reads that header on the
//! server side and stamps the active span with `obs.interaction.id` so
//! child spans, logs, and AI calls inherit it.
//!
//! Wire spec: `docs/spec/interaction-id.md` in the obs-unified repo.
//!
//! Usage with `axum` or `hyper`:
//!
//! ```ignore
//! use obs_unified::stamp_interaction;
//! use opentelemetry::Context;
//!
//! async fn handler(req: Request<Body>) -> impl IntoResponse {
//!     let cx = Context::current();
//!     stamp_interaction(&cx, req.headers());
//!     // ... your handler ...
//! }
//! ```

use opentelemetry::trace::TraceContextExt;
use opentelemetry::{Context, KeyValue};

/// Inbound HTTP header carrying the click-scoped key. Lowercase by
/// convention.
pub const INTERACTION_HEADER: &str = "x-obs-interaction";

/// Span / log attribute key for the stamped value.
pub const INTERACTION_ATTRIBUTE: &str = "obs.interaction.id";

/// Returns true when `s` matches the wire format: 26 chars of Crockford
/// base32 (digits + A–Z minus I, L, O, U).
pub fn is_valid_interaction_id(s: &str) -> bool {
    if s.len() != 26 {
        return false;
    }
    s.chars().all(|c| {
        matches!(
            c,
            '0'..='9'
                | 'A'..='H'
                | 'J'..='K'
                | 'M'..='N'
                | 'P'..='T'
                | 'V'..='Z'
        )
    })
}

/// Trait for header carriers. Implemented for `http::HeaderMap` and any
/// `&[(impl AsRef<str>, impl AsRef<str>)]` slice (useful for testing
/// without dragging the `http` crate in as a hard dep).
pub trait HeaderCarrier {
    fn get_header(&self, name: &str) -> Option<&str>;
}

impl<K, V> HeaderCarrier for [(K, V)]
where
    K: AsRef<str>,
    V: AsRef<str>,
{
    fn get_header(&self, name: &str) -> Option<&str> {
        for (k, v) in self.iter() {
            if k.as_ref().eq_ignore_ascii_case(name) {
                return Some(v.as_ref());
            }
        }
        None
    }
}

// Optional integration with the `http` crate's HeaderMap, when present.
#[cfg(feature = "http")]
impl HeaderCarrier for http::HeaderMap {
    fn get_header(&self, name: &str) -> Option<&str> {
        self.get(name).and_then(|v| v.to_str().ok())
    }
}

/// Reads the `x-obs-interaction` header off `headers` and stamps the
/// value onto the span carried by `cx` as `obs.interaction.id`. No-op
/// when:
///
/// - the header is absent,
/// - the value is malformed,
/// - no recording span is active on the context.
pub fn stamp_interaction<H: HeaderCarrier + ?Sized>(cx: &Context, headers: &H) {
    let span = cx.span();
    if !span.span_context().is_valid() {
        return;
    }
    let Some(raw) = headers.get_header(INTERACTION_HEADER) else {
        return;
    };
    if !is_valid_interaction_id(raw) {
        return;
    }
    span.set_attribute(KeyValue::new(INTERACTION_ATTRIBUTE, raw.to_string()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_well_formed_id() {
        assert!(is_valid_interaction_id("01HZQ5W3K8M4P2X7N9B0CDEFGH"));
    }

    #[test]
    fn rejects_lowercase() {
        assert!(!is_valid_interaction_id("01hzq5w3k8m4p2x7n9b0cdefgh"));
    }

    #[test]
    fn rejects_wrong_length() {
        assert!(!is_valid_interaction_id("ABC"));
        assert!(!is_valid_interaction_id(&"A".repeat(27)));
    }

    #[test]
    fn rejects_forbidden_letters() {
        // 'I', 'L', 'O', 'U' are excluded from Crockford base32.
        assert!(!is_valid_interaction_id("I1HZQ5W3K8M4P2X7N9B0CDEFGH"));
        assert!(!is_valid_interaction_id("L1HZQ5W3K8M4P2X7N9B0CDEFGH"));
        assert!(!is_valid_interaction_id("O1HZQ5W3K8M4P2X7N9B0CDEFGH"));
        assert!(!is_valid_interaction_id("U1HZQ5W3K8M4P2X7N9B0CDEFGH"));
    }

    #[test]
    fn slice_header_carrier() {
        let headers = [("X-Obs-Interaction", "01HZQ5W3K8M4P2X7N9B0CDEFGH")];
        assert_eq!(
            headers.get_header("x-obs-interaction"),
            Some("01HZQ5W3K8M4P2X7N9B0CDEFGH"),
        );
    }
}
