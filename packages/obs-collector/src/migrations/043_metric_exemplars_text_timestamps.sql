-- No-op on SQLite/D1: metric_exemplars.received_at and expires_at have been
-- TEXT since 035. Present only to keep migration numbering in parity with
-- migrations-postgres/043_metric_exemplars_text_timestamps.sql, which
-- converts the Postgres columns from TIMESTAMPTZ to ISO TEXT.
SELECT 1;
