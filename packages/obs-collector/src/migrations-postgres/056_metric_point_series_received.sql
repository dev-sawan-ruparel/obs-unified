-- Migration 056: metric_point (series_id, received_at) index
--
-- Mirrors ../migrations/056_metric_point_series_received.sql. Serves the
-- `metrics` alert evaluator's window and newest-point reads. Idempotent.

CREATE INDEX IF NOT EXISTS idx_metric_point_series_received
  ON metric_point (series_id, received_at);
