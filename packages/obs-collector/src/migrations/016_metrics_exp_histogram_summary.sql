-- Extend metric_point with a JSON blob for type-specific fields that don't
-- map cleanly onto columns: exponential histogram buckets (scale,
-- zeroCount, positive/negative) and summary quantileValues. Keeps the
-- schema compact without migrating whenever OTel adds a new metric type.
ALTER TABLE metric_point ADD COLUMN extra_json TEXT;
