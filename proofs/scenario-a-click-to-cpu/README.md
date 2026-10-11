# Scenario A — Click-to-CPU / Connected Rail Canonical Proof (Synthetic Rail & Trace→Profile Slice)

This directory contains the canonical reproducible proof and verification record for **Scenario A (Click-to-CPU / Connected Rail)** synthetic API rails and trace→span→profile browser slice ([RFC 0006 Phase 6.6](../../rfcs/0006-connected-rail.md)).

> [!WARNING]
> This proof covers a verified **synthetic API rail + trace→span→profile browser slice**. It does **not** fulfill full [RFC 0003 Acceptance #1](../../rfcs/0003-unified-stack.md) or the complete 6-hop Scenario A UI journey:
> - It does **not** run on a fresh OTel Astronomy Shop install (it seeds synthetic spans, profiles, interactions, and rules directly into the collector).
> - It does **not** prove a live firing alert or exemplar trace navigation from an active alert incident.
> - It does **not** assert pprof response body internals or flame graph self-time dominance (only HTTP status, rail links, trace filtering structure, and profile surface presence are asserted).
> - It does **not** test session replay (rrweb playback or DOM mutation timeline).
> - The browser UI test only traverses `trace waterfall → span Connected Rail → profile flame graph view`, not the full 6-hop UI journey.

## Summary

Scenario A validates the targeted synthetic API rail chain and trace→profile browser slice:
```
Synthetic Alert Rule (Slow checkout p95 exists in /internal/alerts/rules)
  └─► Synthetic Trace Waterfall (0a000000000000000000000000000001, POST /api/checkout)
        └─► Child Span (0a00000000000102, payment.charge with obs.interaction.id & session.id)
              ├─► Connected Rail [Down]: CPU Profile link (#/profiles/<id>?trace_id=0a000000000000000000000000000001)
              │     └─► Profile route: HTTP 200 & Connected Rail [Across] sampled traces cohort
              └─► Connected Rail [Related] / [Up]:
                    ├─► Originating Click link [Related] (interaction_id required)
                    └─► User Session link [Up] & Session Manifest [Across] spans link (session_id required)
```
In browser UI:
```
Trace Waterfall View (POST /api/checkout & payment.charge)
  └─► Click payment.charge (expands span Connected Rail)
        └─► Click Profile link (#/profiles/<id>)
              └─► Profile detail view rendered
```

> [!NOTE]
> Scenario A proves this targeted synthetic traversal slice. It does **not** claim full any-to-any matrix or universal ≤2-click coverage across all arbitrary signal pairs, which remains incomplete.
> Furthermore, `tests/fixtures/scenario-a-click-to-cpu.json` serves as an offline design/ID contract and documented specification reference; the integration test uses programmatic seeding (`ensureScenarioAFixture`) directly against the collector API rather than parsing that JSON file at runtime. The fixture JSON is preserved as a documented contract reference.

## Reproducible Commands

### 1. Prerequisites and Local Stack Setup
```bash
# Install workspace dependencies
pnpm install --frozen-lockfile

# Configure local collector environment (.dev.vars)
bash scripts/setup-local-dev.sh

# Apply D1 migrations for local collector database (runs 40 migrations)
pnpm --filter @obs-demo/collector run db:setup

# Build workspace packages
pnpm build

# Start collector daemon (http://localhost:8790) and demo app (http://localhost:8787)
# (Playwright's config automatically starts the web dashboard server at http://localhost:5173; do not run pnpm dev:web)
pnpm run dev:collector
pnpm run dev:demo
```

> [!NOTE]
> The Playwright integration test (`scenario-a-click-to-cpu.spec.ts`) programmatically seeds the required Scenario A trace, span, usage click, and pprof profile fixtures directly against the collector API (`ensureScenarioAFixture`).
> The offline fixture file `tests/fixtures/scenario-a-click-to-cpu.json` is a design/ID contract and documented reference, not read at runtime.
> Starting the demo service (`pnpm run dev:demo` on port 8787) supports demo traffic, while Playwright's `playwright.config.ts` automatically manages the web dashboard process on port 5173.

### 2. Live Playwright Integration Test (2/2 Passed)
```bash
# Runs the live, unskipped Scenario A integration test suite
pnpm --filter @obs-demo/web exec playwright test scenario-a-click-to-cpu.spec.ts --reporter=line --workers=1 --timeout=90000
```

### 3. Focused Connected Rail Unit Suite (27/27 Passed)
```bash
# Contract and unit verification (runs in memory without network)
pnpm --filter @obsunified/collector exec vitest run src/plugins/connected-routes.test.ts
```

### 4. Collector Type-Check & Build (Succeeded)
```bash
# Verify collector types and build artifact
pnpm --filter @obsunified/collector exec tsc --noEmit
pnpm --filter @obsunified/collector build
```

## Exact Evidence & Invariant Verification (2026-10-11)

1. **Alert Rule Ingest**:
   - `GET /internal/alerts/rules` returns rule `Slow checkout p95` querying `spanName: "POST /api/checkout"`. (Rule configuration check only; does not assert firing alert or exemplar trigger).
2. **Trace Waterfall & Span Hierarchy**:
   - `GET /internal/telemetry/traces/0a000000000000000000000000000001` returns 3 spans:
     - Root: `0a00000000000101` (`POST /api/checkout`)
     - Child: `0a00000000000102` (`payment.charge`), parent `0a00000000000101`
     - Child: `0a00000000000103` (`payments-db.insert charge`), parent `0a00000000000102`
   - Child span `payment.charge` carries required `obs.interaction.id` and `session.id` attributes. (Self-time derivation/dominance is not asserted or proven).
3. **Connected Rail Span Manifest**:
   - `GET /internal/connected/span/0a000000000000000000000000000001:0a00000000000102`:
     - `down`: Links to `#/profiles/<profileId>?trace_id=0a000000000000000000000000000001` (CPU profile for `checkout-api`).
     - `related`: Unconditionally links to originating click `#/usage?id=<interactionId>`.
     - `up`: Unconditionally links to parent session `#/replay?session=<sessionId>`.
4. **Profile Route & Trace Join Structure**:
   - `GET /internal/profiles/<profileId>?trace_id=0a000000000000000000000000000001` returns HTTP 200. (Status and link structure asserted; pprof binary body is not parsed and hot frames are not asserted).
   - `GET /internal/connected/profile/<profileId>`:
     - `across`: Contains `Sampled traces` section referencing `0a000000000000000000000000000001`.
5. **Session to Trace Join**:
   - `GET /internal/connected/usage/<sessionId>?session_id=<sessionId>`:
     - `across`: Contains `Spans in this session` referencing `0a000000000000000000000000000001`.
6. **Browser UI Slice**:
   - Playwright navigates `trace waterfall → expand span Connected Rail → click CPU profile link → profile detail rendered`. (2 passed).

Detailed execution logs and pass/fail records are documented in [Execution Record (2026-10-11)](execution-record-2026-10-11.md).

## Limitations & Remaining Gaps Against RFC 0003 Acceptance #1

1. **OTel Astronomy Shop Dependency**:
   - The test relies on synthetic API fixtures injected programmatically into the collector (`ensureScenarioAFixture`).
   - It does not validate execution on a fresh install of the OTel Astronomy Shop demo with native or `@obsunified` SDK instrumentation.
2. **Firing Alert & Exemplar Navigation**:
   - The test verifies rule configuration in `/internal/alerts/rules`.
   - It does **not** prove a live firing alert transition, an incident narrative payload, or clicking an exemplar trace directly from an active alert.
3. **Trace Waterfall Self-Time Dominance**:
   - The test asserts span hierarchy and metadata existence.
   - It does **not** assert or prove computed self-time calculation or that `payment.charge` is mathematically the slowest/dominant span.
4. **Profile Binary Body & Hot Frames**:
   - The test asserts HTTP 200 and rail link presence for the profile route.
   - It does **not** parse pprof protobuf frames or prove that hot frames (e.g., `json.parse`) are identified or dominant.
5. **Session Replay (rrweb) Validation**:
   - The test validates the usage event model and session rail across spans.
   - It does **not** prove live rrweb replay playback or DOM mutation timeline inspection.
6. **Full Six-Hop UI Journey**:
   - The browser UI Playwright test only covers a 2-hop slice: `trace waterfall → span Connected Rail → profile flame graph view`.
   - It does not traverse the complete 6-hop UI journey defined in [docs/ux/click-to-cpu.md](../../docs/ux/click-to-cpu.md) (alert → trace → flame graph → cohort view → session timeline → replay event detail → trace).
7. **Design Fixture Role**:
   - `tests/fixtures/scenario-a-click-to-cpu.json` is a design/ID contract and documented offline reference rather than an input parsed by runtime tests. It is preserved as reference documentation rather than deleted.
8. **Live Stack Dependency**:
   - Full browser execution requires the local collector daemon (`http://localhost:8790`, running with 40 D1 migrations applied via `pnpm --filter @obs-demo/collector run db:setup`), the demo service (`pnpm run dev:demo`), and Playwright's automated web dashboard server (`http://localhost:5173`).
   - In ephemeral sandbox/CI worktrees where `node_modules` are not installed or network ports cannot be bound, Playwright execution is blocked until dependencies are installed (`pnpm install --frozen-lockfile`) and local daemons are started.
