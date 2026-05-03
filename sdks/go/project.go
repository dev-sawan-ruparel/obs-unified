package obs

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// ProjectIDAttribute is the resource/span attribute key used by obs-unified
// to scope every emission to a project (multi-tenant). Receivers on the
// collector side filter by this attribute.
const ProjectIDAttribute = "project.id"

// ProjectIDHeader is the HTTP header used to propagate project id across
// service boundaries. The receiving service should call SetProjectID early
// in its request handler.
const ProjectIDHeader = "X-Project-Id"

// SetProjectID stamps project.id on the currently active span. No-op if
// there's no active span in the context.
func SetProjectID(ctx context.Context, projectID string) {
	span := trace.SpanFromContext(ctx)
	if span.SpanContext().IsValid() {
		span.SetAttributes(attribute.String(ProjectIDAttribute, projectID))
	}
}
