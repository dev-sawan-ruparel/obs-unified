# RFC 0004: Identity propagation & `interaction_id`

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-03
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Companion:** [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) Steps 5–6 (session timeline + replay→trace closure)
- **Target:** `@obs/analytics-sdk`, `@obs/telemetry-sdk`, `@obs/collector`, `@obs/types`

## Summary

Make every signal in obs-unified hang on the same skeleton of correlation keys, and add the one key currently missing: `interaction_id` — a stable identifier minted in the browser at click time and propagated to backend traces via an HTTP header. Add `session_id` to `ai_calls` (the one signal table that lacks it). Document that `metric_point` deliberately does **not** carry `session_id` — exemplars are the correct correlation primitive for aggregated metrics.

## Motivation

Per RFC 0003, the value of "unified" lives or dies in identity propagation. Today the chain breaks at one place: **the boundary between an rrweb-recorded click and the backend trace it caused**. We know the user's session. We do not know which click in that session triggered which trace. The browser fires the click, the analytics SDK records it, the app fires a fetch, the backend opens a span — and there is no shared identifier on the link between the click event and the root span.

Once `interaction_id` exists, replay-to-trace navigation goes from "scroll the timeline and guess by timestamp" to "click the button in the replay, see the trace it caused." That is the load-bearing UX move for the click-to-CPU thesis.

## Today

### What's already correct

| Key | Tables that carry it | Coverage |
|---|---|---|
| `user_id` | `user_profiles`, derived for usage events | ✅ |
| `session_id` | `usage_events` (mig 002), `session_replay_metadata` (mig 007), `telemetry_spans` (mig 022), `logs` (mig 022), `ai_span_payloads` (mig 021) | ✅ for these |
| `trace_id` | `telemetry_spans`, `logs`, `ai_calls` (mig 005), `ai_span_payloads` | ✅ — but only on records the SDKs explicitly emit it on (see Gap 5 below) |
| `span_id` | `telemetry_spans` (with `parent_span_id`) | ✅ |

### Gaps

1. **No `interaction_id` anywhere.** `grep -r interaction_id` returns nothing. Replay → trace navigation is by `(session_id, ts)` only — approximate, breaks on concurrent fetches.
2. **`ai_calls` lacks `session_id`.** It carries `trace_id` ([migration 005](../packages/obs-collector/src/migrations/005_ai_calls.sql)) but no session. To go from an AI call to the user session that triggered it, we have to join through the parent trace's spans. Two-hop, slow, often misses (some AI calls aren't tied to a trace).
3. **`metric_point` exemplars are not indexed.** Metrics carry `service_name` and `attributes_json`. Exemplars (the correct mechanism for "which trace contributed to this metric point") exist as `exemplars_json` per-point — readable but not indexed, so reverse-lookup ("which metric points reference this trace_id?") is a full scan. Out of scope for this RFC; flagged as follow-up. Adding `session_id` as a column to `metric_point` would defeat the aggregation purpose of metrics and is **not** proposed.
4. **No documented contract for `session_id` shape.** Today it's whatever the analytics SDK mints. We need a written invariant: "session_id is opaque, ≤ 128 chars, stable for the duration of a browser session, injected by the analytics SDK on every emitted record." Without this, a future SDK or a self-instrumenting backend could mint conflicting formats.
5. **`@obs/analytics-sdk` does not instrument the user app's outbound `fetch` at all.** [usage-tracker.ts](../packages/analytics-sdk/src/usage-tracker.ts) uses `fetch` only to push events back to the collector (lines 213, 323, 341, 372, 459); it does not patch the global `fetch` to inject correlation headers on the user's app traffic. There is no `traceparent` injection, no `addEventListener` hook, no handler-stack mechanism. **Mode A in the proposed design is greenfield work** — we are not extending an existing fetch wrapper, we are adding one.

## Proposed design

### `interaction_id` lifecycle

1. **Mint.** The analytics SDK assigns an `interaction_id` (ULID — 128 bits, time-ordered, encoded as 26 chars Crockford base32) at the moment a user-originated event handler fires. The ID is attached to:
   - the `usage_events` row for the click itself;
   - any rrweb event payloads emitted while an interaction context is active (see § Browser propagation scope);
   - any outbound `fetch` / `XMLHttpRequest` calls made while an interaction context is active.

2. **Propagate.** The SDK sets `x-obs-interaction: <id>` on outbound HTTP calls. Bespoke header, not `tracestate` (rationale below).

3. **Honor.** The backend SDK (`@obs/telemetry-sdk`)'s middleware reads `x-obs-interaction` and attaches it to the root span as a top-level field — *not* as a span attribute, to avoid cardinality explosion in the attributes index.

4. **Index.** Receivers persist `interaction_id` as a first-class column on `telemetry_spans`, `logs`, `usage_events`, and `ai_calls`.

### Browser propagation scope (the honest part)

There is no portable browser AsyncLocalStorage. The TC39 [AsyncContext](https://github.com/tc39/proposal-async-context) proposal would solve this cleanly but is at Stage 2 and not shipped. Pretending the SDK can transparently follow `interaction_id` through every async chain is the failure mode — long chains (`setTimeout`, redux thunks, state machines) silently drop the context and produce wrong joins.

We are explicit instead. Two propagation modes:

**Mode A — automatic (covers the common case).** When the SDK installs a `click` / `submit` / `keydown` listener, it pushes a fresh `interaction_id` onto a *handler stack* before user code runs and pops it on return. Outbound `fetch` and rrweb events emitted **synchronously or in microtask continuations from the handler** read the top of the stack. This covers `addEventListener("click", () => { fetch(...) })` and the common `await`-chain pattern, which is ~80% of real handlers.

**Mode B — manual (covers the rest).** For `setTimeout`, queued state-machine actions, debounced calls, etc., the SDK exposes:

```ts
import { withInteractionContext, currentInteractionId } from "@obs/analytics-sdk";

setTimeout(() => {
  withInteractionContext(savedId, () => {
    fetch("/checkout"); // carries x-obs-interaction
  });
}, 500);
```

Or, in framework integrations, a hook that snapshots the ID at click time:

```ts
function CheckoutButton() {
  const { withInteraction } = useAnalytics();
  return <button onClick={withInteraction(async () => {
    await delay(500);
    await fetch("/checkout"); // works
  })} />;
}
```

We document precisely which paths are auto-propagated and which require Mode B. **No silent best-effort guessing** — if the SDK doesn't have an active context, outgoing requests carry no header and the backend treats them as not-bound-to-an-interaction. This is preferable to a wrong join.

The `obs_interaction_id_present` metric (below) lets users measure which fraction of their actual chain is propagated and where they need Mode B.

### Header choice — bespoke vs `tracestate`

Option A (chosen): bespoke `x-obs-interaction`. Tiny, easy to debug in DevTools, no parser ambiguity.

Option B: vendor entry in W3C `tracestate` like `obs=interaction:01HFXY...`. More "correct" but `tracestate` is an undebugged comma-soup in DevTools and many corporate proxies strip non-trusted vendor entries.

We pick A and document it. If `tracestate` adoption matures we can dual-emit later.

### Schema changes

Migration `027_identity_propagation.sql`:

```sql
-- interaction_id: a click-scoped correlation ID minted by the analytics SDK.
-- See RFC 0004 for lifecycle.
ALTER TABLE telemetry_spans   ADD COLUMN interaction_id TEXT;
ALTER TABLE logs              ADD COLUMN interaction_id TEXT;
ALTER TABLE usage_events      ADD COLUMN interaction_id TEXT;
ALTER TABLE ai_calls          ADD COLUMN interaction_id TEXT;
ALTER TABLE ai_span_payloads  ADD COLUMN interaction_id TEXT;

-- session_id backfill on the two tables that don't have it yet.
ALTER TABLE ai_calls          ADD COLUMN session_id TEXT;
-- metric_point intentionally does NOT get session_id (see § Non-goals).

-- Indices: replay→trace and click→{trace,log,usage} are the hot lookups.
CREATE INDEX IF NOT EXISTS idx_spans_interaction
  ON telemetry_spans (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_logs_interaction
  ON logs (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usage_interaction
  ON usage_events (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_interaction
  ON ai_calls (project_id, interaction_id, received_at DESC)
  WHERE interaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_calls_session
  ON ai_calls (project_id, session_id, received_at DESC)
  WHERE session_id IS NOT NULL;
```

Partial indices (the `WHERE interaction_id IS NOT NULL`) keep the index small in the common case where instrumentation predates this RFC and most rows lack the column.

### SDK changes

`@obs/analytics-sdk` — all greenfield, the SDK does not patch user `fetch` or listen for user-originated DOM events today:

- Add a global `addEventListener` hook for `click`, `submit`, `keydown` on user-initiated paths. On entry, mint a ULID and push onto a handler stack. On exit, pop.
- Patch the global `fetch` and `XMLHttpRequest` to inject `x-obs-interaction` when the handler stack is non-empty (Mode A). This is the SDK's first time touching user `fetch`, so it must be opt-in via an `AnalyticsProvider` prop (`autoCorrelate?: boolean`, default true) and survive being loaded next to other instrumentation libraries that patch `fetch` (e.g. an OTel browser tracer).
- Export `withInteractionContext(id, fn)` and `currentInteractionId()` for explicit threading (Mode B).
- React helper: `useAnalytics().withInteraction(handler)` snapshots the ID at click time; the returned wrapped handler restores it for the duration of its execution.
- Attach `currentInteractionId()` to rrweb event meta payloads.

`@obs/telemetry-sdk`:

- Middleware reads `x-obs-interaction` and stores on the active span context.
- Span exporter writes it as a span field (alongside `trace_id`, `span_id`), not as a span attribute.

### Observability of propagation itself

We emit a metric so users can measure their actual chain coverage:

- **Metric:** `obs.interaction.propagation` — counter, emitted as a standard OTel metric to `metric_point`.
- **Attributes:** `signal` (one of `usage`, `span`, `log`, `ai_call`), `propagated` (boolean — was an interaction_id present on this signal record).
- **Dashboard:** Health surface tile shows `propagated=true / total` ratio per signal. Low values mean instrumentation has drifted (likely Mode B is needed somewhere).

### Session timeline grouping

The existing `/internal/timeline/:sessionId` ([timeline-routes.ts](../packages/obs-collector/src/plugins/timeline-routes.ts)) returns a flat list of session events ordered by time. Post-this-RFC, when events carry `interaction_id`, the timeline becomes a tree: events with the same interaction_id are visually grouped under their originating click, and the resulting trace's root span is shown inline directly under the click event. This is what makes [Step 5 of the UX walkthrough](../docs/ux/click-to-cpu.md#step-5--user-session-timeline) read naturally.

API change: the response shape gains an `interaction_id` field on each event and a top-level `groups: { [interaction_id]: { events: [...], rootTraceId?: string } }` derived view. The flat `events: [...]` list stays for backwards compatibility. Dashboard renders the grouped view by default; flat view is a toggle.

```ts
interface TimelineResponse {
  sessionId: string;
  events: TimelineEvent[];                 // flat, with interaction_id where present
  groups?: Record<string, {                // new — derived from events
    interactionId: string;
    clickEvent: TimelineEvent;             // the originating usage event
    causedTraces: Array<{
      traceId: string;
      rootSpanId: string;
      rootSpanName: string;
      durationMs: number;
      status: "ok" | "error";
    }>;
    relatedEvents: TimelineEvent[];        // logs/usage emitted in the trace's window
  }>;
  // ...existing fields
}
```

Events with no `interaction_id` (cron jobs, server retries, anything pre-RFC-0004) appear in the flat list but not in any group — the grouping is opt-in, not coercive.

## Acceptance criteria

The OTel Astronomy Shop demo today uses native OTel SDKs and does not include `@obs/analytics-sdk` in its frontend. End-to-end demo verification requires that integration as a prerequisite (tracked as a separate task — see [RFC 0003 § Demo SDK integration](0003-unified-stack.md#demo-prerequisites)).

1. Migration applies cleanly; on a fresh DB all five `interaction_id` columns and the `ai_calls.session_id` column exist with their partial indices.
2. **Mode A unit test:** A synthetic click handler that fires `fetch("/api")` synchronously results in the request carrying `x-obs-interaction` matching the click's `interaction_id`.
3. **Mode A microtask test:** A handler `async () => { await Promise.resolve(); fetch(...) }` propagates correctly.
4. **Mode A boundary test:** A handler `() => { setTimeout(() => fetch(...), 0) }` does **not** propagate (this is the documented limit). The metric `obs.interaction.propagation{propagated=false}` increments.
5. **Mode B test:** Wrapping the same `setTimeout` body in `withInteractionContext(...)` *does* propagate.
6. `@obs/telemetry-sdk` middleware reads `x-obs-interaction` and the resulting root span carries `interaction_id` as a top-level field.
7. `/internal/timeline/:sessionId` returns the new `groups` field alongside the flat `events` list. Each group bundles its originating click, the trace(s) that resulted, and related events emitted in the trace's window. Events without an `interaction_id` appear in the flat list only — they are not coerced into a synthetic group.
8. The replay viewer's event detail (Step 6 in the UX walkthrough) renders a "Trace caused by this click" link when the click's `interaction_id` matches at least one span's `interaction_id`. The link is absent (with the "—" informative-absence pattern from RFC 0006) when no match exists.
8. The `obs.interaction.propagation` metric appears in `metric_point` after one minute of demo traffic, with both `propagated=true` and `propagated=false` samples present (mixed real-world coverage is expected; 100% is not the bar).

## Non-goals

- **`interaction_id` on `metric_point`.** Metrics aggregate; tying a metric point to one click defeats the purpose. Exemplars (already supported via `exemplars_json`) are the correct mechanism for "which trace contributed to this metric." Out of scope.
- **Cross-tab `interaction_id` propagation.** A click in tab A that postMessages to tab B does not propagate `interaction_id`. Acceptable; tabs are usually independent sessions in practice.
- **Server-initiated work without an inbound request** (cron jobs, queue consumers). These don't have a click to attach to. They'll have `trace_id` from the consuming span; that's enough.
- **Backfilling old data.** New columns are NULLable. Existing rows stay NULL forever. No retroactive reconstruction.

## Migration risk

- **Header stripping by proxies.** Some corporate egress proxies strip headers they don't recognize. Mitigation: document a fallback where `interaction_id` is also stamped in the request body for trusted endpoints. Defer to operational complaints; ship without.
- **PII concern.** `interaction_id` is opaque random data — no PII risk. But anyone reading replay payloads and joining to trace data could fingerprint a session. The session itself already exposes that surface; `interaction_id` doesn't add to it.
- **Existing analytics SDK users.** No breaking change. Old SDK builds simply don't emit the new field; backend treats it as NULL. Roll forward at any pace.

## Open questions

- **Multiple concurrent clicks.** If a user double-clicks, the second click should mint a new `interaction_id`. The handler stack does this naturally. A click that opens a modal which programmatically fires another click is attributed to the outermost user-originated handler (the inner programmatic one inherits via the stack). Document.
- **Reuse on retry.** If a fetch fails and the SDK retries, the retry carries the same `interaction_id`. Desirable — "this click triggered three attempts" is a real story.
- **AsyncContext (TC39).** When the proposal ships, we add a third propagation mode that's automatic for the long-chain case currently requiring Mode B. The header contract doesn't change.
