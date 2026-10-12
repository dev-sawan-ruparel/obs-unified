-- Convert ingest_keys.key_hash from BYTEA to TEXT on databases migrated
-- before 009 was corrected.
--
-- ProjectsStore binds the SHA-256 digest as a hex string. Against a BYTEA
-- column Postgres parsed that string as escape-format bytes, so:
--   * keys created by the collector (bootstrap INGEST_KEY, minted keys)
--     were stored as the 64 ASCII bytes of the hex text;
--   * the obs-dashboard seed in 026 used decode(..., 'hex') and stored the
--     32 raw digest bytes, which never matched a lookup.
-- Both shapes are mapped back to the 64-char lowercase hex digest here.
-- Fresh installs already create the column as TEXT and this is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ingest_keys'
      AND column_name = 'key_hash'
      AND data_type = 'bytea'
  ) THEN
    ALTER TABLE ingest_keys
      ALTER COLUMN key_hash TYPE TEXT
      USING (
        CASE
          WHEN octet_length(key_hash) = 32 THEN encode(key_hash, 'hex')
          ELSE convert_from(key_hash, 'UTF8')
        END
      );
  END IF;
END
$$;
