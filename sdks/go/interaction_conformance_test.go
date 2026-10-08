package obs

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

type conformanceCases struct {
	ValidIDs   []string `json:"validIds"`
	InvalidIDs []struct {
		Value  string `json:"value"`
		Reason string `json:"reason"`
	} `json:"invalidIds"`
}

func loadFixture(t *testing.T) conformanceCases {
	t.Helper()
	// Walk up to repo root.
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(wd, "..", "..", "tests", "conformance", "interaction-id", "cases.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var c conformanceCases
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func newRecordingTracer() (trace.TracerProvider, *tracetest.SpanRecorder) {
	r := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(r))
	return tp, r
}

func TestInteractionIDConformance_Case1_ValidIDs(t *testing.T) {
	cases := loadFixture(t)
	for _, id := range cases.ValidIDs {
		if !IsValidInteractionID(id) {
			t.Errorf("expected %q to be valid", id)
		}
	}
}

func TestInteractionIDConformance_Case4_InvalidIDs(t *testing.T) {
	cases := loadFixture(t)
	for _, c := range cases.InvalidIDs {
		if IsValidInteractionID(c.Value) {
			t.Errorf("expected %q to be invalid (%s)", c.Value, c.Reason)
		}
	}
}

func TestInteractionIDConformance_Case2_HeaderRoundTrip(t *testing.T) {
	cases := loadFixture(t)
	tp, recorder := newRecordingTracer()
	tracer := tp.Tracer("test")
	ctx, span := tracer.Start(context.Background(), "req")
	defer span.End()

	id := cases.ValidIDs[0]
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set(InteractionHeader, id)

	StampInteraction(ctx, req)
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(spans))
	}
	found := false
	for _, attr := range spans[0].Attributes() {
		if string(attr.Key) == InteractionAttribute {
			if attr.Value.AsString() != id {
				t.Errorf("attribute value: got %q want %q", attr.Value.AsString(), id)
			}
			found = true
		}
	}
	if !found {
		t.Errorf("expected %s attribute on span", InteractionAttribute)
	}
}

func TestInteractionIDConformance_Case3_AbsentHeader(t *testing.T) {
	tp, recorder := newRecordingTracer()
	tracer := tp.Tracer("test")
	ctx, span := tracer.Start(context.Background(), "req")
	req := httptest.NewRequest("GET", "/", nil) // no header

	StampInteraction(ctx, req)
	span.End()

	spans := recorder.Ended()
	for _, attr := range spans[0].Attributes() {
		if string(attr.Key) == InteractionAttribute {
			t.Errorf("absent header should not stamp attribute")
		}
	}
}

func TestInteractionIDConformance_Case4_MalformedHeader(t *testing.T) {
	cases := loadFixture(t)
	for _, c := range cases.InvalidIDs {
		tp, recorder := newRecordingTracer()
		tracer := tp.Tracer("test")
		ctx, span := tracer.Start(context.Background(), "req")
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set(InteractionHeader, c.Value)

		StampInteraction(ctx, req)
		span.End()

		spans := recorder.Ended()
		for _, attr := range spans[0].Attributes() {
			if string(attr.Key) == InteractionAttribute {
				t.Errorf("malformed value %q (%s) should not stamp", c.Value, c.Reason)
			}
		}
	}
}
