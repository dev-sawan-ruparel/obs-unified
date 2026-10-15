# @obsunified/dashboard

## 1.2.1

### Patch Changes

- da6443c: Harden the AutoSRE surfaces.
  - MCP server: the three write tools (`record_investigation_finding`, `propose_remediation_action`, `claim_remediation_grant`) are now opt-in and only registered when `OBS_MCP_ENABLE_WRITES=true`. `OBS_API_TOKEN` is accepted as an alias for `OBS_DASHBOARD_TOKEN`. Tool inputs use the shared enum schemas, and the newer tools return only `data` (no duplicated top-level body).
  - Dashboard: the remediation approval card now surfaces errors, asks for confirmation before approving, takes a rejection reason, and shows the one-time grant token. Externally supplied proposals without handlers render read-only. Fixes multi-underscore badge labels.
  - Collector: AutoSRE triage enrichment runs only for `triage_incident`, respects the token budget, filters candidate changes to the fault-locus service, computes blackout suspicion, and no longer falls back to unrelated prior findings. Connected-rail change/finding/incident lookups use the shared getters and honor `environment`.
  - CLI: one token resolver shared by `changes`, `keys`, and `doctor` that names the env var or flag in auth failures; `changes record` sends the ingest key once (Bearer); warns when credentials are passed as flags.

- Updated dependencies [a834692]
- Updated dependencies [970ba34]
  - @obsunified/types@2.2.0

## 1.2.0

### Minor Changes

- Implement RFC 0013 AutoSRE causal ontology, change correlation (`change_events`), traffic-normalized cohort lift, noisy-neighbor contention checks, counterfactual verification (`investigation_findings`), durable incident lease coordination (`incident_investigations`), and pre-execution CAS remediation grants (`remediation_proposals`).

### Patch Changes

- Updated dependencies
  - @obsunified/types@2.1.0

## 1.1.3

### Patch Changes

- c2c3f66: Onboarding dashboard now includes agent investigation guidance: capability
  cards link to the product surface, MCP tool, and docs for each signal so a new
  team can see what the dashboard and the investigation MCP server expose before
  instrumenting anything.
- c2c3f66: Republish with package metadata pointing at the personal monorepo. The
  `repository` and `homepage` fields of every currently published `@obsunified/*`
  version still link to the retired `obs-unified/obs-unified` organization repo,
  and the published READMEs reference the retired `obs-unified-docs.dev` domain.
  No runtime changes.
- Updated dependencies [c2c3f66]
  - @obsunified/types@2.0.2
  - @obsunified/pprof-decoder@2.0.2

## 1.1.2

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.
- Updated dependencies [77c781a]
  - @obsunified/pprof-decoder@2.0.1
  - @obsunified/types@2.0.1

## 1.1.1

### Patch Changes

- eec7b07: Productize production-to-eval per-case action tree comparisons in the
  Evaluations dashboard and publish the MCP server through npmjs for no-auth
  agent installs.

## 1.1.0

### Minor Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.

### Patch Changes

- Updated dependencies [4ac9a67]
- Updated dependencies [0140450]
  - @obsunified/types@2.0.0
  - @obsunified/pprof-decoder@2.0.0
