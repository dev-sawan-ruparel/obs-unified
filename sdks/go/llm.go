package obs

import (
	"context"
	"encoding/json"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "github.com/obs-unified/obs-unified/sdks/go"

func tracer() trace.Tracer { return otel.Tracer(tracerName) }

// ── LLM spans ─────────────────────────────────────────────────────────────

// LLMOptions configures a WithLLMSpan call. Stamps the span with
// OpenInference attributes the dashboard's AI tab reads.
type LLMOptions struct {
	// Provider, e.g. "openai" / "anthropic". Stamped as gen_ai.system.
	Provider string

	// Model id, e.g. "gpt-4o-mini". Stamped as gen_ai.request.model.
	Model string

	// MaxTokens is optional; stamped as gen_ai.request.max_tokens.
	MaxTokens int

	// SystemMessage is optional, captured for trace replay (truncated).
	SystemMessage string

	// TurnIndex is optional; stamped as llm.turn for agent loops.
	TurnIndex int
	HasTurn   bool

	// Attributes are merged onto the span before fn runs.
	Attributes map[string]string
}

// LLMSpan exposes post-call attribute setters. The OTel span is also
// available as Span() for advanced cases.
type LLMSpan struct {
	span trace.Span
}

// Span returns the underlying OTel span.
func (s LLMSpan) Span() trace.Span { return s.span }

// SetUsage stamps gen_ai.usage.input_tokens / output_tokens / total_tokens.
// Pass 0 for fields you don't want stamped.
func (s LLMSpan) SetUsage(inputTokens, outputTokens, totalTokens int) {
	if inputTokens > 0 {
		s.span.SetAttributes(attribute.Int("gen_ai.usage.input_tokens", inputTokens))
	}
	if outputTokens > 0 {
		s.span.SetAttributes(attribute.Int("gen_ai.usage.output_tokens", outputTokens))
	}
	if totalTokens > 0 {
		s.span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", totalTokens))
	}
}

// SetFinishReason stamps gen_ai.response.finish_reason.
func (s LLMSpan) SetFinishReason(reason string) {
	s.span.SetAttributes(attribute.String("gen_ai.response.finish_reason", reason))
}

// SetResponseModel stamps gen_ai.response.model when the response model
// differs from the request model.
func (s LLMSpan) SetResponseModel(model string) {
	s.span.SetAttributes(attribute.String("gen_ai.response.model", model))
}

// SetAttribute is a pass-through for the underlying span.
func (s LLMSpan) SetAttribute(key string, value any) {
	s.span.SetAttributes(toAttr(key, value))
}

// WithLLMSpan wraps fn in a span named "llm.<provider>.chat" with
// OpenInference attributes. Pass post-call usage info via the LLMSpan
// passed to fn.
func WithLLMSpan[T any](
	ctx context.Context,
	opts LLMOptions,
	fn func(ctx context.Context, span LLMSpan) (T, error),
) (T, error) {
	ctx, otelSpan := tracer().Start(ctx, "llm."+opts.Provider+".chat",
		trace.WithSpanKind(trace.SpanKindClient),
	)
	otelSpan.SetAttributes(
		attribute.String("openinference.span.kind", "LLM"),
		attribute.String("gen_ai.system", opts.Provider),
		attribute.String("gen_ai.request.model", opts.Model),
	)
	if opts.MaxTokens > 0 {
		otelSpan.SetAttributes(attribute.Int("gen_ai.request.max_tokens", opts.MaxTokens))
	}
	if opts.SystemMessage != "" {
		otelSpan.SetAttributes(attribute.String("gen_ai.system_message", truncate(opts.SystemMessage, 1024)))
	}
	if opts.HasTurn {
		otelSpan.SetAttributes(attribute.Int("llm.turn", opts.TurnIndex))
	}
	for k, v := range opts.Attributes {
		otelSpan.SetAttributes(attribute.String(k, v))
	}

	result, err := fn(ctx, LLMSpan{span: otelSpan})
	if err != nil {
		otelSpan.RecordError(err)
		otelSpan.SetStatus(codes.Error, err.Error())
	} else {
		otelSpan.SetStatus(codes.Ok, "")
	}
	otelSpan.End()
	return result, err
}

// ── Tool spans (agent loop dispatch) ──────────────────────────────────────

// ToolOptions configures a WithToolSpan call.
type ToolOptions struct {
	// Name of the tool, e.g. "list_widgets". Span name becomes "tool.<Name>".
	Name string

	// Args is JSON-stringified and truncated to 512 chars.
	Args any

	// Attributes are merged onto the span before fn runs.
	Attributes map[string]string
}

// ToolSpan exposes setters used after the dispatch returns.
type ToolSpan struct {
	span trace.Span
}

// Span returns the underlying OTel span.
func (s ToolSpan) Span() trace.Span { return s.span }

// SetOutcome stamps tool.outcome — "ok", "error", "not_found", etc.
func (s ToolSpan) SetOutcome(outcome string) {
	s.span.SetAttributes(attribute.String("tool.outcome", outcome))
}

// SetResultCount stamps tool.result_count for list-shaped tools.
func (s ToolSpan) SetResultCount(count int) {
	s.span.SetAttributes(attribute.Int("tool.result_count", count))
}

// SetAttribute is a pass-through.
func (s ToolSpan) SetAttribute(key string, value any) {
	s.span.SetAttributes(toAttr(key, value))
}

// WithToolSpan wraps fn in a span named "tool.<name>" with OpenInference
// attributes.
func WithToolSpan[T any](
	ctx context.Context,
	opts ToolOptions,
	fn func(ctx context.Context, span ToolSpan) (T, error),
) (T, error) {
	ctx, otelSpan := tracer().Start(ctx, "tool."+opts.Name,
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	otelSpan.SetAttributes(
		attribute.String("openinference.span.kind", "TOOL"),
		attribute.String("tool.name", opts.Name),
	)
	if opts.Args != nil {
		if b, err := json.Marshal(opts.Args); err == nil {
			otelSpan.SetAttributes(attribute.String("tool.args", truncate(string(b), 512)))
		}
	}
	for k, v := range opts.Attributes {
		otelSpan.SetAttributes(attribute.String(k, v))
	}

	result, err := fn(ctx, ToolSpan{span: otelSpan})
	if err != nil {
		otelSpan.RecordError(err)
		otelSpan.SetStatus(codes.Error, err.Error())
	} else {
		otelSpan.SetStatus(codes.Ok, "")
	}
	otelSpan.End()
	return result, err
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}

func toAttr(key string, value any) attribute.KeyValue {
	switch v := value.(type) {
	case string:
		return attribute.String(key, v)
	case bool:
		return attribute.Bool(key, v)
	case int:
		return attribute.Int(key, v)
	case int64:
		return attribute.Int64(key, v)
	case float64:
		return attribute.Float64(key, v)
	default:
		return attribute.String(key, "")
	}
}
