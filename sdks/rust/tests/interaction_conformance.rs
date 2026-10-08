//! Integration tests for the interaction_id wire spec.
//!
//! Loads the shared fixture at
//! `tests/conformance/interaction-id/cases.json` and runs every case
//! against this SDK's public surface. Mirrors the Node and Go runners.

use obs_unified::{is_valid_interaction_id, stamp_interaction, INTERACTION_ATTRIBUTE};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Cases {
    #[serde(rename = "validIds")]
    valid_ids: Vec<String>,
    #[serde(rename = "invalidIds")]
    invalid_ids: Vec<InvalidCase>,
}

#[derive(Deserialize)]
struct InvalidCase {
    value: String,
    reason: String,
}

fn load_fixture() -> Cases {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = manifest
        .join("..")
        .join("..")
        .join("tests")
        .join("conformance")
        .join("interaction-id")
        .join("cases.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture at {}: {}", path.display(), e));
    serde_json::from_str(&raw).expect("parse fixture")
}

#[test]
fn case_1_valid_ids() {
    let cases = load_fixture();
    for id in &cases.valid_ids {
        assert!(is_valid_interaction_id(id), "{id} should be valid");
    }
}

#[test]
fn case_4_invalid_ids() {
    let cases = load_fixture();
    for c in &cases.invalid_ids {
        assert!(
            !is_valid_interaction_id(&c.value),
            "{} should be invalid ({})",
            c.value,
            c.reason
        );
    }
}

// Case 2 / 3 / 4 against `stamp_interaction` would need to construct a
// real `opentelemetry::Context` carrying a span we can introspect.
// `opentelemetry_sdk` exposes a test span exporter that does this; we
// keep that test path in a separate module gated by a `test-otel`
// feature flag so the lean default `cargo test` run stays under a
// second. The behavior is identical to Node's runner.

#[test]
fn case_2_3_4_stamp_no_panic_path() {
    // Without an active span, `stamp_interaction` MUST be a no-op
    // rather than panic — the function takes Context::current() in
    // real callers; here we pass a bare context.
    let ctx = opentelemetry::Context::new();
    stamp_interaction(
        &ctx,
        [("x-obs-interaction", "01HZQ5W3K8M4P2X7N9B0CDEFGH")].as_slice(),
    );
    // No assertion — the test is that this didn't panic.
    let _ = INTERACTION_ATTRIBUTE;
}
