// Package obs is a thin OpenTelemetry SDK wrapper for obs-unified.
//
// One-line init that points the OTel SDK at your collector, OpenInference
// helpers for LLM and tool spans, and project-id propagation. The OTel
// ecosystem provides HTTP / DB / RPC instrumentation; this package only
// adds what OTel doesn't ship out of the box.
package obs

import (
	"context"
	"fmt"
	"strings"

	"go.opentelemetry.io/otel"
	otlploghttp "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	otlptracehttp "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/log"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// Config holds the parameters for Init.
type Config struct {
	// CollectorURL is the base URL of your obs-unified collector
	// (no trailing slash). The exporter posts to ${CollectorURL}/v1/traces
	// and ${CollectorURL}/v1/logs.
	CollectorURL string

	// IngestKey is your project's ingest key. Sent as Authorization: Bearer.
	IngestKey string

	// ServiceName is surfaced in the dashboard's service list.
	ServiceName string

	// ServiceVersion is optional.
	ServiceVersion string

	// Environment is optional, e.g. "production".
	Environment string

	// ProjectID, when set, is stamped as a resource attribute on every
	// emission. For per-request project resolution, use SetProjectID
	// from inside the request handler instead.
	ProjectID string

	// ResourceAttributes are merged onto every emitted span/log.
	ResourceAttributes map[string]string

	// SampleRatio is in [0, 1]. Defaults to 1.0 (sample everything).
	SampleRatio float64

	// SelfTelemetry stamps X-Telemetry-Self: 1 on every export when true.
	// Only set this if your service ingests its own telemetry through the
	// same collector — it tells the collector to short-circuit
	// instrumentation for self-emitted requests so you don't loop.
	SelfTelemetry bool
}

// Shutdown drains pending spans/logs and tears down the providers.
// Call from your SIGTERM handler so traces flush before the process exits.
type Shutdown func(ctx context.Context) error

// Init configures the OTel global tracer + logger providers for obs-unified.
// Returns a shutdown function that should be deferred at the call site.
//
//	shutdown, err := obs.Init(ctx, obs.Config{...})
//	if err != nil { log.Fatal(err) }
//	defer shutdown(context.Background())
func Init(ctx context.Context, cfg Config) (Shutdown, error) {
	if cfg.CollectorURL == "" {
		return nil, fmt.Errorf("obs.Init: CollectorURL is required")
	}
	if cfg.ServiceName == "" {
		return nil, fmt.Errorf("obs.Init: ServiceName is required")
	}

	endpoint := strings.TrimSuffix(cfg.CollectorURL, "/")
	headers := map[string]string{}
	if cfg.IngestKey != "" {
		headers["Authorization"] = "Bearer " + cfg.IngestKey
	}
	if cfg.SelfTelemetry {
		headers["X-Telemetry-Self"] = "1"
	}

	traceExp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"),
		otlptracehttp.WithHeaders(headers),
	)
	if err != nil {
		return nil, fmt.Errorf("obs.Init: trace exporter: %w", err)
	}

	logExp, err := otlploghttp.New(ctx,
		otlploghttp.WithEndpointURL(endpoint+"/v1/logs"),
		otlploghttp.WithHeaders(headers),
	)
	if err != nil {
		return nil, fmt.Errorf("obs.Init: log exporter: %w", err)
	}

	res, err := buildResource(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("obs.Init: resource: %w", err)
	}

	sampler := sdktrace.AlwaysSample()
	if cfg.SampleRatio > 0 && cfg.SampleRatio < 1 {
		sampler = sdktrace.TraceIDRatioBased(cfg.SampleRatio)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	lp := log.NewLoggerProvider(
		log.WithProcessor(log.NewBatchProcessor(logExp)),
		log.WithResource(res),
	)
	// Note: there's no global logger setter in OTel Go yet (as of v0.8).
	// Stash it on a package-level holder so callers can fetch it.
	loggerProvider = lp

	return func(ctx context.Context) error {
		var firstErr error
		if err := tp.Shutdown(ctx); err != nil {
			firstErr = err
		}
		if err := lp.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
		return firstErr
	}, nil
}

// LoggerProvider returns the obs-unified-configured log provider so you can
// register it with your logging library's OTel bridge (e.g. otelslog).
func LoggerProvider() any { return loggerProvider }

var loggerProvider *log.LoggerProvider

func buildResource(ctx context.Context, cfg Config) (*resource.Resource, error) {
	attrs := []any{semconv.ServiceName(cfg.ServiceName)}
	if cfg.ServiceVersion != "" {
		attrs = append(attrs, semconv.ServiceVersion(cfg.ServiceVersion))
	}
	if cfg.Environment != "" {
		attrs = append(attrs, semconv.DeploymentEnvironmentName(cfg.Environment))
	}

	// Convert []any to []attribute.KeyValue via the resource builder.
	base := resource.NewWithAttributes(semconv.SchemaURL, toKeyValues(attrs)...)

	extras := make([]attrKV, 0, len(cfg.ResourceAttributes)+1)
	if cfg.ProjectID != "" {
		extras = append(extras, attrKV{Key: ProjectIDAttribute, Value: cfg.ProjectID})
	}
	for k, v := range cfg.ResourceAttributes {
		extras = append(extras, attrKV{Key: k, Value: v})
	}
	if len(extras) == 0 {
		return base, nil
	}
	extraRes := resource.NewSchemaless(toKeyValuesFromExtras(extras)...)
	return resource.Merge(base, extraRes)
}
