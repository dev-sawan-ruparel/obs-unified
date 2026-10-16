---
"@obsunified/collector": patch
---

Fix Postgres-only 500s on `GET /internal/connected/change/:id` (invalid `SELECT DISTINCT ... ORDER BY`) and `GET /internal/usage/sessions` (ungrouped correlated subqueries). Session cookies now get `Secure` behind a trusted TLS-terminating proxy (`TRUST_PROXY` plus `X-Forwarded-Proto: https`). The bootstrap ingest key's display prefix never reveals a short key in full. Connected-rail links now carry the real entity kind and point at routes the dashboard serves (incident trigger signal, finding fault locus, tool calls, retrievals, evaluations, artifacts, AI calls).
