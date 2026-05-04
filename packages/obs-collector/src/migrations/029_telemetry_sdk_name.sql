-- RFC 0009 Phase 5.3 — denormalize telemetry.sdk.name onto telemetry_spans.
--
-- The service map dashboard wants a "show me only Beyla-derived edges"
-- filter. Doing that with json_extract on resource_attributes_json on
-- every aggregation row is too slow (no index possible on JSON paths
-- in D1). Denormalize at ingest into a top-level column with a partial
-- index — partial because most spans will continue to come from
-- regular SDKs and don't need the index entry.
--
-- Populated by default-span-enrichment from
-- resource_attributes['telemetry.sdk.name']. NULL when the producer
-- didn't set it (older SDKs); the service-map filter treats NULL as
-- "sdk-derived" (the conservative default) so existing edges keep
-- rendering when "sdk" is selected.

ALTER TABLE telemetry_spans ADD COLUMN telemetry_sdk_name TEXT;

CREATE INDEX IF NOT EXISTS idx_spans_sdk_name
  ON telemetry_spans (project_id, telemetry_sdk_name, received_at DESC)
  WHERE telemetry_sdk_name IS NOT NULL;
