// Minimal example: init obs-unified, then use WithLLMSpan and WithToolSpan
// to instrument an agent loop.
//
// Run:
//
//	OBS_COLLECTOR_URL=http://localhost:8790 OBS_INGEST_KEY=obs_xxx \
//	  go run ./examples/basic
//
// In a real app you'd also configure HTTP / DB auto-instrumentation via
// `otelhttp.NewHandler` and per-driver wrappers (otelpgx, otelmongo, ...).
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	obs "github.com/obs-unified/obs-unified/sdks/go"
)

func main() {
	ctx := context.Background()

	shutdown, err := obs.Init(ctx, obs.Config{
		CollectorURL:   firstNonEmpty(os.Getenv("OBS_COLLECTOR_URL"), "http://localhost:8790"),
		IngestKey:      os.Getenv("OBS_INGEST_KEY"),
		ServiceName:    "example-agent",
		ServiceVersion: "0.1.0",
		Environment:    "dev",
		ProjectID:      "default",
	})
	if err != nil {
		log.Fatalf("obs.Init: %v", err)
	}
	defer shutdown(context.Background())

	// Trap SIGTERM so we flush spans before exit.
	go func() {
		c := make(chan os.Signal, 1)
		signal.Notify(c, syscall.SIGTERM, syscall.SIGINT)
		<-c
		_ = shutdown(context.Background())
		os.Exit(0)
	}()

	answer, err := obs.WithLLMSpan(ctx,
		obs.LLMOptions{
			Provider:  "openai",
			Model:     "gpt-4o-mini",
			MaxTokens: 256,
			TurnIndex: 0,
			HasTurn:   true,
		},
		func(ctx context.Context, span obs.LLMSpan) (string, error) {
			// In real code: HTTP call to OpenAI here, instrumented via otelhttp.
			fakeUsage := struct {
				PromptTokens, CompletionTokens, TotalTokens int
				FinishReason                                string
				Content                                     string
			}{42, 5, 47, "stop", "It is sunny."}
			span.SetUsage(fakeUsage.PromptTokens, fakeUsage.CompletionTokens, fakeUsage.TotalTokens)
			span.SetFinishReason(fakeUsage.FinishReason)
			return fakeUsage.Content, nil
		},
	)
	if err != nil {
		log.Printf("llm error: %v", err)
	}

	items, err := obs.WithToolSpan(ctx,
		obs.ToolOptions{Name: "list_widgets", Args: map[string]string{"color": "blue"}},
		func(ctx context.Context, span obs.ToolSpan) ([]string, error) {
			out := []string{"a", "b", "c"}
			span.SetOutcome("ok")
			span.SetResultCount(len(out))
			return out, nil
		},
	)
	if err != nil {
		log.Printf("tool error: %v", err)
	}

	log.Printf("answer=%q items=%v", answer, items)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
