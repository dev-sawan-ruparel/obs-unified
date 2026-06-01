# @obs-unified/collector

## 2.0.0

### Major Changes

- 4ac9a67: Initial publishable release.

  - Scope renamed from `@obs/*` to `@obs-unified/*` (no longer reserves the
    shorter `@obs` scope on npm — see `docs/migrate/from-obs-scope.md`).
  - All five packages now ship compiled `dist/` artifacts via `tsup` (was: raw
    `./src/*.ts` exports that only resolved inside the monorepo).
  - `@obs-unified/telemetry-sdk` splits Cloudflare-specific surfaces into the
    `./cloudflare` subpath so Node consumers don't pull
    `@cloudflare/workers-types`.
  - Workers-only peer-dependencies (`@hono/otel`, `@microlabs/otel-cf-workers`)
    are now marked optional.

### Minor Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.

### Patch Changes

- Updated dependencies [4ac9a67]
- Updated dependencies [0140450]
  - @obs-unified/types@2.0.0
  - @obs-unified/pprof-decoder@2.0.0
