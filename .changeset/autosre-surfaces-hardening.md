---
"@obsunified/mcp-server": minor
"@obsunified/dashboard": patch
"@obsunified/collector": patch
"@obsunified/cli": patch
---

Harden the AutoSRE surfaces.

- MCP server: the three write tools (`record_investigation_finding`, `propose_remediation_action`, `claim_remediation_grant`) are now opt-in and only registered when `OBS_MCP_ENABLE_WRITES=true`. `OBS_API_TOKEN` is accepted as an alias for `OBS_DASHBOARD_TOKEN`. Tool inputs use the shared enum schemas, and the newer tools return only `data` (no duplicated top-level body).
- Dashboard: the remediation approval card now surfaces errors, asks for confirmation before approving, takes a rejection reason, and shows the one-time grant token. Externally supplied proposals without handlers render read-only. Fixes multi-underscore badge labels.
- Collector: AutoSRE triage enrichment runs only for `triage_incident`, respects the token budget, filters candidate changes to the fault-locus service, computes blackout suspicion, and no longer falls back to unrelated prior findings. Connected-rail change/finding/incident lookups use the shared getters and honor `environment`.
- CLI: one token resolver shared by `changes`, `keys`, and `doctor` that names the env var or flag in auth failures; `changes record` sends the ingest key once (Bearer); warns when credentials are passed as flags.
