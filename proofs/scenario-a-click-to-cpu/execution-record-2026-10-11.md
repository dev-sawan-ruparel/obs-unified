# Scenario A Live Validation Execution Record (Synthetic Rail & Trace→Profile Slice)

- **Date**: 2026-10-11
- **Target**: Scenario A Synthetic API Rail Chain & Trace→Profile Browser Slice
- **RFC Scope**: [RFC 0006 Phase 6.6](../../rfcs/0006-connected-rail.md) (targeted synthetic verification; does NOT fulfill full [RFC 0003 Acceptance #1](../../rfcs/0003-unified-stack.md))
- **Status**: PASSED (Synthetic Rail & Trace→Profile Slice Only; RFC 0003 Acceptance #1 Gaps Remain)

---

## 1. Execution Commands & Verification Results

### A. Environment Prerequisites & Local Database Migrations
```bash
# Workspace dependencies
pnpm install --frozen-lockfile

# Local collector environment configuration
bash scripts/setup-local-dev.sh

# Apply D1 migrations for local collector database
pnpm --filter @obs-demo/collector run db:setup
```
- **Outcome**: Succeeded. 40 D1 migrations applied. D1 SQLite tables (`profile_blobs`, `profile_trace_index`, `actions`, `tool_calls`, `agent_runs`, `telemetry_spans`, `usage_events`, `metric_exemplars`) migrated.

### B. Local Daemons
```bash
# Start collector daemon (:8790) in first terminal
pnpm run dev:collector

# Start demo app in second terminal
pnpm run dev:demo
```
- **Outcome**: Daemons listening:
  - Collector: `http://localhost:8790`
  - Dashboard Web: `http://localhost:5173`
- **Note**: Playwright config starts the web server for the test. The demo command was run in a second terminal.
- **External Seed Note**: Automated tests (`scenario-a-click-to-cpu.spec.ts`) idempotently seed the required Scenario A trace, span, click, and pprof profile records directly against the collector API. Starting the demo app (`pnpm dev:demo` on `:8787`) and running `node scripts/seed-everything/run.mjs` is optional and only required if exercising external demo traffic.

### C. Live Playwright Integration Suite (2/2 Passed)
```bash
pnpm --filter @obs-demo/web exec playwright test scenario-a-click-to-cpu.spec.ts --reporter=line --workers=1 --timeout=90000
```
- **Outcome**: 2 passed (0 failed, 0 skipped, 2 total)
  - `PASS` `walks the Click-to-CPU Connected Rail chain: alert → trace → hot span → CPU profile → session → click`
  - `PASS` `dashboard UI navigation walks trace waterfall to span Connected Rail and profile flame graph`

### D. Focused Connected Rail Unit Suite (27/27 Passed)
```bash
pnpm --filter @obsunified/collector exec vitest run src/plugins/connected-routes.test.ts
```
- **Outcome**: 27 passed (0 failed, 27 total)
  - Manifest contracts and informative absence verified across all entity kinds
  - Count-link pattern verified (> 5 items collapse to count link)
  - Span Connected Rail `Down` link surfaces scoped CPU profile (`#/profiles/<id>?trace_id=...`)
  - Span Connected Rail `Up` link surfaces parent session (`#/replay?session=<sessionId>`) drawn strictly from correlated usage data without arbitrary query parameter fallback
  - Profile Connected Rail `Across` surfaces sampled traces cohort
  - Action graph causal edges, tool calls, and agent runs verified

### E. Collector Type-Check & Build
```bash
pnpm --filter @obsunified/collector exec tsc --noEmit
pnpm --filter @obsunified/collector build
```
- **Outcome**:
  - Type-check: 0 errors
  - Build: clean bundle generated

---

## 2. Invariant Evidence Log

| Step | Invariant | Verified Evidence |
| --- | --- | --- |
| 1 | Alert Ingestion | `GET /internal/alerts/rules` returns rule `Slow checkout p95` querying `POST /api/checkout`. (Rule configuration check; does not assert firing alert or exemplar trigger). |
| 2 | Trace Waterfall & Span Hierarchy | `GET /internal/telemetry/traces/0a000000000000000000000000000001` returns root span `0a00000000000101` and child span `0a00000000000102` (`payment.charge` with required `obs.interaction.id` and `session.id`; self-time dominance is not asserted). |
| 3 | Span Connected Rail [Down] | `GET /internal/connected/span/0a000000000000000000000000000001:0a00000000000102` `Down` section links to `#/profiles/<profileId>?trace_id=0a000000000000000000000000000001`. |
| 4 | Span Connected Rail [Up] | `Up` section contains parent trace (`#/traces/0a000000000000000000000000000001`) and parent session (`#/replay?session=seed-scenario-a-session`). |
| 5 | Span Connected Rail [Related] | `Related` section unconditionally links to originating click (`#/usage?id=01JA0000000000000000000001`). |
| 6 | CPU Profile Route & Join Structure | `GET /internal/profiles/<profileId>?trace_id=...` returns HTTP 200. Only status, link, and trace filter structure are asserted; pprof response body is not parsed and hot-frame dominance is not asserted. |
| 7 | Profile Connected Rail [Across] | `GET /internal/connected/profile/<profileId>` `Across` section surfaces `0a000000000000000000000000000001` in sampled traces. |
| 8 | Session Connected Rail [Across] | `GET /internal/connected/usage/seed-scenario-a-session?session_id=...` `Across` surfaces spans linked to trace `0a000000000000000000000000000001`. |

---

## 3. Limits & Remaining Gaps Against RFC 0003 Acceptance #1

1. **Targeted Synthetic Scope**:
   - This execution record strictly validates the synthetic API rail contracts and the 2-hop `trace waterfall → span Connected Rail → profile flame graph` browser slice.
   - It does **not** fulfill full RFC 0003 Acceptance #1 or the complete 6-hop Scenario A user journey.
2. **OTel Astronomy Shop Gap**:
   - The test seeds synthetic fixtures via API (`ensureScenarioAFixture`) rather than executing against a fresh install loaded with the live OpenTelemetry Astronomy Shop demo.
3. **Alert Firing & Exemplar Navigation Gap**:
   - The test verifies alert rule definition in `/internal/alerts/rules`; it does not prove an active firing alert, narrative generation, or exemplar navigation from an alert.
4. **Session Replay (rrweb) Gap**:
   - The test checks usage event identity and session manifest cross-links; it does not test rrweb session replay playback or DOM mutation timeline events.
5. **Full 6-Hop UI Navigation Gap**:
   - The browser UI test only covers `trace waterfall → span Connected Rail → profile flame graph view`. It does not execute the full 6-hop UI journey (alert → trace → flame graph → cohort view → session timeline → replay event detail → trace).
6. **Assertion Boundary**:
   - The test asserts HTTP status codes, Connected Rail links, and trace-to-profile index structures. It does not parse the binary pprof response body or assert frame self-time dominance.
7. **External Dependency Blocks**:
   - Live execution requires local daemons (`http://localhost:8790` for collector and `http://localhost:5173` for web dashboard), pre-installed Node.js dependencies (`pnpm install --frozen-lockfile`), local environment setup (`bash scripts/setup-local-dev.sh`), and D1 database migrations (`pnpm --filter @obs-demo/collector run db:setup`).
   - In environments where network ports cannot be bound or browser binaries are not present, Playwright integration tests are blocked; contract integrity is verified via the in-memory unit suite (`src/plugins/connected-routes.test.ts`, 27/27 passed).
