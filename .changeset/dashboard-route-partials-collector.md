---
"@obsunified/collector": patch
---

Add `GET /internal/ai/calls/:callId` returning the AI call row with its `traceId` and `spanId` (404 when unknown), and point connected-manifest eval links at `#/evaluations/<id>`.
