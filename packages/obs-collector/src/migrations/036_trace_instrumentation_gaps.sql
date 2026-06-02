-- SQLite/D1 migration 036_trace_instrumentation_gaps.sql
-- Computes and persists uninstrumented trace gaps during span ingestion.

CREATE TABLE IF NOT EXISTS trace_instrumentation_gaps (
  trace_id TEXT NOT NULL,
  parent_span_id TEXT NOT NULL,
  parent_service_name TEXT NOT NULL,
  parent_span_name TEXT NOT NULL,
  offset_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ratio_of_parent REAL NOT NULL,
  child_span_count INTEGER NOT NULL,
  async_parent INTEGER NOT NULL, -- 0/1 boolean (async parent gap)
  recommendation TEXT NOT NULL,
  PRIMARY KEY (trace_id, parent_span_id)
);

CREATE INDEX IF NOT EXISTS idx_trace_gaps_duration 
  ON trace_instrumentation_gaps (duration_ms DESC);
