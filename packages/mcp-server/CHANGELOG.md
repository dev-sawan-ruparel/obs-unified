# @obsunified/mcp-server

## 2.4.1

### Patch Changes

- e7c839b: Fix `dashboardUrl` values for evidence refs, service operations, and evals so they match real dashboard routes.

## 2.4.0

### Minor Changes

- 3ba2c0a: Add `list_incidents`, `get_incident` and `get_remediation_proposal` (always registered) and the opt-in `open_incident` write tool (26 read + 4 write tools). `record_investigation_finding` validates counterfactual eval runs before persisting, returns `data.finding` plus `data.counterfactualError` when verification fails after the insert, and accepts an optional `idempotencyKey`; its `fingerprintInput` fields are now optional. `propose_remediation_action` accepts optional `webhookUrl` and `webhookSecret` for grant handoff.

## 2.3.0

### Minor Changes

- da6443c: Harden the AutoSRE surfaces.
  - MCP server: the three write tools (`record_investigation_finding`, `propose_remediation_action`, `claim_remediation_grant`) are now opt-in and only registered when `OBS_MCP_ENABLE_WRITES=true`. `OBS_API_TOKEN` is accepted as an alias for `OBS_DASHBOARD_TOKEN`. Tool inputs use the shared enum schemas, and the newer tools return only `data` (no duplicated top-level body).
  - Dashboard: the remediation approval card now surfaces errors, asks for confirmation before approving, takes a rejection reason, and shows the one-time grant token. Externally supplied proposals without handlers render read-only. Fixes multi-underscore badge labels.
  - Collector: AutoSRE triage enrichment runs only for `triage_incident`, respects the token budget, filters candidate changes to the fault-locus service, computes blackout suspicion, and no longer falls back to unrelated prior findings. Connected-rail change/finding/incident lookups use the shared getters and honor `environment`.
  - CLI: one token resolver shared by `changes`, `keys`, and `doctor` that names the env var or flag in auth failures; `changes record` sends the ingest key once (Bearer); warns when credentials are passed as flags.

## 2.2.0

### Minor Changes

- Implement RFC 0013 AutoSRE causal ontology, change correlation (`change_events`), traffic-normalized cohort lift, noisy-neighbor contention checks, counterfactual verification (`investigation_findings`), durable incident lease coordination (`incident_investigations`), and pre-execution CAS remediation grants (`remediation_proposals`).

## 2.1.0

### Minor Changes

- c2c3f66: Publish the RFC 0011 evidence retrieval tools. The server now exposes
  `get_evidence_bundle`, `retrieve_evidence_ref`, `search_evidence_ref`, and
  `get_evidence_stats` alongside the existing investigation tools (20 tools in
  total). These shipped on `main` after 2.0.1 but were never published, so the
  documented evidence-bundle workflow did not work against the npm package.

  Also raises the `@modelcontextprotocol/sdk` floor to 1.32.1, which pulls the
  patched `express`, `proxy-addr`, `fast-uri`, and `ip-address` versions flagged
  by `pnpm audit`.

## 2.0.2

### Patch Changes

- 82c6d9d: Implement programmatic DASHBOARD_TOKEN / OBS_DASHBOARD_TOKEN Bearer authentication contract on collector /internal/\* routes and enforce strict rejection of ingest keys on read and admin endpoints.

## 2.0.1

### Patch Changes

- eec7b07: Productize production-to-eval per-case action tree comparisons in the
  Evaluations dashboard and publish the MCP server through npmjs for no-auth
  agent installs.

## 2.0.0

### Major Changes

- e9e2cab: Add the first obs-unified MCP server, exposing collector investigation endpoints as local MCP tools for AI agents.
