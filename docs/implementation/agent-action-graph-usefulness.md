# Making the agent action graph useful

Companion to [agent-action-graph.md](./agent-action-graph.md). This is a
post-fix usefulness pass, grounded in a direct read of the code as of
2026-06-01. The implementation is now ahead of the checklist in several places,
so the question has shifted from "what is missing?" to "what makes this useful
enough to adopt and keep using?"

## Correct the Record First

The implementation doc still under-reports what exists. Verified by reading
source and tests:

- **Phase 6 is built, but not fully reflected in the checklist.** All four
  operational views now exist end to end: backend aggregate routes
  (`/internal/actions/aggregates/{tool-reliability,cost-attribution,version-diff,autonomous-review}`)
  in
  [action-routes.ts](../../packages/obs-collector/src/plugins/action-routes.ts),
  aggregate queries in
  [action-aggregates.ts](../../packages/obs-collector/src/lib/action-aggregates.ts),
  and dashboards for tool reliability, cost attribution, version diff, and
  autonomous review in
  [packages/dashboard/src/dashboards](../../packages/dashboard/src/dashboards).
- **Phase 7 is backend-present, UI-incomplete.** Eval-case storage, store logic,
  and `POST/GET /internal/eval-cases` exist. The missing piece is the user-facing
  "save as eval case" flow from agent run, action, and tool-call surfaces.
- **The earlier critical gaps are closed.** Persisted agent run cost/latency
  rollups now aggregate child action data, Phase 0 fixtures are load-bearing in
  conformance tests, the run view renders profiles and guardrails, dashboards use
  real aggregate endpoints, and MCP propagation carries flat action keys plus
  `tracestate` and `baggage`.

So the honest framing is not "we still have a demo." It is: **a large, working
surface area has been built faster than the checklist tracks, and faster than
we have validated that users will return to it daily.**

## What Still Matters

Two gaps matter most now:

1. **Framework wrappers.** OpenAI Agents SDK, LangGraph, and Vercel AI SDK remain
   unchecked. This is the adoption gate. Without a wrapper, teams either
   hand-instrument with the manual agent SDK or must already emit compatible OTel
   GenAI / OpenInference spans.
2. **Save as eval case UI.** The backend loop exists, but the clickable product
   path does not. This is what makes the production-to-eval story real instead of
   API-only.

Everything else in RFC 0010 is present enough to validate with a real workflow.

## The Wedge

Every agent-observability competitor gives an LLM trace waterfall. The
differentiator here is **same data, new shape**: because action identity rides on
signals obs-unified already collects, one agent run can link to the backend
trace, logs, session replay, profiles, evals, artifacts, and tool calls for the
same request.

That cross-signal view is the reason to choose this over a dedicated LLM-obs
tool. It is now real enough to lead with, and important enough not to bury under
more speculative breadth.

## The Risk Has Changed

The failure mode is no longer "incomplete." It is:

- **Surface area without validated usage.** Four operational dashboards, replay,
  and an eval backend exist. Unit and route tests pass, but that is not the same
  as proving a user got an answer they could not get elsewhere.
- **Stale tracking that hides the state.** Because docs lag code, it is easy to
  keep adding instead of closing the loop on what exists.
- **A missing on-ramp.** None of the built surface matters if realistic agent
  data cannot get in. A single good framework wrapper is now higher leverage than
  another dashboard.

## Recommended Sequence

1. **Reconcile the checklist** with reality. Mark Phase 6 done, Phase 7 backend
   done / UI pending, MCP propagation complete, and remove stale gap claims.
2. **Land one framework wrapper** for the stack earliest users actually run.
   This unlocks the existing surface for real data.
3. **Add save as eval case UI** from agent run, action, and tool-call detail
   pages.
4. **Validate one end-to-end journey with real data:** framework app ingest →
   run replay → operational view → save as eval. If that journey is better than
   the incumbent, there is a product. If not, it exposes the real gap before more
   buildout.

## Near-Term Implementation Slices

These are intentionally narrow. Each should land independently with tests.

### Slice A: Framework wrapper spike

Pick exactly one framework: OpenAI Agents SDK, LangGraph, or Vercel AI SDK. Build
the smallest wrapper that emits or propagates Agent Action Graph fields into
spans already accepted by the normalizers:

- root action id and current action id
- caused-by action id for steps and tool calls
- agent run id, name, and version when available
- tool name, side-effect marker, and approval state when available
- trace context continuity

Exit criteria: a tiny demo app using the chosen framework produces an agent run
visible in `AgentRunDashboard`, with at least one LLM child action and one tool
child action in the graph, without manual instrumentation at the call site.

### Slice B: Save as eval case UI

Wire the existing eval-case backend into the action graph surfaces:

- add a "Save as eval case" affordance on agent run, action, and tool-call detail
  pages
- prefill source ids, trace/action/run context, expected outcome, rubric shell,
  and source payload hashes or redacted payloads when available
- call the existing `/internal/eval-cases` route
- render success/error states and a link to the created eval case or eval list

Exit criteria: the wrong-invoice scenario can be opened from the action graph and
saved as an eval case through the UI, without directly calling the API.

### Slice C: Checklist reconciliation

Update [agent-action-graph.md](./agent-action-graph.md) and the gap audit so the
docs match the implementation:

- mark Phase 6 complete with links to aggregate routes, dashboards, and tests
- mark Phase 7.1 backend-complete and 7.2 pending UI
- mark MCP context propagation complete, including flat action keys,
  `tracestate`, and `baggage`
- replace stale gap claims for cost rollup, profiles/guardrails, and fixture
  conformance

Exit criteria: a reader can use the docs to choose the next task without
rediscovering already-fixed gaps.

## What Not To Build

- **No new phases or Phase 8.5 yet.** Do not add LlamaIndex, Mastra, AutoGen, or
  another framework family before one wrapper is proven useful.
- **Do not gold-plate the operational views.** Four dashboards is already broad.
  Deepen them only where a real user asks.
- **Do not expand eval infrastructure before adding the save UI.** The backend
  exists; the missing product value is the click path.

## Bottom Line

RFC 0010 is closer to useful than the checklist admits. The cross-signal
differentiator is built, and the operational/eval surfaces exist. The remaining
work that changes adoption is narrow: **one framework wrapper, one save-as-eval
button, an honest checklist, and one validated end-to-end journey on real data.**
The discipline now is to stop adding surface area and start proving that what
exists earns a user's daily return.
