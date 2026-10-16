---
"@obsunified/telemetry-sdk": patch
---

`stampInteractionFromRequest` now logs a one-time `console.warn` when a non-empty `x-obs-interaction` header is dropped because it is not a 26-character Crockford ULID.
