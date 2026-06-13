# @obsunified/cli

## 1.0.3

### Patch Changes

- d664b30: `doctor --origin` now replaces the default origin list instead of adding to it, and the default shrinks to `http://localhost:5173`. Previously the hardcoded `http://localhost:8080` default stayed in the checked set even when `--origin` was passed, so the documented verify command failed its browser-ingest CORS check (exit 1) against a perfectly healthy all-in-one container. Pass `--origin` repeatedly — or set `OBS_DOCTOR_ORIGINS` — to check several origins, e.g. `--origin http://localhost:8080` for the Astronomy Shop demo.

## 1.0.2

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.

## 1.0.1

### Patch Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.
