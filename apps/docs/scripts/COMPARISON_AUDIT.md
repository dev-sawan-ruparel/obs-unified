# Comparison audit runbook

How to re-verify competitor claims extracted from the historical baseline against live vendor sources.
The audit re-checks each cell against the vendor's own live docs/pricing and flags drift
(Preview → GA, renames, price changes, newly shipped capabilities that break a "—" cell).

- **Evidence status ledger:** [`../../../docs/comparison-full-audit-2026-10-11.md`](../../../docs/comparison-full-audit-2026-10-11.md)
  *(Note: this is the audit status record documenting 0/90 cells independently verified, not a parsable MDX claim source)*
- **Historical claim baseline commit:** `e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58`
- **Public evaluation doc:** [`../content/docs/comparison.mdx`](../content/docs/comparison.mdx)
  *(Unverified competitor tables are withheld from public rendering for launch safety)*
- **Automated runner:** [`./comparison-audit.workflow.js`](./comparison-audit.workflow.js)
- **Status:** Unverified competitor claims withheld from public rendering; 0 of 90 vendor cells independently verified against live primary sources.

---

## Baseline extraction

Because public `comparison.mdx` withholds unverified competitor tables, the workflow runner requires an explicit path to an MDX file containing the 90-cell vendor baseline.

Extract the historical 90-cell baseline from pinned commit `e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58` to a temporary file:

```bash
git show e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58:apps/docs/content/docs/comparison.mdx > /tmp/comparison-baseline.mdx
```

The runner parses the historical structure:
- Nine vendors: Datadog, Sentry, PostHog, Honeycomb, New Relic, Grafana Cloud, SigNoz, Uptrace, HyperDX.
- Ten capability axes: hosting model, pricing model, traces/APM, structured logs, AI/LLM observability, session replay, product analytics, alerting, cross-signal correlation, data ownership.
- Three required elements per claim: anchor id (`src-<vendor>-<axis>`), vendor source URL, and supporting quote/assertion.

---

## Verdict rubric

Every claim evaluated during an audit pass gets exactly one verdict:

| Verdict | Meaning | Action |
|---|---|---|
| `TRUE` | Still accurate; quote (or equivalent) still present on the source. | none |
| `PARTIALLY_TRUE` | Directionally right but imprecise (e.g. "$0.10/GB" when that's a *starting* rate). | tighten wording |
| `OUTDATED` | Was true when written; vendor has since changed it. | update cell + quote + source |
| `FALSE` | Not true now (and probably wasn't). Usually a "—"/negative cell the vendor has since filled. | fix cell, high priority |
| `UNVERIFIABLE` | Source is gone / claim is an inferential negative with no explicit vendor statement. | find a citable source or soften to "not marketed" |

**Bias check:** pay special attention to cells that flatter obs-unified — a competitor
scored "—" that has since shipped the capability.

---

## Running it

### Option A — automated (preferred)

From a Claude Code session in this repo, extract the baseline and launch the workflow. It runs three phases:
**Extract** (one agent parses the extracted baseline into structured claims; fails if 0 claims are found) → **Verify**
(one agent per vendor re-fetches every cited source and assigns a verdict) → **Synthesize**
(aggregate totals + a prioritized `needsEdit` list + proposed review date).

```
Workflow({
  scriptPath: 'apps/docs/scripts/comparison-audit.workflow.js',
  args: {
    today: 'YYYY-MM-DD',                            // required: the runtime forbids Date.now()
    comparisonPath: '/tmp/comparison-baseline.mdx'  // required: path to extracted 90-cell baseline
  }
})
```

> **Note:** `comparisonPath` is strictly required. The runner will fail with a clear error if omitted or if zero claims are extracted. Workflows are billed and spawn ~11 agents; the user must explicitly opt in.

The workflow returns `{ report, verdicts }`. Use `report.needsEdit` as the edit worklist.

### Option B — manual (no workflow)

If you cannot run the workflow, reproduce it by hand:
1. **Extract claims:** Read `/tmp/comparison-baseline.mdx` and list, per vendor, every cell + source URL + quoted phrase.
2. **Fan out one checker per vendor:** Instruct agents or reviewers to fetch each cited primary source, verify whether assertions and quotes match live vendor pages, and assign a verdict with proof.
3. **Aggregate:** Collect verdicts and sort unverified/outdated claims into a priority worklist.

---

## Applying the results

1. For each verified update, record the accepted primary source update, quoted excerpt, and verdict in the audit ledger (`docs/comparison-full-audit-2026-10-11.md`).
2. When full audit runs independently verify capability cells against live primary sources, verified updates can be recorded in doc corrections.
3. Update the `<Callout>` at the top of `comparison.mdx` with the updated audit status, verdict counts, and review dates.
4. Commit doc + audit ledger together so citations and public claims never drift apart.

---

## Historical baseline context (2026-05-31 draft baseline)

The initial comparison draft established the 9-vendor × 10-axis capability matrix. Under strict evidence integrity, the subsequent audit ledger in [`docs/comparison-full-audit-2026-10-11.md`](../../../docs/comparison-full-audit-2026-10-11.md) recorded 0 of 90 cells independently verified against live primary sources, leading to the launch-safety decision to withhold the unverified matrix from public rendering until complete primary source fetches are performed.
