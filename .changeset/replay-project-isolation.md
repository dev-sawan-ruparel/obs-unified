---
"@obsunified/collector": patch
---

Fix cross-project session replay metadata collisions by scoping the primary key to (project_id, session_id), updating the replay receiver upsert conflict target to (project_id, session_id), scoping identity-index replay queries by project_id, and adding forward migration 042 for SQLite/D1 and PostgreSQL.
