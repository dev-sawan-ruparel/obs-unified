# RFC 0006: Connected rail / navigation graph

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-03
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Depends on:** [RFC 0004 — Identity propagation](0004-identity-propagation.md)
- **Companion:** [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) — worked example with the rail at every step
- **Target:** `@obs/dashboard`, `@obs/collector`

## Summary

Make every entity detail surface render a **Connected rail** — a fixed-position panel listing one-click jumps to neighboring entities (parent / children / cross-signal peers). No detail view is a dead end. The rail is the manifestation of unified-stack thinking in the UI.

This RFC ships **only UI**. No new signals, no new storage. The data already exists post-RFC 0004; this is the work that makes it visible and traversable.

## Motivation

Per RFC 0003, the test of "unified" is whether the user can get from any signal to its neighbors in ≤ 2 clicks without typing identifiers. The dashboard today fails this test in most places. Each tab loads as a list, the list links to a detail view, the detail view is a leaf — there's no edge out.

This RFC proposes the contract: **every detail view exposes its identity-graph neighbors as a sidebar of clickable links.** Nothing else changes about the views; the rail is additive.

## Today

### What cross-linking exists

| Surface | What it links | Verdict |
|---|---|---|
| [TimelineDashboard](../packages/dashboard/src/dashboards/TimelineDashboard.tsx) — per-session view via `/internal/timeline/:sessionId` ([timeline-routes.ts](../packages/obs-collector/src/plugins/timeline-routes.ts)) | spans + logs + usage + replay metadata for one session | ✅ the seed of what we want, but accessible only from the Sessions page |
| Span detail drawer in TelemetryDashboard | shows attributes; some link to logs by `trace_id` | 🟡 partial |
| Log detail drawer | shows trace_id as a link | 🟡 partial |
| Replay viewer | shows session events; no link to the trace caused by a click | ❌ — and post-0004 this becomes the headline UX |
| AI call detail | shows `trace_id` if present | 🟡 |
| Alert detail (post RFC 0002 Stage 6) | shows linked Analysis | ✅ that link exists |
| Analysis detail | shows underlying queries | 🟡 |

The pattern is uneven. Some detail views show some links, none show all. There is no shared component, no shared contract, no enforcement that "every detail view has a connected rail."

### Gaps

1. **No shared rail component.** Each detail surface implements links ad hoc, so coverage is uneven and a new dashboard ships without thinking about cross-links.
2. **Most rails are missing the diagonal jumps.** A span detail rarely links to the user session, the AI call, or the replay; it links to logs at best.
3. **No backend endpoint that returns the neighbor set in one call.** Rails today self-fetch each link's existence with separate queries. Slow; encourages skipping links that are "expensive to check."
4. **No empty-state UX for missing neighbors.** When a span doesn't have an associated replay (server-only request), the rail should say so explicitly rather than being absent — that absence is informative.

## Proposed design

### The `<ConnectedRail />` component

A single React component placed on every detail surface. Props:

```ts
type EntityKind =
  | "span"
  | "log"
  | "usage"
  | "ai_call"
  | "replay"
  | "alert"
  | "analysis"
  | "profile"        // ships with RFC 0007
  | "metric_series"; // metric-explorer detail (current Phase 1 scope: skeleton only)

interface ConnectedRailProps {
  entity: {
    kind: EntityKind;
    id: string;
    // identity-graph keys this entity carries:
    trace_id?: string;
    session_id?: string;
    interaction_id?: string;
    user_id?: string;
    project_id: string;
  };
}
```

Of the nine kinds, this RFC ships meaningful rails for the first seven (`span`, `log`, `usage`, `ai_call`, `replay`, `alert`, `analysis`). `profile` ships with RFC 0007. `metric_series` ships a stub now (links to the metric explorer) and gains real cross-signal jumps in a follow-up once exemplar indexing exists.

Renders four sections with **a deliberate distinction between identity-graph neighbors and topic/policy neighbors**:

- **Up** — *identity-graph parents*. Parent span, parent trace, owning session, owning user. Joined strictly via correlation keys (`trace_id`, `session_id`, `interaction_id`, `user_id`).
- **Across** — *identity-graph peers*. Other entities in the same identity bucket — other spans in the same trace, other logs in the same session, the AI calls this trace made, the replay covering this session. Same correlation-key join, sibling rather than parent.
- **Down** — *identity-graph children*. Child spans, profile flame graph (RFC 0007), kernel events (RFC 0009). Strictly identity-derived.
- **Related** — *topic and policy neighbors*. Alerts that mention this entity (via subject, not identity); Analyses that cite it as evidence; "similar" recommendations; deploys/incidents in the same window. **Not** identity-graph — these are joins by topic, time-window, or evidence-citation. Formalizing this lets us add useful cross-references without bending the identity-graph contract.

The first three sections are always machine-derivable from the identity skeleton (RFC 0004). The fourth ("Related") is open to future cross-cutting joins as long as each addition documents what the join key is.

### Informative-absence pattern (load-bearing)

When a section has no neighbors of a given kind, the rail renders **an explicit `—` with a tooltip explaining why**, rather than silently omitting. Examples:

- *"Replay — none (this server-side request carries no `interaction_id`; no browser click triggered it)."*
- *"Profile — none (no profile uploaded for this service in the trace's window; see RFC 0007 to enable)."*
- *"User — anonymous (session not linked to a user identity)."*

The absence itself is informative. A user looking at a slow trace and seeing "Replay — none, this was a server retry" learns something they would not learn from a missing UI element. This is not a polish detail — it is a load-bearing affordance, and an entity-detail surface that simply omits empty sections fails the rail's contract.

### Count-link pattern (for many-neighbors)

When a section's neighbor count is high (≥ 5), the rail renders a **count link** that opens a filtered list view rather than dumping every item inline. Pattern:

```
Across:
  ▸ 23 logs in this trace        →  /logs?trace_id=…
  ▸ 47 spans across 5 services   →  /traces/…   (already-open trace, scroll)
  ▸ 243 traces sampled in profile →  /profiles/prof-…/traces
```

Each count is a single one-click jump to a list scoped by the same identity key. Inline previews (the hover affordance below) still work for the count link itself — hovering shows the first 3 entries.

### Backend: `/internal/connected/:kind/:id`

One endpoint per entity returns the full neighbor manifest in a single response. The dashboard never has to chain "fetch entity → fetch link 1 → fetch link 2." Implementation lives in a new collector plugin and is consumed via the existing [`useApi()` hook](../packages/dashboard/src/use-api.ts) — no new fetcher infrastructure. The response is shaped:

```ts
interface ConnectedManifest {
  entity: { kind: EntityKind; id: string; ... };
  up: NeighborGroup[];
  across: NeighborGroup[];
  down: NeighborGroup[];
  related: NeighborGroup[];
}

interface NeighborGroup {
  label: string;       // "Parent trace", "Logs in this session", ...
  links: Array<{
    label: string;     // human-readable
    href: string;      // dashboard route
    count?: number;    // for "23 logs in this session"
    sample?: string;   // tiny preview, e.g. first log message
  }>;
  emptyReason?: string;
}
```

The endpoint is the single read path the rail uses. SQL is ~6-10 small queries fanning out from the entity's identity keys. On D1 (HTTP-backed) each query is typically ~5-30 ms; concurrent prepares serialize, so total time is roughly the sum, not the max — expect ~50-150 ms for a full manifest. Fast enough for detail-page render; if it becomes a bottleneck the manifest is a strong cache candidate (see open questions). On Node + better-sqlite3 the same fan-out is sub-ms.

### Two interaction details that matter

1. **Hover preview, not eager fetch.** The rail shows counts immediately (cheap aggregate queries), but the *content* of each neighbor is fetched only on hover, with a small inline preview. Avoids sending kilobytes of payload on every detail-page load.

2. **Time-window scoping.** "Logs in this session" can be hundreds. The rail caps to a small window around the entity's timestamp (default ±30s) and offers "see all" as a separate jump. Without this, the rail becomes a wall of text on long sessions.

### A specific UX rule

> Every dashboard that adds a new detail surface ships its `<ConnectedRail />` integration in the same PR. Code reviewers reject the PR otherwise.

This is policy, not code. The point is that "unified" stops being something we build *to*; it becomes something we cannot accidentally drift away from.

### Acceptance criteria

The umbrella RFC's bar is **≤ 2 clicks** to reach any neighbor of a starting entity. This RFC's job is the second click — the rail provides exactly one click from any open detail view to each of its identity-graph neighbors. Demo verification on the OTel Astronomy Shop, with the SDK-bound prerequisites called out in the umbrella RFC:

1. From any open rrweb replay, the rail surfaces the trace caused by each user-originated event (one rail link per event, post-RFC 0004).
2. From any open span, the rail surfaces the user session, parent trace, related logs, AI calls, and replay (when each exists). Empty neighbors render "—" with an explanation.
3. From any open log, the rail surfaces the trace, the parent span, the session, and other logs in the same session.
4. From any open AI call, the rail surfaces the trace and the user session. The provider request/response payload is rendered **inline** in the AI-call detail view (not a navigation target), since it lives on `ai_span_payloads` for the same `(trace_id, span_id)`.
5. From any open alert, the rail surfaces the bound Analysis (post-RFC 0002 Stage 6), an exemplary trace, and (post-RFC 0007) a profile when one exists.
6. From any open Analysis, the rail surfaces the alert it's bound to (if any), the recent narrative entries, and the underlying queries.

**Transition behavior:** entities ingested before RFC 0004 lack `interaction_id`. The rail handles missing keys gracefully — sections that depend solely on `interaction_id` render "— (no interaction context)"; sections keyed on `session_id` / `trace_id` continue to work. We do not synthesize fake interaction_ids for old data.

**Informative-absence acceptance:** for every entity kind, a synthetic test case exists where a given neighbor section is empty. The rail must render the section header, render "—", and a hover-tooltip with a non-generic explanation. A blank or missing section is a regression.

**Count-link acceptance:** when a neighbor count exceeds 5, the rail must render a count link to a filtered list (not the items inline). Inline preview on hover still shows the first 3.

A surface that fails any of the above is treated as a regression.

## Non-goals

- **Free-form graph navigation UI** ("show me the whole graph as a node-link diagram"). Out of scope; nice demo, low daily value. The rail is the practical surface.
- **New signals.** This RFC ships zero new ingest paths. If the data isn't already in storage, the rail says "—".
- **Cross-project navigation.** Rails are scoped to the current project. A future SSO/multi-tenant RFC may revisit.

## Open questions

- **Pagination inside the rail.** "Logs in this session: 412." We surface count and link to a filtered logs page. Should we also offer inline "next 10" within the rail? Probably no — keeps the rail tight.
- **Caching.** The manifest is cheap to compute, but caching it for 30s on the collector saves D1 reads on hot detail views. Defer until measured.
- **Mobile / narrow viewports.** Rail collapses to a top horizontal strip on narrow screens. Keep the section structure visible (tabs) so nothing is lost.
- **Rail for entities the user *might* care about even when not strict neighbors.** E.g. "users with similar behavior to this one." Speculative; deferred to an Analyses RFC.

## Implementation sketch

Order of work:

1. Build the manifest endpoint on the collector for the seven Phase-1 entity kinds (`span`, `log`, `usage`, `ai_call`, `replay`, `alert`, `analysis`). Profile and kernel-event variants arrive with RFCs 0007 and 0009.
2. Build `<ConnectedRail />` in `@obs/dashboard` with the four section structure (up / across / down / related).
3. Wire it into TelemetryDashboard's span drawer first (highest-traffic surface).
4. Wire into LogsDashboard, ReplayDashboard, AIDashboard, AlertsDashboard, InvestigationsDashboard in subsequent PRs.
5. Add the policy to `CONTRIBUTING.md` or a `CLAUDE.md` section: every detail view ships with a rail.

The component is small (probably ~300 LOC including hover-preview behavior). The endpoint is straightforward. The cultural change — "no orphan detail pages" — is the real work.
