# @obs-unified/dashboard

## 1.1.2

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.
- Updated dependencies [77c781a]
  - @obs-unified/pprof-decoder@2.0.1
  - @obs-unified/types@2.0.1

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
  - @obs-unified/types@2.0.0
  - @obs-unified/pprof-decoder@2.0.0
