# obs-unified Go SDK

Thin OpenTelemetry SDK wrapper for obs-unified. One-line init, OpenInference
LLM/tool helpers, and project propagation. The OTel ecosystem provides
HTTP/DB/RPC instrumentation; this package adds what OTel doesn't ship out of the
box.

## Install

```sh
go get github.com/obs-unified/obs-unified/sdks/go@latest
```

## Quickstart

```go
package main

import (
    "context"
    "log"
    "net/http"
    "os"

    obs "github.com/obs-unified/obs-unified/sdks/go"
    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

func main() {
    ctx := context.Background()
    shutdown, err := obs.Init(ctx, obs.Config{
        CollectorURL:   os.Getenv("OBS_COLLECTOR_URL"),
        IngestKey:      os.Getenv("OBS_INGEST_KEY"),
        ServiceName:    "my-service",
        ServiceVersion: "1.4.2",
        Environment:    "production",
        ProjectID:      "default",
    })
    if err != nil { log.Fatal(err) }
    defer shutdown(context.Background())

    handler := otelhttp.NewHandler(http.HandlerFunc(myHandler), "POST /api/foo")
    log.Fatal(http.ListenAndServe(":8080", handler))
}
```

`otelhttp` gives you HTTP server + outbound spans. For DB clients, use the
matching `otel*` package (`otelpgx`, `otelmongo`, etc.) — same pattern.

## LLM call instrumentation

```go
import obs "github.com/obs-unified/obs-unified/sdks/go"

response, err := obs.WithLLMSpan(ctx,
    obs.LLMOptions{
        Provider: "openai", Model: "gpt-4o-mini",
        MaxTokens: 1024, TurnIndex: i, HasTurn: true,
    },
    func(ctx context.Context, span obs.LLMSpan) (*OpenAIResponse, error) {
        resp, err := openaiClient.Chat(ctx, req) // otelhttp will trace the HTTP child
        if err != nil { return nil, err }
        span.SetUsage(resp.Usage.PromptTokens, resp.Usage.CompletionTokens, resp.Usage.TotalTokens)
        span.SetFinishReason(resp.Choices[0].FinishReason)
        return resp, nil
    },
)
```

The wrap stamps `openinference.span.kind=LLM`, `gen_ai.system`,
`gen_ai.request.model`, and post-call `gen_ai.usage.*` attributes.

## Agent tool dispatch

```go
result, err := obs.WithToolSpan(ctx,
    obs.ToolOptions{Name: "list_widgets", Args: parsedArgs},
    func(ctx context.Context, span obs.ToolSpan) (*ToolResult, error) {
        out, err := dispatch(ctx, parsedArgs)
        if err != nil { span.SetOutcome("error"); return nil, err }
        span.SetOutcome("ok")
        span.SetResultCount(len(out.Items))
        return out, nil
    },
)
```

## Project-id propagation

```go
// Static default (resource attribute, applied to every emission)
obs.Init(ctx, obs.Config{..., ProjectID: "tenant-acme"})

// Per-request (after auth resolves the project)
func handler(w http.ResponseWriter, r *http.Request) {
    projectID := resolveProjectFromAuth(r)
    obs.SetProjectID(r.Context(), projectID)
    // ... rest of handler ...
}
```

For service-to-service propagation, set the `obs.ProjectIDHeader` header on
outbound requests. The receiver reads it and calls `obs.SetProjectID` in its
handler.

## Custom logical boundaries

For business operations worth naming in the trace, use the standard OTel tracer:

```go
import "go.opentelemetry.io/otel"

ctx, span := otel.Tracer("my-service").Start(ctx, "orders.fulfill")
span.SetAttributes(
    attribute.String("order.id", orderID),
    attribute.String("order.region", region),
)
defer span.End()
return fulfillOrder(ctx, orderID)
```

## Self-monitoring (rare)

If your service ingests its own telemetry through the same collector, set
`SelfTelemetry: true` in `Config`. Every export will carry `X-Telemetry-Self: 1`
so the collector's request middleware short-circuits and avoids an export loop.
See
[`apps/collector/SELF_INSTRUMENTATION.md`](../../apps/collector/SELF_INSTRUMENTATION.md).

## Caveats

- **Generic auto-instrumentation in Go is limited** vs Python/Java — Go's static
  linking means there's no monkey-patching. You explicitly wrap your HTTP/DB/RPC
  clients with the matching `otel*` packages.
- **Continuous profiling and tracing complement each other.** This package
  handles tracing; for CPU profiling, use Pyroscope, Datadog Continuous
  Profiler, or the Go runtime's `net/http/pprof`.
