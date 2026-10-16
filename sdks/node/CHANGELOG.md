# @obsunified/sdk

## 0.3.3

### Patch Changes

- Updated dependencies [fc42238]
  - @obsunified/types@2.3.0

## 0.3.2

### Patch Changes

- Updated dependencies [3ba2c0a]
- Updated dependencies [c800403]
  - @obsunified/types@2.2.1

## 0.3.1

### Patch Changes

- 970ba34: Fix runtime lineage across the SDKs and align the environment vocabulary.
  - **Cloudflare Workers lineage now reaches the exporter (telemetry-sdk).** `createResolveConfig` / the telemetry plugin set a `resource` field that `@microlabs/otel-cf-workers` ignores, so `environment`, `serviceVersion`, `commitSha` and `configDigest` were silently dropped. They are now stamped on each exported span through a `postProcessor`. Existing span attributes are never overwritten.
  - **Feature flags work on Workers (telemetry-sdk).** `recordFeatureFlag` no longer relies on `AsyncLocalStorage.enterWith`/`disable`, which Cloudflare does not implement; it falls back to a module-level store, and `clearRecordedFeatureFlags` clears it. `withFeatureFlagScope` semantics are unchanged.
  - **Environment names are normalised.** New `normalizeEnvironment` (exported from `@obsunified/types/lineage`): lowercase and trim, `production` becomes `prod`, `development` becomes `dev`, `test` is unchanged, empty becomes `default`. It is applied to the `environment` option, `OBS_ENVIRONMENT` and `NODE_ENV` in all three SDKs, and in the collector when reading span environments and when recording change events, so `NODE_ENV=production` spans join changes posted as `prod`.
  - **Less attribute inflation.** Lineage (`deployment.environment.name`, `obs.environment`, `service.version`, `obs.service.version`, `vcs.commit.id`, `obs.commit.sha`, `obs.config.digest`) is now sent once on the resource instead of on the request span and every child span (telemetry-sdk) or every span (sdk). Feature-flag attributes are still per span. In analytics-sdk the same keys appear once in event `context`; the camelCase duplicates (`environment`, `serviceVersion`, `commitSha`, `configDigest`) and the copy in `properties` are removed.
  - **Shared implementation.** The three duplicated `lineage.ts` modules now import from the new subpath `@obsunified/types/lineage` (no `process` access; safe for browser bundles). `@obsunified/sdk` gains a dependency on `@obsunified/types`. Public exports of each SDK are unchanged.
  - **`@obsunified/sdk` no longer publishes test files** in `dist`.
  - **The nested `lineage` option is deprecated** in favour of the flat `environment`, `serviceVersion`, `commitSha` and `configDigest` options. It still works.
  - **types:** `EvidenceBundle` autosre `priorFindings[].causalVerificationStatus` / `recoveryStatus` now use the existing enum schemas, and `EvidenceBundleJsonSchema.autosre` is a real JSON schema instead of an open object. New zod schemas `ChangeEventInputSchema`, `InvestigationFindingInputSchema` and `RemediationProposalInputSchema`. `normalizeErrorSignature` also scrubs undashed hex runs of 16+ characters, and canonical node-id segments percent-encode `:` and `/` (and `%`) so they cannot collide with id delimiters; node ids containing those characters (for example IPv6 hosts) change.
  - **collector:** the ontology node upsert cache is capped at 5000 entries (oldest evicted) and is only populated after the batch write succeeds.

  Runtime lineage options and env vars (see each package README): `environment` (`OBS_ENVIRONMENT`, `NODE_ENV`), `serviceVersion` (`OBS_SERVICE_VERSION`, `OTEL_SERVICE_VERSION`), `commitSha` (`OBS_COMMIT_SHA`, `GITHUB_SHA`), `configDigest` (`OBS_CONFIG_DIGEST`); record flag evaluations with `recordFeatureFlag(key, variant, { providerName, contextId })`.

- Updated dependencies [a834692]
- Updated dependencies [970ba34]
  - @obsunified/types@2.2.0

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
