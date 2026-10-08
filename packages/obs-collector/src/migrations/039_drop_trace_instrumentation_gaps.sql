-- Drop the materialized trace instrumentation gaps table.
--
-- Trace instrumentation gaps are now computed lazily at read time from the
-- trace's spans (see `getTelemetryTraceGaps` in lib/store/trace-detail.ts),
-- rather than being materialized on the ingest hot path. The table and its
-- index are therefore unused: nothing writes to them, and reads compute gaps
-- on demand. Dropping the index first is redundant on SQLite (DROP TABLE
-- removes it) but kept explicit for clarity and Postgres parity.

DROP INDEX IF EXISTS idx_trace_gaps_duration;
DROP TABLE IF EXISTS trace_instrumentation_gaps;
