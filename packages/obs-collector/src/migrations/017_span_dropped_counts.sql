-- OTLP span-level passthrough columns.
--
-- Matches RFC 0001 schema-conformance bar: droppedAttributesCount,
-- droppedEventsCount, droppedLinksCount, and W3C traceState must survive the
-- receiver end-to-end. Event/link-level dropped counts live inside
-- events_json / links_json already.

ALTER TABLE telemetry_spans ADD COLUMN trace_state TEXT;
ALTER TABLE telemetry_spans ADD COLUMN dropped_attributes_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry_spans ADD COLUMN dropped_events_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telemetry_spans ADD COLUMN dropped_links_count INTEGER NOT NULL DEFAULT 0;
