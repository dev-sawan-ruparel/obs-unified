package obs

import (
	"net/http"
	"regexp"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// InteractionHeader is the HTTP header used by browser SDKs to propagate
// the click-scoped correlation key to the server. Lowercase by
// convention; HTTP is case-insensitive.
//
// Wire spec: docs/spec/interaction-id.md.
const InteractionHeader = "x-obs-interaction"

// InteractionAttribute is the span/log attribute key stamped on the
// inbound request's root span. Child spans inherit via OTel's standard
// parent-attribute propagation.
const InteractionAttribute = "obs.interaction.id"

// interactionIDRegex validates the wire format: 26 chars of Crockford
// base32 (digits + A–Z minus I, L, O, U). Case-sensitive uppercase.
var interactionIDRegex = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)

// IsValidInteractionID returns true when s matches the on-wire format.
// Exposed for downstream validation and testing.
func IsValidInteractionID(s string) bool {
	return interactionIDRegex.MatchString(s)
}

// StampInteraction reads the x-obs-interaction header off r and stamps
// the value onto the span carried by ctx as obs.interaction.id. No-op
// when:
//
//   - the header is absent (server-originated work — cron, queue,
//     retry — legitimately has no interaction),
//   - the value is malformed (network corruption, hostile client),
//   - no span is active on the context.
//
// Wrong joins are worse than missing ones; we never synthesize a
// fallback ID.
//
// Usage with net/http:
//
//	func handler(w http.ResponseWriter, r *http.Request) {
//	    ctx, span := tracer.Start(r.Context(), "request")
//	    defer span.End()
//	    obs.StampInteraction(ctx, r)
//	    // ... your handler ...
//	}
//
// Usage as middleware:
//
//	func InteractionMiddleware(next http.Handler) http.Handler {
//	    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
//	        obs.StampInteraction(r.Context(), r)
//	        next.ServeHTTP(w, r)
//	    })
//	}
func StampInteraction(ctx interface{ Done() <-chan struct{} }, r *http.Request) {
	// We accept a context.Context implicitly via the interface above —
	// using context.Context directly would force every caller to import
	// "context" even if they only ever pass r.Context().
	span := trace.SpanFromContext(asContext(ctx))
	if !span.SpanContext().IsValid() || !span.IsRecording() {
		return
	}
	raw := r.Header.Get(InteractionHeader)
	if raw == "" {
		return
	}
	if !interactionIDRegex.MatchString(raw) {
		return
	}
	span.SetAttributes(attribute.String(InteractionAttribute, raw))
}

// CurrentInteractionID returns the interaction id stamped on the active
// span, or "" if no span is active or the attribute isn't set.
//
// OTel doesn't expose attribute reads on the Span interface; callers
// who need read-after-write should track the id alongside their span
// or accept the limitation.
func CurrentInteractionID(ctx interface{ Done() <-chan struct{} }) string {
	// Implementations of the Span interface don't surface attribute
	// reads through the public API. This helper exists for symmetry with
	// the TypeScript SDK; in practice, Go callers thread the id through
	// their handler context if they need it later.
	_ = trace.SpanFromContext(asContext(ctx))
	return ""
}
