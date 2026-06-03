# AI Debugging Scenario Proof Format

This document defines the reusable proof artifact for AI-debugging scenarios and
audits the current Scenario A and Scenario B paths. It is intentionally a proof
contract, not an implementation plan for backend APIs or dashboards.

## Proof Artifact Schema

Each live proof, recorded proof, or Playwright unskip should fill one cell using
this shape:

| Field | Required content |
| --- | --- |
| Scenario ID | Stable ID such as `scenario-a-click-cpu-profile` or `scenario-b-ai-cost-spike`, plus the owning UX/spec link. |
| Seed command | Exact command sequence, including stack startup, seed command, environment variables, project key assumptions, and whether the seed may be rerun in the same database. |
| Environment assumptions | Required services, dashboard URL, collector URL, password, browser requirements, clock/time-window assumptions, provider/network assumptions, and whether the proof is CI-safe. |
| Stable entities/IDs | Literal IDs when deterministic; otherwise stable lookup anchors such as user email, display name, model, service, route, span name, profile type, or scenario marker. Mark random/time-derived IDs as discovered values. |
| Expected agent-debugging path | Ordered pivots an AI debugging agent should take from symptom to root-cause context, including the exact entity kind at each hop and the rail/API field expected to expose the next hop. |
| Required screenshots/artifacts | Screenshots, trace/profile URLs, rail manifests, API JSON snippets, pprof blobs, Playwright traces, or terminal logs needed to prove the path without re-running it. |
| Freshness criteria | Maximum acceptable age of seed data, time-window settings, and evidence that the proof was captured after the seed and against the intended commit/config. |
| Pass/fail criteria | Machine-checkable assertions and human proof checks. Include required populated links and required informative absences. |

Recommended artifact filename:
`proofs/<scenario-id>/<YYYY-MM-DDThhmmssZ>/proof.md`, with sibling screenshots
and JSON files named by hop number.

## Shared Rules

- Prefer stable semantic anchors over brittle literal IDs unless the fixture
  deliberately creates deterministic IDs.
- A proof cell may be unskipped only when it discovers its starting entity from
  stable data and all downstream assertions are bounded, fresh, and CI-safe.
- A proof must record both populated pivots and important informative absences.
  For example, `Replay absent: no interaction_id` is a valid pass condition
  when the scenario expects a server-side retry path.
- The path is the product contract. Screenshots are evidence, but the pass/fail
  criteria should be expressible as API or DOM assertions wherever possible.

## Scenario A: Click / Root Cause / CPU Profile

Scenario ID: `scenario-a-click-cpu-profile`.

Owning spec: [docs/ux/click-to-cpu.md](ux/click-to-cpu.md) Scenario A.

Expected path:

| Hop | Agent-debugging expectation |
| --- | --- |
| 1. Symptom | Start from a user/session, alert, analysis, or trace indicating slow checkout/payment behavior. |
| 2. Session or trace | Pivot to a trace or span for the affected request. If starting at session/replay, the join is through `interaction_id` and `session_id`. |
| 3. Hot span | Identify the slow/root span, such as `payment.charge`, by trace waterfall duration, self-time, or analysis evidence. |
| 4. CPU profile | The span or trace rail exposes a CPU profile link through `profile_trace_index`; the profile URL preserves `trace_id` filtering. |
| 5. Hot frame | The profile shows the hot function/frame and enough frame metadata to explain the root cause or propose a code-edit target. |
| 6. Action context | If action IDs exist, profile/span/trace rails expose causing action, agent run, tool call, and eval context. If absent, the rail must clearly show informative absence rather than inventing causality. |

Current deterministic coverage:

- `packages/obs-collector/src/plugins/connected-routes.test.ts` has a
  deterministic acceptance contract named
  `Scenario A walks session -> hot span -> CPU profile -> originating click`.
  It proves the rail path `session -> trace/span -> CPU profile` and
  `span -> originating click` with fixed IDs:
  `sess-root-cause`, `trace-a`, `span-hot`, `prof-cpu`, and `ix-checkout`.
- `apps/web/tests/dashboards.spec.ts` has mocked dashboard coverage proving a
  profile can render as a primary connected entity and pivot to a sampled trace.
- The backlog marks profile connected-rail support complete, including
  profile-to-trace/span pivots and Playwright coverage for mocked dashboard
  behavior.

Current live proof gaps:

- `scripts/seed-everything/run.mjs` does not seed a deterministic pprof blob or
  `profile_trace_index` row for the checkout/payment path. It creates random
  trace IDs, random span timing, and no CPU profile fixture.
- The seed alert named `Slow checkout p95 (paused)` is disabled and queries
  `POST /checkout`, while seeded trace names currently include
  `POST /api/checkout`. That alert is useful as a narrative marker, not a live
  deterministic proof start.
- The UX Scenario A narrative references `payment-svc`, `payment.charge`, and a
  concrete CPU hot frame. The current generic seed uses services such as
  `checkout-api` and `payments-worker`, but does not guarantee the exact
  service/span/profile/hot-frame chain.
- Live replay chunks still require a real browser action, so replay screenshots
  should remain manual or gated until a browser-safe replay seed exists.

Scenario A proof cell status:

| Cell | Recommendation |
| --- | --- |
| Collector rail API: session -> hot span -> CPU profile -> click | Already deterministic at unit level; keep as always-on unit coverage. |
| Dashboard mocked profile -> trace rendering | Already deterministic; can stay always-on. |
| Live stack trace -> span with session/interaction | Can be considered for a gated unskip only if the test discovers by session marker and does not require a profile. |
| Live stack span -> CPU profile -> hot frame | Must remain gated or skipped until the seed creates a deterministic CPU profile and indexed trace join. |
| Alert/analysis -> checkout exemplar -> profile | Must remain gated until alert evaluation, exemplar binding, and profile fixture are deterministic and aligned on route/service names. |

## Scenario B: AI Cost Spike

Scenario ID: `scenario-b-ai-cost-spike`.

Owning spec: [docs/ux/click-to-cpu.md](ux/click-to-cpu.md) Scenario B and
[apps/web/tests/scenario-b-ai-cost-spike.spec.ts](../apps/web/tests/scenario-b-ai-cost-spike.spec.ts).

Expected path:

| Hop | Agent-debugging expectation |
| --- | --- |
| 1. Aggregate/cost surface | Start from AI/cost overview, cost attribution, or model/provider aggregate showing a concentrated spend spike. |
| 2. Heavy spender | Identify the top user or session by total AI cost. The current seed marks the user as `Heavy Spender (seed)` / `heavy-spender@seed.local`. |
| 3. Session | Pivot to the latest/heaviest session for that user. The rail must expose spans and AI calls for the session. |
| 4. Exemplar AI call | Select an exemplar AI call with model/provider/cost/tokens and trace/span identity. |
| 5. Action context | From the AI call or span, expose action, agent run, tool call, and eval context when present. Missing agent/action context must be explicit and not treated as a pass for agent-debugging completeness. |
| 6. Root cause | Use replay/interaction, trace, tool context, prompt/model/version, or eval evidence to explain why spend spiked and what agent behavior should change. |

Current seed data:

- `scripts/seed-everything/run.mjs` creates four usage sessions with
  time-derived `sessionId` and `visitorId` values.
- The last session is the heavy spender. `seedAi` places 8 of 12 AI calls into
  that session and forces those calls to `anthropic` / `claude-3-5-haiku` with
  larger token counts and higher cost.
- `seedUserProfiles` identifies every seeded visitor. The last user has stable
  semantic anchors: name `Heavy Spender (seed)`, email
  `heavy-spender@seed.local`, and property `heavy_spender: true`.
- AI spans and denormalized `/v1/ai` calls carry `session.id`; heavy-session
  calls also carry `user.id` and usually `obs.interaction.id`.

Current gated Playwright coverage:

- [apps/web/tests/scenario-b-ai-cost-spike.spec.ts](../apps/web/tests/scenario-b-ai-cost-spike.spec.ts)
  is gated on `E2E_LIVE_STACK=1`.
- The API portion logs in, reads `/internal/ai/overview?hours=24`, groups calls
  by `sessionId`, asserts the top session dominates the runner-up by at least
  5x, opens the session connected manifest, extracts a trace, and verifies the
  span rail exposes the originating click.
- The DOM smoke portion verifies the AI tab renders a seeded model name.

Remaining reproducibility gaps:

- Literal IDs are not deterministic. `visitorBase`, `sessionRoot`, trace IDs,
  span IDs, interaction IDs, token counts, and costs are random or time-derived.
  Tests must discover the heavy session by aggregate behavior or stable user
  markers, not hard-code IDs.
- The existing Scenario B live spec proves AI overview -> heavy session ->
  trace -> originating click. It does not yet prove aggregate cost attribution
  -> exemplar action/agent/tool/eval context.
- The seed creates AI calls, but does not create a deterministic agent run,
  action graph, tool call, or eval chain for the heavy-spender AI calls.
- Dashboard navigation from aggregate row to exemplar AI call/action context
  should remain gated until the aggregate UI exposes stable exemplar links and
  the fixture creates deterministic action IDs or discoverable markers.

Scenario B proof cell status:

| Cell | Recommendation |
| --- | --- |
| AI overview aggregate -> top heavy session | Keep gated live coverage; it is currently discovery-based and bounded. |
| Heavy session -> trace/span -> originating click | Keep gated live coverage; it relies on seeded session/interaction propagation and should not run by default. |
| AI tab renders seeded model | Safe as gated smoke; do not promote to default because it needs a live stack and seed. |
| Cost attribution aggregate -> exemplar action/run/tool/eval | Keep skipped/gated until seed data includes deterministic agent action graph records for the heavy-spender path. |
| AI call -> action/agent/tool/eval connected rail | Keep skipped/gated until the heavy-spender AI call has explicit action IDs and fixture-backed tool/eval records. |

## First Unskip Recommendations

Unskip first, when a live stack job exists:

- Scenario B API proof from AI overview to heavy session to trace to originating
  click. It already discovers by aggregate behavior and is gated on
  `E2E_LIVE_STACK=1`.
- Narrow connected-rail live cells that only require seeded session,
  interaction, trace, span, log, and AI-call joins, and that can discover their
  starting entity from `/internal/*` endpoints rather than literal IDs.

Keep gated or skipped:

- Scenario A profile/hot-frame live cells until deterministic pprof ingest and
  `profile_trace_index` seed data exist.
- Alert/analysis live cells until alert evaluation produces deterministic
  exemplar links from the seeded checkout route.
- Scenario B action/agent/tool/eval proof cells until the heavy-spender seed
  includes explicit action graph records and stable exemplar links from the cost
  surface.
- Replay screenshots in CI until replay capture can be seeded without an
  interactive browser-only step.

## Minimal Proof Checklist

For each completed proof folder, include:

- `proof.md` filled from the schema above.
- `01-*.json` rail/API artifact for each machine-checked hop.
- `01-*.png` screenshots for each user-facing surface that matters to the
  claim.
- A copied seed command and test command.
- A pass/fail section listing exact assertions, including any informative
  absence that must be present.
