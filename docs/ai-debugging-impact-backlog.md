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

## Agentic Debugging Lens

Prioritize work that lets an AI debugging agent move from symptom to fix with
less guessing:

- **Machine-readable evidence:** APIs should expose entity IDs, routes,
  confidence, source, reason, citations, and next pivots.
- **Causal graph continuity:** raw spans, logs, AI calls, profiles, tool calls,
  evals, and agent runs should link back to the action that caused them.
- **Trust indicators:** every inferred edge should tell agents when it is
  explicit versus fallback-derived.
- **Concrete drilldowns:** aggregate rows should lead to exemplar actions, tool
  calls, traces, evals, or profiles.
- **Fix readiness:** once root cause is found, agents need structured code
  references, eval cases, and before/after evidence to propose and verify
  changes.

## 1. Raw Signal to Exact Action / Tool / Agent Back-Links

**Status:** [x] Implemented.

**Why it matters:** An AI debugger looking at a trace, span, log, AI call, or
profile should immediately know the causing agent run, action step, and tool
call. This converts raw telemetry into causal context.

**Likely scope:**

- IdentityIndex action lookups and trace/span/log joins.
- Connected route sections for `span`, `log`, `ai_call`, and profile-related
  entities.
- Dashboard rails only after backend manifest shape is complete.

**Acceptance checklist:**

- [x] Span rail shows causing action, agent run, and tool call when action IDs
      or derived IDs exist.
- [x] Log rail shows action context active when the log was emitted.
- [x] AI call rail shows causal/trace-level action context, evals, tool
      context, and agent run context.
- [x] Profile evidence links back to sampled action/agent context where trace
      joins exist.
- [x] Tests cover explicit action IDs and deterministic fallback IDs.

## 2. Profile as a First-Class Connected Rail Source

**Status:** [x] Implemented.

**Why it matters:** A profile/flame graph often contains the deepest root cause.
Agents need to pivot from hot code back to traces, spans, actions, agent runs,
and tools.

**Likely scope:**

- Add `profile` to Connected Rail known kinds.
- Implement `/internal/connected/profile/:id` manifest behavior.
- Link profile -> sampled traces/spans and action graph context.
- Add dashboard route/rail affordance where the profile detail is opened.

**Acceptance checklist:**

- [x] `profile` is a valid connected entity kind.
- [x] Profile rail surfaces sampled traces.
- [x] Profile rail surfaces likely spans/actions when trace context exists.
- [x] Empty states explain profiles without trace labels.
- [x] Collector tests cover profile -> trace/span pivots.
- [x] Dashboard route/rail affordance opens a profile as the primary entity.
- [x] Playwright coverage proves profile -> trace/span pivots.

## 3. Live Scenario Fixtures and Proof Artifacts

**Status:** [~] Partial.

**Why it matters:** Reproducible scenarios become canonical eval fixtures for
AI debugging agents. They prove the graph can be traversed end-to-end.

**Proof format:** Use
[AI Debugging Scenario Proof Format](ai-debugging-scenario-proof.md) for
scenario IDs, seed commands, environment assumptions, stable lookup anchors,
expected agent-debugging paths, artifacts, freshness criteria, and pass/fail
criteria.

**Target scenarios:**

- Scenario A: click/root-cause/CPU profile.
- Scenario B: AI cost spike.
- Scenario C: eBPF/off-CPU or missing instrumentation.

**Acceptance checklist:**

- [ ] Fresh setup can reproduce each scenario.
- [ ] Each scenario has stable seed data or a repeatable script.
- [x] Each Scenario A/B path has an audited agent-debugging expected path and
      reusable proof artifact schema.
- [ ] Live Playwright cells are unskipped where data is reproducible.
- [ ] Proof artifact is captured or documented.

## 4. Structured Analysis Evidence for Agents

**Status:** [x] Implemented.

**Why it matters:** Agents should start from ranked hypotheses, evidence IDs,
confidence, and suggested next pivots rather than parsing narrative text.

**Likely scope:**

- Analysis result payload schema.
- AskBox/evidence/citation output shape.
- Health/Investigation APIs that expose machine-readable next steps.
- Alert/evaluation evidence shapes that avoid query-string parsing.

**Acceptance checklist:**

- [x] Analysis results expose structured evidence references.
- [x] Each evidence item includes entity kind, ID, route, confidence, source,
      reason, citations, and suggested next pivots.
- [x] Investigations and AskBox use a compatible `EvidenceReference` shape.
- [x] Alert and evaluation-specific payloads expose first-class
      `EvidenceReference` objects instead of relying on embedded query context.
- [x] Narratives remain human-readable but are not the only machine context.
- [x] AskBox output can drive deterministic Connected Rail pivots.
- [x] Tests cover analysis, alert, AI evaluation, eval-case source, and legacy
      payload backward compatibility.

## 5. Agent Action Graph Core Hardening

**Status:** [x] Implemented.

**Why it matters:** This is the backbone that lets agents debug a story instead
of disconnected spans.

**Hardening checklist:**

- [x] Audit raw-signal back-links against RFC 0010 acceptance criteria.
- [x] Verify derived fallback action IDs are consistently marked as fallback.
- [x] Verify malformed explicit IDs never enter trusted async context.
- [x] Add regression tests for queue/async continuation if missing.

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

## 7. Metric Exemplars and Aggregate-to-Trace Pivots

**Status:** [x] Core implemented; [~] product coverage can expand.

**Why it matters:** Exemplars bridge aggregate symptoms to concrete traces and
spans, which is crucial for AI triage.

**Next checklist:**

- [ ] Add exemplar pivots from metric/resource dashboards where relevant.
- [ ] Ensure exemplar links normalize correctly in dashboard navigation.
- [ ] Add tests for metric dashboard -> trace/span routes if a metric detail
      surface exists.

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

## 10. Production-to-Eval Runner Depth

**Status:** [~] Baseline implemented; deeper runner loop pending.

**Why it matters:** Saving a production incident as an eval case is only the
first half of the improvement loop. Agents become more useful when they can
compare the original production failure against candidate prompts, models, or
agent versions.

**Known state:**

- [x] Eval cases can be saved from production entities.
- [x] Eval case routes and result ingestion exist.
- [x] Durable eval run records capture batch execution metadata and candidate
      dimensions.
- [~] Dashboard candidate comparison is not fully productized.

**Acceptance checklist:**

- [x] Eval runs have durable run records separate from individual results.
- [x] Results expose source production links beside durable candidate run
      context.
- [x] Agent/prompt/model version dimensions are first-class in eval run output.
- [ ] Dashboard shows before/after evidence and links back to production source.

## 11. Trace/Profile to Workspace Code References

**Status:** [x] Implemented for span and profile code-reference contracts.

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

- [x] Span detail API includes optional code references when attributes contain
      file/line/symbol data.
- [x] Profile flame graph nodes expose file/line/symbol metadata when pprof
      carries it, and the profile metadata API exposes opt-in frame summaries
      through `?frames=true`.
- [x] Dashboard renders code references without relying on browser `file://`
      links as the primary contract.
- [x] Tests cover span/profile extraction and source-linked frame summary
      behavior.

## 12. Causal Confidence Indicators

**Status:** [x] Implemented for stable confidence fields and dashboard surfacing.

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

- [x] Action graph records expose `explicit` vs `fallback` confidence in a
      stable field.
- [x] Connected Rail action/agent/tool links include confidence metadata.
- [x] Agent run/action dashboards surface confidence indicators.
- [x] Tests cover explicit context, missing context, and malformed explicit IDs.

## 13. MCP Transport Audit Evidence

**Status:** [x] Implemented with allow-listed MCP audit envelopes.

**Why it matters:** MCP context currently gets extracted, but debugging a bad
tool invocation may require knowing what transport metadata was present at the
boundary.

**Important constraint:** Do not persist raw `_meta` blindly. It can contain
trace context, action context, vendor data, and possibly sensitive payloads.
Store a redacted/allow-listed audit shape or hashes by default.

**Acceptance checklist:**

- [x] Define an allow-listed MCP audit envelope for trace/action context fields.
- [x] Persist redacted MCP transport metadata for explicit tool/resource/prompt
      audit envelopes.
- [x] Render audit metadata on tool/action detail pages and graph evidence
      badges.
- [x] Tests verify accepted audit envelopes and raw `_meta` rejection.

## 14. Side-Effect Before / After Diffs

**Status:** [x] Implemented for explicit redacted mutation evidence.

**Why it matters:** A mutating tool call flagged as side-effecting tells an
agent where risk exists; before/after evidence tells it what actually changed
and whether the blast radius is acceptable.

**Acceptance checklist:**

- [x] Tool/action records can attach redacted before/after summaries or artifact
      links.
- [x] Autonomous Review exposes mutation evidence.
- [x] Dashboard renders before/after evidence without raw sensitive payloads by
      default.
- [x] Production-to-eval can preserve mutation evidence as source context.

## 15. Side-by-Side Agent Step Comparisons

**Status:** [x] Implemented for exemplar run/action comparisons.

**Why it matters:** Aggregate version diffs show that behavior changed; step
comparisons explain how it changed for the same input case.

**Acceptance checklist:**

- [x] Eval or version-diff APIs can return two comparable agent run/action
      trees.
- [x] Dashboard can compare step sequences, tool choices, costs, evals, and
      traces side-by-side.
- [x] Each differing step links back to source production/eval evidence.
