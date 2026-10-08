-- Drop the materialized trace instrumentation gaps table.
--
-- Trace instrumentation gaps are now computed lazily at read time from the
-- trace's spans (see `getTelemetryTraceGaps` in lib/store/trace-detail.ts),
-- rather than being materialized on the ingest hot path. The table and its
-- index are therefore unused: nothing writes to them, and reads compute gaps
-- on demand. `DROP TABLE` removes the dependent index; the explicit
-- `DROP INDEX` mirrors the D1 sibling migration.

DROP INDEX IF EXISTS idx_trace_gaps_duration;
DROP TABLE IF EXISTS trace_instrumentation_gaps;
