---
"@obs-unified/types": major
"@obs-unified/pprof-decoder": major
"@obs-unified/analytics-sdk": major
"@obs-unified/telemetry-sdk": major
"@obs-unified/collector": major
---

Initial publishable release.

- Scope renamed from `@obs/*` to `@obs-unified/*` (no longer reserves the
  shorter `@obs` scope on npm — see `docs/migrate-from-obs-scope.md`).
- All five packages now ship compiled `dist/` artifacts via `tsup`
  (was: raw `./src/*.ts` exports that only resolved inside the monorepo).
- `@obs-unified/telemetry-sdk` splits Cloudflare-specific surfaces into
  the `./cloudflare` subpath so Node consumers don't pull
  `@cloudflare/workers-types`.
- Workers-only peer-dependencies (`@hono/otel`,
  `@microlabs/otel-cf-workers`) are now marked optional.
