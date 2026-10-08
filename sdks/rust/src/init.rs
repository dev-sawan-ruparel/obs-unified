//! Initialization for obs-unified.
//!
//! Configures OpenTelemetry's trace and log providers with OTLP/HTTP
//! exporters pointed at an obs-unified collector. Returns a guard that
//! shuts the providers down when dropped, so traces flush before exit.
//!
//! Auto-instrumentation for HTTP / DB / RPC comes from the OTel
//! ecosystem — wire `tower-http`, `tracing-opentelemetry`, or per-driver
//! crates as needed.

use std::collections::HashMap;
use std::time::Duration;

use opentelemetry::{global, KeyValue};
use opentelemetry_otlp::{LogExporter, SpanExporter, WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::logs::{BatchLogProcessor, LoggerProvider};
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{Sampler, TracerProvider};
use opentelemetry_sdk::{runtime, Resource};
use opentelemetry_semantic_conventions::resource as semres;

use crate::Error;

/// Config for [`init`].
#[derive(Clone, Debug)]
pub struct Config {
    /// Base URL of your obs-unified collector (no trailing slash).
    pub collector_url: String,
    /// Project ingest key. Sent as `Authorization: Bearer ...`.
    pub ingest_key: String,
    /// Service name surfaced in the dashboard's service list.
    pub service_name: String,
    /// Optional service version.
    pub service_version: Option<String>,
    /// Optional deployment environment, e.g. `"production"`.
    pub environment: Option<String>,
    /// Optional default project id. Stamped as a resource attribute.
    pub project_id: Option<String>,
    /// Extra resource attributes merged onto every emission.
    pub resource_attributes: HashMap<String, String>,
    /// Tail sampling ratio in [0, 1]. Defaults to 1.0.
    pub sample_ratio: f64,
    /// Set true only if this service ingests its own telemetry through
    /// the same collector. Adds `X-Telemetry-Self: 1` so the collector's
    /// request middleware short-circuits and avoids an export loop.
    pub self_telemetry: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            collector_url: String::new(),
            ingest_key: String::new(),
            service_name: String::new(),
            service_version: None,
            environment: None,
            project_id: None,
            resource_attributes: HashMap::new(),
            sample_ratio: 1.0,
            self_telemetry: false,
        }
    }
}

/// Drop-guard that shuts down the trace + log providers on drop.
/// Hold onto this until `main` exits.
pub struct ObsGuard {
    tracer_provider: TracerProvider,
    logger_provider: LoggerProvider,
}

impl Drop for ObsGuard {
    fn drop(&mut self) {
        let _ = self.tracer_provider.shutdown();
        let _ = self.logger_provider.shutdown();
    }
}

/// Initialize obs-unified. Returns an [`ObsGuard`] — keep it alive for the
/// lifetime of your program so spans / logs flush on drop.
///
/// Must be called from inside a tokio runtime (the OTLP exporter uses
/// `runtime::Tokio`).
pub fn init(cfg: Config) -> Result<ObsGuard, Error> {
    if cfg.collector_url.is_empty() {
        return Err(Error::ConfigMissing("collector_url"));
    }
    if cfg.service_name.is_empty() {
        return Err(Error::ConfigMissing("service_name"));
    }

    let endpoint = cfg.collector_url.trim_end_matches('/').to_string();
    let mut headers = HashMap::new();
    if !cfg.ingest_key.is_empty() {
        headers.insert(
            "Authorization".to_string(),
            format!("Bearer {}", cfg.ingest_key),
        );
    }
    if cfg.self_telemetry {
        headers.insert("X-Telemetry-Self".to_string(), "1".to_string());
    }

    let span_exporter = SpanExporter::builder()
        .with_http()
        .with_endpoint(format!("{endpoint}/v1/traces"))
        .with_headers(headers.clone())
        .with_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| Error::Exporter(e.to_string()))?;

    let log_exporter = LogExporter::builder()
        .with_http()
        .with_endpoint(format!("{endpoint}/v1/logs"))
        .with_headers(headers)
        .with_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| Error::Exporter(e.to_string()))?;

    let resource = build_resource(&cfg);

    let sampler = if (0.0..1.0).contains(&cfg.sample_ratio) {
        Sampler::TraceIdRatioBased(cfg.sample_ratio)
    } else {
        Sampler::AlwaysOn
    };

    let tracer_provider = TracerProvider::builder()
        .with_resource(resource.clone())
        .with_sampler(sampler)
        .with_batch_exporter(span_exporter, runtime::Tokio)
        .build();
    global::set_tracer_provider(tracer_provider.clone());
    global::set_text_map_propagator(TraceContextPropagator::new());

    let logger_provider = LoggerProvider::builder()
        .with_resource(resource)
        .with_log_processor(BatchLogProcessor::builder(log_exporter, runtime::Tokio).build())
        .build();

    Ok(ObsGuard {
        tracer_provider,
        logger_provider,
    })
}

fn build_resource(cfg: &Config) -> Resource {
    let mut attrs: Vec<KeyValue> = vec![KeyValue::new(
        semres::SERVICE_NAME,
        cfg.service_name.clone(),
    )];
    if let Some(v) = cfg.service_version.as_ref() {
        attrs.push(KeyValue::new(semres::SERVICE_VERSION, v.clone()));
    }
    if let Some(env) = cfg.environment.as_ref() {
        attrs.push(KeyValue::new("deployment.environment", env.clone()));
    }
    if let Some(pid) = cfg.project_id.as_ref() {
        attrs.push(KeyValue::new(
            crate::project::PROJECT_ID_ATTRIBUTE,
            pid.clone(),
        ));
    }
    for (k, v) in &cfg.resource_attributes {
        attrs.push(KeyValue::new(k.clone(), v.clone()));
    }
    Resource::new(attrs)
}
