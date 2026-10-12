---
"@obsunified/collector": patch
---

Scheduled maintenance handlers expose a runtime-neutral `run(env)`.

`createRetentionCleanupHandler()` and `createAnalysesRunHandler()` now return a
`ScheduledTaskHandler`: `run(env)` performs the work and resolves to a summary
(`RetentionCleanupSummary`, or the analyses run summary / `undefined` on a
logged failure), while the existing Cloudflare `scheduled(event, env, ctx)`
method is a thin adapter that delegates to `run`. Non-Workers hosts such as the
standalone Node collector can drive the jobs without fabricating
`ScheduledEvent` / `ExecutionContext` objects. Existing `scheduled` callers are
unaffected.
