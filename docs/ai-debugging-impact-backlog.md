# AI Debugging Impact Backlog

This backlog orders the next implementation slices by how much they help agents
debug production issues faster. It complements [RFC status](rfc-status.md): the
RFC status file tracks broad implementation state, while this file tracks the
next agent-debugging work queue.

Status legend:

- [ ] Not started.
- [~] Partial or needs audit/validation before implementation.
- [x] Complete.

## Execution Rules

- Work one item at a time unless file ownership is clearly disjoint.
- Prefer backend/data-model causality first, then UI pivots, then live proof.
- Keep RFCs as design records. Update this backlog and `docs/rfc-status.md`
  when work lands.
- For code changes, each PR should include focused tests and a note on how it
  improves agent debugging.

## Recommended Work Distribution

This work should run as coordinated tracks rather than a single serial queue.
Codex should own repo implementation, tests, PRs, and integration. Gemini should
own broader UX/product audits, journey design, fixture plans, and critique that
does not require directly changing the repo.

### Track A — Codex Primary: Causality Spine

**Owns:** items 1, 2, and coordination across all implementation tracks.

**Why Codex primary:** these changes touch shared backend contracts,
IdentityIndex, Connected Rail manifests, dashboard navigation, and tests. They
are the highest-risk/highest-impact implementation path.

**Initial implementation order:**

1. Raw signal -> exact action/tool/agent back-links.
2. Profile as a first-class Connected Rail source.
3. Update `docs/rfc-status.md` and this backlog as checkboxes land.
4. Open/merge small PRs rather than batching the whole backlog.

**Expected outputs:**

- Backend manifest additions with deterministic tests.
- Minimal dashboard changes only when the backend contract is stable.
- PR descriptions that explain how each slice shortens AI debugging paths.

### Track B — Codex Subagent 1: Structured Evidence Contract

**Owns:** item 4 and parts of item 8.

**Scope:**

- `packages/obs-collector/src/lib/analyses-store.ts`
- `packages/obs-collector/src/analyses/*`
- AskBox/Ask response types and tests.
- Shared type definitions if the evidence shape belongs in `@obs-unified/types`.

**Task:** implement a normalized evidence contract that alerts,
investigations, evaluations, and AskBox can share.

**Expected outputs:**

- `EvidenceReference` shape with entity kind, entity id, route, source,
  confidence, reason, and suggested next pivots.
- Backward-compatible API changes.
- Tests proving old payloads still work and new evidence can drive deterministic
  pivots.

### Track C — Codex Subagent 2: Operational Drilldowns and Eval Depth

**Owns:** items 6 and 10.

**Scope:**

- `packages/obs-collector/src/lib/action-aggregates.ts`
- `packages/obs-collector/src/plugins/action-routes.ts`
- aggregate dashboard files for Tool Reliability, Cost Attribution, Autonomous
  Review, and Agent Version Diff.
- eval case store/routes only if the drilldown work does not conflict.

**Task:** make aggregate rows traversable to concrete evidence, then deepen the
production-to-eval runner model.

**Expected outputs:**

- Aggregate rows include exemplar action/tool/run/trace references.
- Dashboard drilldowns link to concrete evidence.
- Follow-up design/patch for durable eval run records and candidate comparison.

### Track D — Codex Subagent 3: Framework Wrapper or MCP Audit

**Owns:** item 9 or item 13, depending on priority.

**Option 1 — OpenAI Agents wrapper:**

- Create `packages/agents-openai` only after confirming the target OpenAI Agents
  SDK API surface.
- Mirror the Vercel/LangGraph wrapper style.
- Add privacy-first tests.

**Option 2 — MCP audit evidence:**

- Define an allow-listed MCP audit envelope.
- Persist redacted transport context when enabled.
- Render audit metadata on tool/action detail pages.

**Expected outputs:**

- One narrow package/feature PR, not both at once.

### Track E — Gemini: Agent Journey and UX Critique

**Owns:** product review for items 1, 2, 4, 8, 11, 12, 14, and 15.

**Why Gemini:** these benefit from broad UX thinking, journey mapping, and
comparing multiple surfaces without touching code.

**Comprehensive Gemini prompt:**

```text
You are reviewing obs-unified as a product for AI-assisted production debugging.
Use docs/rfc-status.md and docs/ai-debugging-impact-backlog.md as the source
context. Focus on the agent journey: Symptom -> Evidence -> Causal Action ->
Fix Candidate.

Your task:
1. For each stage, identify what an AI debugging agent can consume today without
   scraping UI text.
2. Identify the highest-impact missing machine-readable fields, links, IDs, and
   confidence indicators.
3. Review these backlog items specifically:
   - raw signal -> exact action/tool/agent back-links
   - profile-as-source Connected Rail
   - structured evidence references
   - structured missing instrumentation gaps
   - trace/profile to workspace code references
   - causal confidence indicators
   - side-effect before/after diffs
   - side-by-side agent step comparisons
4. For each item, produce:
   - user/agent impact
   - proposed UX behavior
   - proposed API payload shape
   - edge cases
   - acceptance criteria
   - tests or screenshots needed
5. Do not edit code. Produce a prioritized implementation plan that Codex can
   execute in small PRs.
```

### Track F — Gemini: Live Scenario and Fixture Design

**Owns:** item 3 and validation support for items 1, 2, 7, and 8.

**Comprehensive Gemini prompt:**

```text
Design a reproducible scenario and fixture plan for obs-unified AI debugging.
Use docs/rfc-status.md, docs/ai-debugging-impact-backlog.md, and existing
Playwright tests as context.

Target scenarios:
1. Scenario A: user click -> backend trace -> slow span -> CPU profile ->
   originating click/session.
2. Scenario B: AI cost spike -> expensive model/provider/prompt -> agent run ->
   tool/eval evidence -> production-to-eval candidate.
3. Scenario C: missing instrumentation or eBPF/off-CPU evidence -> profile ->
   affected service/action.

Your task:
1. Define deterministic seed data or generation scripts for each scenario.
2. List exact expected entities: trace IDs, span IDs, action IDs, agent run IDs,
   tool call IDs, profile IDs, metric exemplar IDs where applicable.
3. Define the expected Connected Rail path at every step.
4. Identify which currently skipped Playwright matrix cells can be unskipped
   with existing data, which need fixture changes, and which need product work.
5. Propose stable Playwright assertions that avoid timing flake.
6. Do not edit code. Produce an implementation-ready fixture/test plan.
```

### Track G — Gemini: Privacy and Governance Design

**Owns:** review support for items 13 and 14.

**Comprehensive Gemini prompt:**

```text
Review obs-unified MCP audit evidence and side-effect before/after diff ideas
from a privacy and governance perspective. Use docs/ai-debugging-impact-backlog.md
as context.

Your task:
1. Define what MCP params._meta fields are safe to persist by default.
2. Define what must be hashed, redacted, dropped, or made opt-in.
3. Propose a redacted MCP audit envelope for tool/resource/prompt calls.
4. Propose a before/after mutation evidence model that supports debugging
   without storing raw sensitive payloads by default.
5. Include dashboard UX guidance for making risk visible without exposing
   secrets.
6. Include acceptance criteria and negative tests.
7. Do not edit code.
```

## Parallelization Plan

Start with three concurrent lanes:

1. **Codex primary:** implement item 1, raw signal -> action/tool/agent
   back-links.
2. **Codex subagent:** audit/prepare item 2, profile-as-source Connected Rail,
   in a disjoint backend route/test scope.
3. **Gemini:** run Track E or Track F, depending on whether the next priority is
   product/API shape or live validation.

After item 1 lands, split again:

1. **Codex primary:** item 2 implementation.
2. **Codex subagent:** item 4 structured evidence contract.
3. **Gemini:** privacy/governance review for MCP audit and mutation diffs.

## Gemini Implementation Plan Mapping

Gemini produced a consolidated implementation plan after Prompt A. Treat that
plan as implementation input, not as a replacement for the track model above.
The repo still has seven ownership tracks, but Gemini's output usefully groups
the work into five PR-sized execution slices:

1. **Trace code references and missing instrumentation gaps API** maps to
   Track A and backlog items 8 and 11.
2. **Structured evidence schema and causal confidence storage** maps to Track B
   and backlog items 4 and 12.
3. **UI evidence card, waterfall blindspots, and aggregate drilldowns** maps to
   Tracks B/C and backlog items 4, 6, 8, and 12.
4. **Live scenario seeds and Playwright activation** maps to Track F and backlog
   item 3.
5. **MCP auditing, allow-lists, and redaction safeties** maps to Track D/G and
   backlog item 13.

**Adopt from Gemini:**

- Use `EvidenceReference` as the common machine-readable evidence contract.
- Add an API for trace instrumentation gaps rather than requiring agents to
  recompute span parent/child math from UI state.
- Extend aggregate APIs with exemplar IDs so operational rows can pivot to
  concrete traces, actions, agent runs, tool calls, or evals.
- Use structured, environment-neutral code references instead of raw `file://`
  links as the primary API contract.
- Keep MCP audit payload capture disabled by default and allow-list only
  propagation metadata needed for debugging.

**Adjust before implementation:**

- Do not assume exact file paths or package names from Gemini's plan are current;
  verify against the repo before each PR.
- Avoid adding a new `causality_confidence` database column unless existing
  action graph metadata cannot represent explicit vs fallback confidence.
- Keep scenario seed IDs deterministic, but derive them from existing seed/test
  conventions instead of introducing unrelated fixtures.
- Treat dashboard styling suggestions as directional only; follow the existing
  dashboard design system.

## 1. Raw Signal to Exact Action / Tool / Agent Back-Links

**Status:** [~] Highest-impact partial.

**Why it matters:** An AI debugger looking at a trace, span, log, AI call, or
profile should immediately know the causing agent run, action step, and tool
call. This converts raw telemetry into causal context.

**Likely scope:**

- IdentityIndex action lookups and trace/span/log joins.
- Connected route sections for `span`, `log`, `ai_call`, and profile-related
  entities.
- Dashboard rails only after backend manifest shape is complete.

**Acceptance checklist:**

- [ ] Span rail shows causing action, agent run, and tool call when action IDs
      or derived IDs exist.
- [ ] Log rail shows action context active when the log was emitted.
- [ ] AI call rail shows agent run, sibling actions, evals, and tool context.
- [ ] Profile evidence links back to sampled action/agent context where trace
      joins exist.
- [ ] Tests cover explicit action IDs and deterministic fallback IDs.

**Suggested owner:** Codex primary or backend sub-agent.

## 2. Profile as a First-Class Connected Rail Source

**Status:** [~] Partial.

**Why it matters:** A profile/flame graph often contains the deepest root cause.
Agents need to pivot from hot code back to traces, spans, actions, agent runs,
and tools.

**Likely scope:**

- Add `profile` to Connected Rail known kinds.
- Implement `/internal/connected/profile/:id` manifest behavior.
- Link profile -> sampled traces/spans and action graph context.
- Add dashboard route/rail affordance where the profile detail is opened.

**Acceptance checklist:**

- [ ] `profile` is a valid connected entity kind.
- [ ] Profile rail surfaces sampled traces.
- [ ] Profile rail surfaces likely spans/actions when trace context exists.
- [ ] Empty states explain profiles without trace labels.
- [ ] Playwright or collector tests cover profile -> trace/span pivots.

**Suggested owner:** Codex primary or frontend/backend paired sub-agent.

## 3. Live Scenario Fixtures and Proof Artifacts

**Status:** [~] Partial.

**Why it matters:** Reproducible scenarios become canonical eval fixtures for
AI debugging agents. They prove the graph can be traversed end-to-end.

**Target scenarios:**

- Scenario A: click/root-cause/CPU profile.
- Scenario B: AI cost spike.
- Scenario C: eBPF/off-CPU or missing instrumentation.

**Acceptance checklist:**

- [ ] Fresh setup can reproduce each scenario.
- [ ] Each scenario has stable seed data or a repeatable script.
- [ ] Each scenario has an agent-debugging expected path.
- [ ] Live Playwright cells are unskipped where data is reproducible.
- [ ] Proof artifact is captured or documented.

**Suggested owner:** Gemini or Codex background thread; good fit for UX/e2e
verification.

## 4. Structured Analysis Evidence for Agents

**Status:** [~] Partial.

**Why it matters:** Agents should start from ranked hypotheses, evidence IDs,
confidence, and suggested next pivots rather than parsing narrative text.

**Likely scope:**

- Analysis result payload schema.
- AskBox/evidence/citation output shape.
- Health/Investigation APIs that expose machine-readable next steps.
- Alert/evaluation evidence shapes that avoid query-string parsing.

**Acceptance checklist:**

- [ ] Analysis results expose structured evidence references.
- [ ] Each evidence item includes entity kind, ID, route, and confidence/source.
- [ ] Alerts, investigations, evaluations, and AskBox all use a compatible
      `EvidenceReference` shape.
- [ ] Narratives remain human-readable but are not the only machine context.
- [ ] AskBox output can drive deterministic Connected Rail pivots.
- [ ] Tests cover evidence shape and backward compatibility.

**Suggested owner:** Gemini for UX copy/shape proposal; Codex for backend API
and tests.

## 5. Agent Action Graph Core Hardening

**Status:** [x] Mostly implemented; [~] hardening/audit remains.

**Why it matters:** This is the backbone that lets agents debug a story instead
of disconnected spans.

**Hardening checklist:**

- [ ] Audit raw-signal back-links against RFC 0010 acceptance criteria.
- [ ] Verify derived fallback action IDs are consistently marked as fallback.
- [ ] Verify malformed explicit IDs never enter trusted async context.
- [ ] Add regression tests for queue/async continuation if missing.

**Suggested owner:** Backend sub-agent.

## 6. Operational Aggregate Surfaces

**Status:** [x] Implemented; [~] agent-consumability can improve.

**Surfaces:**

- Tool reliability.
- Cost attribution.
- Autonomous review.
- Agent version diff.

**Why it matters:** These surfaces answer where an agent should look first:
which tool is failing, which model/prompt is costly, which autonomous writes are
risky.

**Next checklist:**

- [ ] Ensure aggregate APIs include links to exemplar actions/runs/traces.
- [ ] Ensure dashboards expose the same links through Connected Rail or direct
      routes.
- [ ] Add agent-friendly sorting defaults for highest debugging value.
- [ ] Add aggregate drilldowns so every row can lead to concrete action, tool,
      run, trace, or eval evidence.

**Suggested owner:** Codex or Gemini for UX review prompts after backend links.

## 7. Metric Exemplars and Aggregate-to-Trace Pivots

**Status:** [x] Core implemented; [~] product coverage can expand.

**Why it matters:** Exemplars bridge aggregate symptoms to concrete traces and
spans, which is crucial for AI triage.

**Next checklist:**

- [ ] Add exemplar pivots from metric/resource dashboards where relevant.
- [ ] Ensure exemplar links normalize correctly in dashboard navigation.
- [ ] Add tests for metric dashboard -> trace/span routes if a metric detail
      surface exists.

**Suggested owner:** Frontend/backend pair.

## 8. Missing Instrumentation via Self-Time

**Status:** [x] Implemented; [~] calibration pending.

**Why it matters:** It tells an agent when a trace is incomplete and where to
instrument next.

**Next checklist:**

- [ ] Calibrate self-time thresholds against demo/live traces.
- [ ] Return structured uninstrumented gap data from trace APIs so agents do not
      need to recompute parent/child span math.
- [ ] Expose missing-instrumentation evidence as structured analysis output.
- [ ] Add a suggested-next-action link from badge to docs or profiler setup.

**Suggested owner:** Gemini for UX wording; Codex for evidence/API wiring.

## 9. Framework Wrapper Coverage

**Status:** [~] Partial.

**Known state:**

- [x] Native TypeScript agent SDK.
- [x] Vercel AI wrapper.
- [x] LangGraph wrapper.
- [x] MCP context helpers.
- [ ] OpenAI Agents SDK wrapper, if still a target.

**Why it matters:** Wrappers increase the chance that users produce explicit,
high-confidence action graphs instead of relying on fallback IDs.

**Acceptance checklist:**

- [ ] Decide whether OpenAI Agents SDK is in scope now.
- [ ] If yes, add wrapper package or module with tests and docs.
- [ ] Ensure wrapper emits root/action/caused-by IDs, tool metadata, evals, and
      cost/latency fields.
- [ ] Add conformance fixture for at least one realistic run.

**Suggested owner:** Dedicated sub-agent once scope is confirmed.

## 10. Production-to-Eval Runner Depth

**Status:** [~] Baseline implemented; deeper runner loop pending.

**Why it matters:** Saving a production incident as an eval case is only the
first half of the improvement loop. Agents become more useful when they can
compare the original production failure against candidate prompts, models, or
agent versions.

**Known state:**

- [x] Eval cases can be saved from production entities.
- [x] Eval case routes and result ingestion exist.
- [~] Batch execution metadata, candidate comparison, and reusable runner
      records are not fully productized.

**Acceptance checklist:**

- [ ] Eval runs have durable run records separate from individual results.
- [ ] Results compare source production behavior to candidate behavior.
- [ ] Agent/prompt/model version dimensions are first-class in eval run output.
- [ ] Dashboard shows before/after evidence and links back to production source.

**Suggested owner:** Backend sub-agent after structured evidence contract.

## 11. Trace/Profile to Workspace Code References

**Status:** [ ] Not started.

**Why it matters:** When an agent has found a slow span or hot profile frame,
the next step is often editing source. The telemetry should expose structured
code references so agents and IDE integrations can open the right file and line
without scraping frame text.

**Important constraint:** Do not rely on browser `file://` links as the primary
contract. Use structured code references such as repository-relative path,
absolute path when known locally, line/column, symbol, and optional IDE/deep-link
adapters. Dashboard rendering can show a link/copy affordance, but the API
contract should remain environment-neutral.

**Likely scope:**

- Trace span detail payloads that already carry code or stack attributes.
- Flame graph frame/node schema.
- Dashboard span/profile renderers.

**Acceptance checklist:**

- [ ] Span detail API includes optional code references when attributes contain
      file/line/symbol data.
- [ ] Profile flame graph nodes expose file/line/symbol metadata when pprof
      carries it.
- [ ] Dashboard renders code references without breaking hosted deployments.
- [ ] Tests cover absent, relative, absolute, and redacted file paths.

**Suggested owner:** Codex backend/frontend pair after profile-as-source rail.

## 12. Causal Confidence Indicators

**Status:** [~] Partial data exists; UI/API surfacing incomplete.

**Why it matters:** Agents need to know whether a causal edge was explicitly
propagated or inferred from fallback trace/span identity. This prevents false
confidence during root-cause analysis.

**Likely scope:**

- Action graph normalizer and action attrs already carry confidence-like
  information.
- IdentityIndex and Connected Rail manifests should surface confidence on
  action links.
- Agent run/action dashboards should render low-emphasis fallback indicators.

**Acceptance checklist:**

- [ ] Action graph records expose `explicit` vs `fallback` confidence in a
      stable field.
- [ ] Connected Rail action/agent/tool links include confidence metadata.
- [ ] Agent run timeline marks fallback-derived edges.
- [ ] Tests cover explicit context, missing context, and malformed explicit IDs.

**Suggested owner:** Backend sub-agent; small dashboard follow-up.

## 13. MCP Transport Audit Evidence

**Status:** [ ] Not started; privacy-sensitive.

**Why it matters:** MCP context currently gets extracted, but debugging a bad
tool invocation may require knowing what transport metadata was present at the
boundary.

**Important constraint:** Do not persist raw `_meta` blindly. It can contain
trace context, action context, vendor data, and possibly sensitive payloads.
Store a redacted/allow-listed audit shape or hashes by default.

**Acceptance checklist:**

- [ ] Define an allow-listed MCP audit envelope for trace/action context fields.
- [ ] Persist redacted MCP transport metadata for tool/resource/prompt calls
      when enabled.
- [ ] Render audit metadata on tool/action detail pages.
- [ ] Tests verify redaction and disabled-by-default behavior.

**Suggested owner:** Backend sub-agent after structured evidence contract.

## 14. Side-Effect Before / After Diffs

**Status:** [ ] Not started.

**Why it matters:** A mutating tool call flagged as side-effecting tells an
agent where risk exists; before/after evidence tells it what actually changed
and whether the blast radius is acceptable.

**Acceptance checklist:**

- [ ] Tool/action records can attach redacted before/after summaries or artifact
      links.
- [ ] Autonomous Review exposes mutation evidence.
- [ ] Dashboard renders before/after evidence without raw sensitive payloads by
      default.
- [ ] Production-to-eval can preserve mutation evidence as source context.

**Suggested owner:** Product/API design first; implementation after privacy
rules are settled.

## 15. Side-by-Side Agent Step Comparisons

**Status:** [ ] Not started.

**Why it matters:** Aggregate version diffs show that behavior changed; step
comparisons explain how it changed for the same input case.

**Acceptance checklist:**

- [ ] Eval or version-diff APIs can return two comparable agent run/action
      trees.
- [ ] Dashboard can compare step sequences, tool choices, costs, evals, and
      traces side-by-side.
- [ ] Each differing step links back to source production/eval evidence.

**Suggested owner:** Later slice after production-to-eval runner depth.

## Gemini Work Prompts

Use this section to coordinate Gemini work. Prompt A has already been executed;
the remaining B-F work is consolidated into one comprehensive handoff prompt so
Gemini can reason across the overlaps instead of producing fragmented plans.

### Prompt A — UX / Agent Debugging Journey Review (Executed)

```text
Review obs-unified from the perspective of an AI debugging agent. Focus on the
journey from symptom -> evidence -> causal action -> fix candidate. Use the RFC
status and AI debugging backlog docs as context. Identify UX gaps where the
dashboard does not expose enough machine-readable or visible context for an
agent/user to pivot quickly. Produce a prioritized TODO list with acceptance
criteria. Do not implement code unless asked.
```

### Consolidated Prompt B-F — Fixtures, Evidence, Drilldowns, Code References, and Causal Confidence

```text
You are continuing the obs-unified AI debugging review after Prompt A.
Prompt A already reviewed the high-level agent journey from Symptom -> Evidence
-> Causal Action -> Fix Candidate. Now consolidate the remaining planning work
into one implementation-ready document.

Use these repo docs as context:
- docs/rfc-status.md
- docs/ai-debugging-impact-backlog.md
- apps/web/tests/connected-rail.spec.ts
- relevant dashboard and collector APIs if you inspect code

Do not edit code. Produce a comprehensive implementation plan that Codex can
execute in small PRs.

Cover all of the following areas:

1. Live scenario fixture plan
   - Scenario A: user click -> backend trace -> slow span -> CPU profile ->
     originating click/session.
   - Scenario B: AI cost spike -> expensive model/provider/prompt -> agent run
     -> tool/eval evidence -> production-to-eval candidate.
   - Scenario C: missing instrumentation or eBPF/off-CPU evidence -> profile ->
     affected service/action.
   - For each scenario, specify setup, seed/generation steps, expected entity
     IDs, expected Connected Rail path, and stable Playwright assertions.
   - Classify currently skipped Connected Rail matrix cells into:
     "can unskip now", "needs fixture data", and "needs product work".

2. Structured evidence contract
   - Design a normalized `EvidenceReference` object usable by alerts,
     investigations, evaluations, and AskBox.
   - Include entity kind, entity ID, route, source analysis, confidence, reason,
     citations, and suggested next pivots.
   - Propose dashboard rendering that helps humans without making the UI noisy.
   - Include backward compatibility concerns and tests.

3. Operational aggregate drilldowns
   - Audit Tool Reliability, Cost Attribution, Agent Version Diff, and
     Autonomous Review.
   - For each aggregate row, identify whether an AI debugging agent can reach
     concrete evidence: action IDs, tool call IDs, agent run IDs, trace IDs,
     eval results, profile links, or metric exemplars.
   - Produce a TODO list for adding drilldowns and stable tests.

4. Trace/profile code references and missing instrumentation API
   - Identify which span attributes, stack frame fields, or pprof metadata can
     produce structured code references such as repo-relative path, absolute
     path when available, symbol, line, and column.
   - Do not assume browser file:// links are the primary contract; prefer
     environment-neutral structured code references.
   - Audit where self-time or uninstrumented gaps are computed only in the UI.
   - Propose an API shape that exposes uninstrumented gaps for AI agents.

5. Causal confidence and MCP audit
   - Determine where explicit vs fallback action confidence is stored or
     derivable.
   - Identify where confidence is lost before reaching Connected Rail or
     dashboard payloads.
   - Propose a stable API/UI representation for explicit vs fallback causality.
   - Propose a privacy-safe MCP transport audit shape that captures only
     allow-listed context fields from params._meta.
   - Include negative tests for redaction and disabled-by-default behavior.

Output format:
- Executive summary: top 5 recommendations.
- Implementation phases: PR-sized slices, ordered by dependency.
- For each slice: owner suggestion (Codex primary, Codex subagent, Gemini,
  later), files likely touched, API shape, UI behavior, tests, and risks.
- Explicitly call out any recommendation from Prompt A that should be revised,
  de-prioritized, or merged into another slice.
```
