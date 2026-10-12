---
"@obsunified/collector": patch
---

Fix PostgreSQL retention for metric exemplars: `MetricsStore.purgeExpired()` failed with `operator does not exist: timestamp with time zone < text` because migration 035 declared `metric_exemplars.received_at`/`expires_at` as `TIMESTAMPTZ` while every other retention table (and `postgresDialect.now()`) uses ISO `TEXT`. Fresh installs now create both columns as `TEXT`, and migration 043 converts existing Postgres databases in place, preserving rows as UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` text. A numbered SQLite/D1 no-op keeps migration parity.
