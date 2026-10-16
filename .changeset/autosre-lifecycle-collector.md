---
"@obsunified/collector": patch
---

AutoSRE lifecycle fixes: finding creation accepts an `idempotencyKey` (a retry returns the stored finding), `fingerprintInput` may be partial, and an omitted fingerprint for a span-id fault locus is derived from the span's service, operation and error signature so the circuit breaker no longer fragments per span; `GET /internal/evals/runs/:id` lets callers validate counterfactual prerequisites before persisting; the evidence bundle's `priorFindings` also match by recurrence fingerprint; a `webhookUrl`/`secret` given to `propose` is stored on a pending proposal (migration 052, both dialects) and used when the proposal is approved without a callback, with only `callbackHost` exposed by GETs; `POST /internal/findings` now persists `codeReferences`.
