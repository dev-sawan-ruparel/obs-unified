---
"@obsunified/collector": patch
"@obsunified/types": patch
---

Harden AutoSRE remediation governance: the causal proof tier is now derived server-side (a client-asserted cohort verdict can no longer buy an autonomous rollback grant), grant claims, leases, incident dedup and proposal idempotency are enforced atomically in SQL (migration 051), completion/failure require the claiming runner, and the post-remediation watchdog needs two consecutive healthy checkpoints and runs on the 1-minute tick.
Incident webhooks now use the SSRF-guarded delivery path (DNS classification, no redirects, 5s timeout) and can push a minted grant token to the runner; approver identity is derived from the dashboard session instead of client-supplied headers; `/v1/changes` accepts `source: "ci_webhook"`.
