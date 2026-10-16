---
"@obsunified/collector": patch
---

Fix finding fingerprints for `traceId:spanId` span loci (the span now resolves to its service node) and fall back to the finding summary when a span has no error signature.
