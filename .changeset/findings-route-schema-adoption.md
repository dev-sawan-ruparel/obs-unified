---
"@obsunified/collector": patch
---

`POST /internal/findings` now validates with `InvestigationFindingHttpInputSchema` (RFC 0014 WS5) instead of hand-parsing. The combined required-fields message and the `causalChain` messages are unchanged, and trimming and null defaults are preserved. Tightening: wrongly typed optional fields (for example a non-numeric `confidence`, an unknown `causalProofTier`, an invalid entity kind, or a non-string entry in `citedEvidenceIds`) now return 400 with `{ error: "<path>: <message>" }` instead of being silently ignored.
