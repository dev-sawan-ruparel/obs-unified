-- Convert metric_exemplars.received_at / expires_at from TIMESTAMPTZ to TEXT
-- on databases migrated with the original Postgres 035.
--
-- Every other retention table stores timestamps as TEXT holding
-- Date#toISOString() output, and postgresDialect renders now() as ISO text
-- (to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')). Against TIMESTAMPTZ
-- columns MetricsStore.purgeExpired failed with
--   operator does not exist: timestamp with time zone < text
-- so metric exemplars were never purged on Postgres.
--
-- Existing rows are preserved: each value is rendered in UTC in the exact
-- shape the collector writes (millisecond precision, trailing "Z"), so the
-- converted text compares correctly against freshly ingested rows and the
-- dialect's now(). idx_metric_exemplars_expires is rebuilt by Postgres as
-- part of the type change.
--
-- Fresh installs already create both columns as TEXT in 035 and this is a
-- no-op. Re-running is also a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'metric_exemplars'
      AND column_name = 'received_at'
      AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE metric_exemplars
      ALTER COLUMN received_at TYPE TEXT
      USING to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'metric_exemplars'
      AND column_name = 'expires_at'
      AND data_type = 'timestamp with time zone'
  ) THEN
    ALTER TABLE metric_exemplars
      ALTER COLUMN expires_at TYPE TEXT
      USING to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  END IF;
END
$$;
