---
"@obsunified/types": patch
"@obsunified/telemetry-sdk": patch
"@obsunified/analytics-sdk": patch
"@obsunified/dashboard": patch
"@obsunified/pprof-decoder": patch
"@obsunified/brand": patch
"@obsunified/agents-langgraph": patch
"@obsunified/agents-vercel-ai": patch
"@obsunified/sdk": patch
---

Republish with package metadata pointing at the personal monorepo. The
`repository` and `homepage` fields of every currently published `@obsunified/*`
version still link to the retired `obs-unified/obs-unified` organization repo,
and the published READMEs reference the retired `obs-unified-docs.dev` domain.
No runtime changes.
