# Comparison audit runbook

How to re-verify every competitor claim on the landing-page comparison table so we can
run it the same way every quarter. The audit re-checks each cell against the vendor's
own live docs/pricing and flags drift (Preview → GA, renames, price changes, newly
shipped capabilities that break a "—" cell).

- **Source of truth:** [`../content/docs/comparison.mdx`](../content/docs/comparison.mdx)
- **What the landing table footnotes into:** the `src-*` anchor ids in that file
- **Automated runner:** [`./comparison-audit.workflow.js`](./comparison-audit.workflow.js)
- **Cadence:** quarterly (the doc's `<Callout>` carries a "Reviewed / Next review" date), plus before any release that edits the table.

---

## The data model the audit relies on

`comparison.mdx` is structured so that every claim is independently checkable. Keep this
shape — the runner parses it:

```mdx
## Datadog

### Pricing model <a id="src-dd-pricing" />

Per-host for Infra ($15–$23/host/mo) ...           <- the assertion

- Source: [Pricing | Datadog](https://www.datadoghq.com/pricing/)   <- citation
- > *"$15 Per host, per month"*                     <- verbatim quote that backs it
```

Three required pieces per claim:

1. **Anchor id** `src-<vendor>-<axis>` on the `### ` heading — this is what the terse
   landing-page cell footnotes to.
2. **Source** — a link to the vendor's *own domain* (docs/pricing), not a third-party blog.
3. **Quote** — a verbatim phrase from that page that supports the assertion. This is what
   makes the claim falsifiable later: if the quote is gone, the claim needs review.

Nine vendors × ten axes. Vendors: Datadog, Sentry, PostHog, Honeycomb, New Relic,
Grafana Cloud, SigNoz, Uptrace, HyperDX. Axes: hosting model, pricing model, traces/APM,
structured logs, AI/LLM observability, session replay, product analytics, alerting,
cross-signal correlation, data ownership.

---

## Verdict rubric

Every claim gets exactly one verdict:

| Verdict | Meaning | Action |
|---|---|---|
| `TRUE` | Still accurate; quote (or equivalent) still present on the source. | none |
| `PARTIALLY_TRUE` | Directionally right but imprecise (e.g. "$0.10/GB" when that's a *starting* rate). | tighten wording |
| `OUTDATED` | Was true when written; vendor has since changed it. | update cell + quote + source |
| `FALSE` | Not true now (and probably wasn't). Usually a "—"/negative cell the vendor has since filled. | fix cell, high priority |
| `UNVERIFIABLE` | Source is gone / claim is an inferential negative with no explicit vendor statement. | find a citable source or soften to "not marketed" |

**Bias check:** pay special attention to cells that flatter obs-unified — a competitor
scored "—" that has since shipped the capability. Every error found in the May 2026
baseline tilted in obs-unified's favor (see below), so those are the ones a hostile
reader will catch first.

---

## Running it

### Option A — automated (preferred)

From a Claude Code session in this repo, launch the workflow. It runs three phases:
**Extract** (one agent parses `comparison.mdx` into structured claims) → **Verify**
(one agent per vendor re-fetches every cited source and assigns a verdict) → **Synthesize**
(aggregate totals + a prioritized `needsEdit` list + the next review date).

```
Workflow({
  scriptPath: 'obs-unified-docs/scripts/comparison-audit.workflow.js',
  args: { today: 'YYYY-MM-DD' }      // required: the runtime forbids Date.now()
})
```

> **Note:** Workflows are billed and spawn ~11 agents. The user must explicitly opt in
> (say "run the comparison-audit workflow"). Claude will not launch it unprompted.

Optional args:
- `today` — real date, used to compute `nextReviewDate` (= today + 3 months). Required for the date; the audit still runs without it.
- `comparisonPath` — override the default `obs-unified-docs/content/docs/comparison.mdx`.

The workflow returns `{ report, verdicts }`. Use `report.needsEdit` as the edit worklist.

### Option B — manual (no workflow)

If you can't/don't want to run the workflow, reproduce it by hand — this is exactly the
fan-out the script automates:

1. **Pull the live claims.** Read `comparison.mdx` (or fetch `https://obsunified.com#compare`)
   and list, per vendor, every cell + its source URL + quoted phrase.
2. **Fan out one checker per vendor.** Spawn a `general-purpose` agent per vendor with the
   vendor's claim list; instruct it to fetch each cited source, confirm the quote still
   appears, and return a verdict + one-line proof + source URL per claim. (Prompt template
   lives in `verifyPrompt()` inside the workflow script.)
3. **Aggregate.** Collect verdicts, total them by verdict type, and sort everything
   not-`TRUE` into a worklist (FALSE → OUTDATED → PARTIALLY_TRUE → UNVERIFIABLE).

---

## Applying the results

1. For each entry in `needsEdit`, open the `src-<vendor>-<axis>` section in
   `comparison.mdx` and apply `suggestedFix` — update the **assertion**, the **quote**,
   and the **source URL** together (a stale quote with a fresh assertion is worse than
   neither).
2. The landing-page table cell footnotes into the same anchor, so fixing the doc fixes
   the footnote. If the *cell text itself* (e.g. "—" → "✓") changed, edit the landing
   table too — search the landing component for the anchor id.
3. Bump the `<Callout>` at the top of `comparison.mdx`:
   `Reviewed <today> · Next review <report.nextReviewDate>`.
4. Commit doc + table together so the citations never drift apart.

---

## Baseline: 2026-05-31 audit

First full run. Table was **~85–90% accurate**; all errors understated competitors
(none overstated obs-unified). Headline findings:

| Vendor | Cell | Verdict | Fix needed |
|---|---|---|---|
| Grafana Cloud | AI/LLM observability ("Assistant only") | **FALSE** | Grafana shipped dedicated **AI Observability** (public preview, GrafanaCON 2026-04-21). |
| Grafana Cloud | Session replay ("—") | **FALSE** | Frontend Observability **includes Session Replay**. |
| Sentry | Hosting ("OSS self-host") | misleading | Self-host is **FSL / Fair Source**, not OSI open source. |
| PostHog | Hosting ("OSS self-host") | overstated | Self-host is a **deprecated hobby build** (~300k events/mo cap). |
| PostHog | Alerting ("on trends only") | partial | Error-tracking alerts also exist. |
| Uptrace | Pricing ("$0.10/GB") | partial | $0.10/GB is the **starting** rate (→ $0.016/GB at scale); license is AGPL-3.0. |
| SigNoz | Pricing ("$0.30/GB") | partial | Applies to traces+logs; metrics are per-million-samples. |
| New Relic | Product analytics ("browser-only") | partial | No standalone product; RUM analytics also on mobile. |
| Datadog | Traces ("OTLP in Preview") | nuance | True for the *direct* intake endpoint; Agent-based OTLP is GA. |

Fully accurate rows at baseline: **Datadog, SigNoz, Honeycomb, HyperDX** (and most of
New Relic / Uptrace). Priority next time: re-check every "—"/"Assistant only"/Preview/beta
cell first — those are where vendors move fastest.
