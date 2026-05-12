# Shortcuts taken during the RFC 0003 tree implementation

A running ledger of places where what shipped doesn't literally match the RFC, plus the rationale and the path back. Honest and exhaustive — every item should be either resolved (with a commit reference) or have an owner / next step.

The purpose of this doc is to make the gaps **visible and trackable** rather than buried in commit messages or open-question lists in individual RFCs.

Status legend:
- ✅ **Resolved** — closed by a follow-up commit; gap no longer exists.
- 🟡 **Active** — shortcut still in place; deliberate but not closed.
- 🔴 **Drift** — what shipped diverges from the RFC text without an updated RFC entry.

---

## Ingest-time pprof parsing → header-driven trace_ids

**RFC 0007 §Receiver / Phase 4.3 acceptance criterion #2.**

> "the receiver writes the blob verbatim to R2 / filesystem and reads trace_ids from an `x-obs-trace-ids` header"

**RFC text says:** the collector parses the pprof blob at ingest and extracts each distinct `trace_id` label, populating `profile_trace_index` automatically.

**What shipped (Phase 4):** the receiver writes the blob unchanged and trusts an `x-obs-trace-ids` HTTP header for the trace_id list. The Phase 4 plan-of-record minimal scope explicitly chose this to avoid pulling a pprof parser onto the worker.

**Status:** ✅ Resolved (see commit closing this item below — moved the `parse-pprof.ts` decoder into a Worker-safe path and now extract trace_ids from sample labels at ingest. The header is still honored as an override / pre-extraction fast path).

---

## `startProfiler()` API → `pushProfile()` lower-level helper

**RFC 0007 §SDK helper for Node / Phase 4.8.**

> "`startProfiler({type:'cpu', intervalMs: 60_000})` ... default: POST to OBS_COLLECTOR_URL/v1/profiles/pprof"

**RFC text says:** an auto-looping helper in `@obs/telemetry-sdk` that wraps `@datadog/pprof`, samples on an interval, and pushes profiles automatically.

**What shipped (Phase 4):** `pushProfile({ blob, traceIds, profileType, ... })` — a single-shot helper that takes already-encoded gzipped pprof bytes and pushes them. Library-agnostic (no `@datadog/pprof` dep), but the user has to wire the sampling loop themselves.

**Status:** ✅ Resolved — the auto-loop helper (`startProfiler`) lands as a thin wrapper around `pushProfile` that owns the timer + delegates the actual capture to whatever profiler the user injects. Keeps the library-agnostic property while restoring the RFC's promised one-call ergonomics.

---

## Server-side pre-filter (`?trace_id=X`)

**RFC 0007 §Flame graph rendering / Phase 4.5 acceptance criterion #6.**

> "filtered/merged blob (Phase 2)"

**RFC text says:** `GET /internal/profiles/:id?trace_id=X` returns a re-serialized pprof containing only matching samples, typically 10-100× smaller than the input.

**What shipped (Phase 4):** the endpoint accepts the parameter and returns metadata + the trace_id list, but the actual blob filtering isn't implemented — the dashboard fetches the full blob and filters client-side.

**Status:** ✅ Resolved — server-side pre-filter now re-serializes a pprof containing only samples whose labels match. Client still has the local filter as a fallback; large JVM profiles bypass the network re-fetch.

---

## Connected rail — profile entity not yet a section

**RFC 0006 + RFC 0007 §Connection to RFC 0006 (Connected rail) / Phase 4.9.**

> "Profiles become a new entity kind in the rail: Span detail rail → '🔥 Profile (cpu, last 60s window)' link"

**RFC text says:** the rail's "Down" section on a span surfaces a link to the covering profile.

**What shipped (Phase 3 + 4):** the trace-summary 🔥 badge is the only profile surface today. The connected rail's manifest endpoint (`/internal/connected/:kind/:id`) doesn't include profiles in the Down section.

**Status:** ✅ Resolved — connected-routes now queries `profile_trace_index` for spans and surfaces matching profiles under Down. RFC 0009 #5 (off-CPU profile link) is the same code path.

---

## Service map — SDK/eBPF source filter

**RFC 0009 §Kernel-derived service-map edges / Phase 5.3.**

> "Service map filter — toggle SDK-derived vs eBPF-derived edges via `telemetry.sdk.name = "beyla"` resource attribute"

**RFC text says:** the service-map dashboard exposes a toggle for SDK-derived vs eBPF-derived edges. Queries filter by `telemetry.sdk.name`.

**What shipped (Phase 5):** nothing. The schema doesn't yet denormalize `telemetry.sdk.name` onto `telemetry_spans`, so the filter would be a JSON-extract on every row — too slow.

**Status:** ✅ Resolved — migration adds `telemetry_sdk_name` column on telemetry_spans, default-span-enrichment plugin populates it, and the service-map dashboard exposes a source filter (sdk / ebpf / all).

---

## Off-CPU flame graph rendering

**RFC 0009 acceptance criterion #4.**

**Status:** ✅ Resolved by the flame graph viewer (Phase 4.7). Off-CPU profiles render with a blue palette via the same `<FlameGraph />` component; the `profileType` prop drives the color choice.

---

## Wrangler dev — `--test-scheduled` required for cron-driven features

**RFC 0002 Stage 4 + RFC 0004 #8.**

**Symptom:** the Investigations tab rendered "No investigations yet" even with a
fully populated synthetic seed (96 spans / 20 logs / 12 AI calls). Tier 0
analyses are inserted into `analysis_definitions` only by the every-minute
analyses cron — `wrangler dev` doesn't fire scheduled handlers automatically.

**What shipped:** the dev script in `apps/collector/package.json` now passes
`--test-scheduled`, so the cron fires every minute *and* operators can trigger
on demand via `curl 'http://localhost:8790/__scheduled?cron=*+*+*+*+*'` (used
right after `make seed`). Production CF Workers honor cron natively — this
flag only affects dev.

**Status:** ✅ Resolved. Documented because anyone running the demo cold for
the first time will hit the same empty state until they wait 60s or hit the
trigger URL.

**Path forward (optional polish):** `pnpm seed` could curl `/__scheduled` once
at the end so the dashboard is "warm" immediately after seeding. Tracked.

---

## Propagation metric is hourly, not "after one minute"

**RFC 0004 acceptance criterion #8.**

> "The `obs.interaction.propagation` metric appears in `metric_point` after one minute of demo traffic"

**What shipped:** the metric aggregator runs hourly (piggybacking on the retention cron). The first sample appears within the hour, not within the minute.

**Status:** 🟡 Active. Tradeoff: per-event emission would be a 2× write amplification on every ingest path; the metric is operational, not analytical. RFC text should be relaxed to "within the first cron tick after demo traffic begins (default hourly)" — or, if real-time visibility matters, an on-demand `/internal/admin/run-propagation-aggregate` endpoint is a small follow-up.

**Path back:** if anyone hits the actual UX of "I sent 10 events, why isn't the metric there?", expose the on-demand endpoint. Documenting in shortcuts so it's not invisible.

---

## Uninstrumented-badge threshold not calibrated against real data

**RFC 0005 acceptance criterion #2.**

> "threshold ... needs validation against demo data before this RFC leaves draft"

**What shipped:** `self_ms / duration_ms > 0.7 AND duration_ms > 100ms AND children.length < 2` — the RFC's starting heuristic. No calibration run against the OTel Astronomy Shop demo because the demo doesn't yet ship our SDK (Phase 6.1 prerequisite).

**Status:** 🟡 Active. Closes when Phase 6 demo run produces real trace data; the threshold may need to move ±20% based on how spammy the badge feels.

**Path back:** the calibration is mechanical once the demo runs — eyeball the trace listing, see if the badge fires too often or too rarely, adjust the constants. Tracked under Phase 6.

---

## Synthetic tests for ConnectedRail empty-state + count-link

**RFC 0006 §Acceptance criteria.**

> "the rail must render the section header, render '—', and a hover-tooltip with a non-generic explanation. A blank or missing section is a regression."

**What shipped:** the manifest endpoint always emits `emptyReason` (verified by reading the code), and the React component renders the explanation tooltip. **No automated test** asserts these contracts.

**Status:** ✅ Resolved — added unit tests for the manifest endpoint covering empty / many-link / count-link cases against `MemSqlDb`.

---

## Fetch interception tests for Mode A

**RFC 0004 acceptance criteria #2-4.**

> "Mode A unit test: A synthetic click handler that fires `fetch('/api')` synchronously results in the request carrying `x-obs-interaction` matching the click's interaction_id."

**What shipped:** stack push/pop semantics are exhaustively tested; the actual fetch-side-effect (header injection through the patched `globalThis.fetch`) is **only** covered structurally via `wrapFetchWithCorrelation` unit tests — which verify the wrapper but don't drive a synthetic click → fetch chain.

**Status:** 🟡 Active. The pure helpers are covered; the install-then-dispatch chain isn't. A Playwright test on the demo (Phase 6.6) covers it end-to-end; a unit test would need jsdom (which the workspace doesn't currently use).

**Path back:** add `happy-dom` to the analytics-sdk test setup for the Mode A integration test. Small ~40-line change to `vitest.config.ts`. Tracked.

---

## Demo-prerequisite acceptance criteria (RFC 0003 umbrella + many ⚠️)

**RFC 0003 acceptance criteria #1-4.**

**What shipped:** every implementation piece individually works, but the umbrella's "Scenario A executes end-to-end on demo" criterion is conditional on the demo SDK overlay (Phase 6.1-6.3) being applied. The overlay recipe is documented in `docs/implementation/demo-integration.md` but hasn't been run.

**Status:** 🟡 Active. Operator-side work — needs `pnpm demo:up` + the SDK overlays applied + clicks captured. The Playwright matrix scaffold is ready to flip from `test.skip` to active as each cell is manually verified.

**Path back:** schedule the demo run as a single dedicated task. Before calling RFC 0003 done, the matrix should be ≥ 80% green.

---

## Concurrent-prepares serialize on D1 (IdentityIndex perf)

**RFC 0008 §Risks.**

**What shipped:** `IdentityIndex.bySession` fans 5 prepared queries via `Promise.all`. D1's HTTP-backed model serializes concurrent prepares anyway, so the wall time is the sum, not the max.

**Status:** 🟡 Active. The RFC flagged this; the implementation matches. Sub-ms on `better-sqlite3` if/when a Node deployment lands; ~30-50ms on D1 today (acceptable for detail-page render).

**Path back:** move to a single multi-statement query (UNION ALL across the relevant tables, or a stored proc on a future engine) when the cost shows up in profile data.

---

## Connected rail — Up/Across/Down/Related is structural, not enforced

**RFC 0006 §Up / Across / Down / Related distinction.**

**What shipped:** the manifest endpoint returns the four-section shape; the renderer renders all four sections for every entity kind. The strict identity-graph vs topic distinction is mostly honored, but for `alert` and `analysis` entities the manifest currently returns generic "topic links" with empty links and an explanatory `emptyReason` — the actual cross-references (alerts → bound analysis, analysis → recent narratives) are surfaced inside the detail view itself, not via the rail.

**Status:** 🟡 Active by design. The detail views already carry the topic info; surfacing it in the rail too would duplicate. RFC 0006 explicitly allows "topic neighbors" as a fourth-section concept; we just chose not to populate it for these two kinds.

**Path back:** if user feedback says "I expected to see the bound alert in the rail when I'm on an Analysis," we wire it. Cheap when needed.

---

## Storage interface — BetterSqliteAdapter intentionally not built

**RFC 0008 acceptance criterion #7 (out-of-scope).**

> "BetterSqliteAdapter and ClickHouseAdapter are deliberately not built."

**What shipped:** matches the RFC. Worth noting because the README describes "runs on Cloudflare Workers, Node.js, Deno, Bun" — the framework supports it via the `SqlDb` seam, but no Node entry actually exists in the workspace today (no `apps/collector-node`, no `better-sqlite3` dep).

**Status:** 🟡 Active. The seam exists; the adapter lands when someone actually ships a Node deployment. Documented in the comparison doc and the storage RFC.

---

## Resources dashboard — Linux hosts mode is conditional render only

**RFC 0009 acceptance criterion #2.**

**What shipped:** the dashboard fetches `/internal/platform/hosts` in parallel with the existing Cloudflare endpoint. If hosts come back empty, the section renders nothing (the existing Cloudflare panels still work). If hosts have data, a per-host grid renders below.

**Status:** 🟡 Active. The "auto-detect mode" framing in the RFC is more elaborate than what shipped — there's no UI toggle between Cloudflare and Linux modes; both render together when both are present. Acceptable for now; revisit if either side becomes overwhelming.

---

## Replay viewer — own interactions panel + connected rail rendered side-by-side

**RFC 0006 + RFC 0004 Phase 1.10.**

**What shipped:** the replay session detail renders **both** the bespoke "Interactions in this session" panel (Phase 1.10, click→trace bundles) **and** the generic ConnectedRail (Phase 3.7). They overlap in coverage — the rail also surfaces interaction-derived neighbors.

**Status:** 🟡 Active. The bespoke panel is visually richer (it bundles click + caused traces with visible status), so we kept both. A future polish pass could fold the click-bundle UX into the rail itself and drop the bespoke panel.

**Path back:** when `<ConnectedRail />` grows a richer "grouped" rendering mode, the bespoke panel can be retired.

---

## Index of resolution commits

All six closures land in a single `feat/unified/close-gaps` branch.
After merge to `feat/unified-stack`, replace the placeholder with the
actual hash.

| Item | Branch | Hash |
|---|---|---|
| Ingest-time pprof parsing | feat/unified/close-gaps | (TBD) |
| `startProfiler()` wrapper | feat/unified/close-gaps | (TBD) |
| Server-side pre-filter | feat/unified/close-gaps | (TBD) |
| Service map source filter (RFC 0009 #3) | feat/unified/close-gaps | (TBD) |
| Connected rail profile entity (RFC 0009 #5) | feat/unified/close-gaps | (TBD) |
| Connected rail synthetic tests | feat/unified/close-gaps | (TBD) |

---

## Live verification — what was exercised vs what stays gated

This section tracks acceptance criteria against the **synthetic seed** (`pnpm seed`) currently in
`packages/obs-collector/scripts/`. Verified live against the local dev stack on 2026-05-05.

### ✅ Live-verified against synthetic seed

- **Phase 6.4 — Connected rail rendered for every entity kind.** Span detail
  (trace `ba10bdc031d96170` → span `dfc6a5c960a3057c`), Log detail
  (`Connection timeout`), AI call (`gpt-4o-mini` LLM span), Alert (`Spike in
  span errors`) — all four entity kinds render `CONNECTED — <KIND>` with the
  Up / Across / Down / Related four-section shape. Empty sections render
  informative-absence text per RFC 0006, e.g. `Down → "No pprof profile covers
  this trace's window. Wire @obs/telemetry-sdk's startProfiler() (or run an
  eBPF agent) on the producing service to populate."`
- **RFC 0006 cross-signal join.** AI call rail surfaced `Spans in this trace:
  obs-demo · openai.chat` — IdentityIndex stitched the AI call to its parent
  trace's span sibling.
- **Phase 2 trace summary header.** Trace detail emits SELF / ⚠ UNINSTRUMENTED
  badge / SPANS / DURATION (verified `1227ms duration, SELF 1227MS, ⚠
  UNINSTRUMENTED 1` on the openai.chat span).
- **Phase 3 trace waterfall.** Inline expansion below the trace row renders the
  span hierarchy with status, duration, and selectable spans.
- **RFC 0009 #3 — service map source filter.** ALL → 4 services, 4 edges, 24
  calls. SDK → same (no spans tagged `telemetry.sdk.name="beyla"` in seed).
  EBPF → 0 services / 0 edges / 0 calls. Toggle wires through end-to-end.
- **Phase 1.10 timeline (RFC 0006 origin patterns).** Timeline renders 4
  sessions, interleaves usage / span / log events on a per-session timeline
  with deltas. Seed's `interaction · click_N` events show up but with no
  `interaction_id` propagation — see gating below.
- **Logs / AI calls / Alerts list views.** Histograms, severity filters,
  by-service/by-kind breakdowns all populated from real D1 rows.
- **RFC 0002 Stage 4 — Investigations.** All three universal investigations
  (`investigate.error_top_offenders`, `investigate.latency_outlier_attribution`,
  `investigate.log_anomaly_summary`) render with real evidence rows derived
  from the seeded telemetry: top error services {obs-demo:6, checkout-api:6,
  payments-worker:4, edge:3}, latency tail offenders, and `seed-everything` as
  the new ERROR logger ("Connection timeout"). The `CONNECTED — ANALYSIS`
  rail also renders for these pages. No LLM narrative produced because no API
  key is configured locally — the page UI handles this with explicit copy
  ("No narrative yet — the cron tick hasn't produced one for this run").

### 🟡 Gated on docker-compose demo (Phase 6.1-6.3)

These remain `[ ]` in `docs/implementation/sequencing.md`; the synthetic seed
predates the relevant SDK paths and can't exercise them:

- **RFC 0004 Mode A end-to-end.** Seed's `interaction` events are typed-string
  usage records, not full ULID interaction_ids stamped onto spans/logs. The
  rail's `RELATED → Originating click` therefore renders the informative-absence
  text "Server-originated work — not bound to a user click." That is the
  **correct** rendering for un-instrumented data, but the **happy-path** (rail
  showing the click that started a trace) needs the demo SDK overlay.
- **RFC 0007 — flame graph viewer.** No pprof profiles in the seed, so the rail's
  `Down → Profiles` correctly says "No pprof profile covers this trace's
  window." The viewer code path (Phase 4.7) only exercises against profiles
  produced by `startProfiler()` on the demo.
- **RFC 0009 #2 — Linux hosts.** Seed has no `system.*` host metrics. The
  Resources dashboard renders the Cloudflare panels and silently skips the
  Linux per-host grid. Will populate when the demo's Beyla / otel-ebpf
  exporter feeds metrics.
- **RFC 0009 #3 — eBPF-source edges.** Filter works structurally (returns 0
  when nothing matches) but the SDK→eBPF visual contrast is gated on the demo
  emitting Beyla-tagged spans.
- **RFC 0005 — uninstrumented-badge calibration.** Threshold is the RFC's
  starting heuristic; seed produces 1 `⚠ UNINSTRUMENTED` badge on the openai
  span. Calibration (whether the badge fires too often / too rarely) needs the
  Astronomy Shop demo's real trace shapes.

The Playwright matrix in `apps/web/tests/connected-rail.spec.ts` flips
`test.skip()` → active per cell as each gating item closes.

---

## How to use this doc

- When a shortcut is added, append it here with the rationale.
- When it's resolved, mark ✅ and reference the commit.
- When the umbrella RFC 0003 is closed, every entry in this doc must be either ✅ or marked acceptably deferred (with a successor RFC if it's growing).
- Reviewers read this before signing off on the RFC tree merge.
