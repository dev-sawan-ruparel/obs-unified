-- Migration 056: metric_point (series_id, received_at) index
--
-- `metrics` alert rules read each matching series' points by receive time:
-- the points inside the rule window, and the newest point of the series for
-- `age_seconds`. The existing (series_id, ts_ns) index orders by producer
-- time; this one serves both reads without scanning the series' history.

CREATE INDEX IF NOT EXISTS idx_metric_point_series_received
  ON metric_point (series_id, received_at);
