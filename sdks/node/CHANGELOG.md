# @obsunified/sdk

## 0.3.0

### Minor Changes

- Implement RFC 0013 AutoSRE causal ontology, change correlation (`change_events`), traffic-normalized cohort lift, noisy-neighbor contention checks, counterfactual verification (`investigation_findings`), durable incident lease coordination (`incident_investigations`), and pre-execution CAS remediation grants (`remediation_proposals`).

## 0.2.2

### Patch Changes

- c2c3f66: Republish with package metadata pointing at the personal monorepo. The
  `repository` and `homepage` fields of every currently published `@obsunified/*`
  version still link to the retired `obs-unified/obs-unified` organization repo,
  and the published READMEs reference the retired `obs-unified-docs.dev` domain.
  No runtime changes.

## 0.2.1

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.

## 0.2.0

### Minor Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.
