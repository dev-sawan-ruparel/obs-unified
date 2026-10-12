---
"@obsunified/collector": patch
---

Fix PostgreSQL compatibility for the standalone Node collector: `PostgresAdapter.bind()` now returns a new statement (batched AI ingest previously stored only the last row), SQLite time windows and analysis built-ins (`datetime`, `strftime`, `julianday`, `json_object`, scalar `MAX`/`MIN`, `ROUND`) are translated for TEXT timestamp columns, camelCase aliases are restored on result rows, BOOLEAN flags are queried portably (`SUM(CASE WHEN is_error …)`), and `configurePostgresTypeParsers()` returns D1-shaped values (0/1 flags, numbers, JSON text). Migration 041 converts `ingest_keys.key_hash` from BYTEA to TEXT so hex-digest lookups match.
