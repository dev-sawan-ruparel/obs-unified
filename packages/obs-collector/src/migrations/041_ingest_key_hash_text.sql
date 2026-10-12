-- No-op on SQLite/D1: ingest_keys.key_hash has been TEXT since 009.
-- Present only to keep migration numbering in parity with
-- migrations-postgres/041_ingest_key_hash_text.sql, which converts the
-- Postgres column from BYTEA to TEXT.
SELECT 1;
