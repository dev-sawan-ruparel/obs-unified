# Comparison audit runbook

How to re-verify competitor claims against live vendor sources.
The audit re-checks each cell against the vendor's own live docs/pricing and flags drift
(Preview → GA, renames, price changes, newly shipped capabilities that break a "—" cell).

- **Current ledger (2026-10-13, manual pass):** [`../../../docs/comparison-full-audit-2026-10-13.md`](../../../docs/comparison-full-audit-2026-10-13.md)
  — 81 of 90 cells directly source-checked against primary pages (historical claims compared with the live page and corrected where needed); 9 inferential negatives rendered as "Not marketed†".
  Verdicts on the historical claims: TRUE 59 · PARTIALLY_TRUE 12 · OUTDATED 9 · FALSE 1 · UNVERIFIABLE 9.
- **Historical ledger (2026-10-11):** [`../../../docs/comparison-full-audit-2026-10-11.md`](../../../docs/comparison-full-audit-2026-10-11.md)
  *(preserved unchanged; recorded 0/90 verified and led to the matrix being withheld until this pass)*
- **Historical claim baseline commit:** `e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58`
- **Public evaluation doc:** [`../content/docs/comparison.mdx`](../content/docs/comparison.mdx) (per-vendor sections with anchors `src-<vendor>`, cited and dated)
- **Landing-page table:** `apps/website/src/sections/compare.ts` (vendor headers link to the `src-<vendor>` anchors)
- **Consistency check:** `pnpm --filter presence comparison:check` (also part of `pnpm check:surfaces`) verifies review-date parity, ledger existence, verdict counts, ledger indices exactly 1..90, and vendor anchors.
- **Automated runner:** [`./comparison-audit.workflow.js`](./comparison-audit.workflow.js) (optional; billed, spawns ~11 agents, requires explicit opt-in)
- **Next review:** 2027-01-13, or sooner on a right-of-reply correction.

---

## Baseline extraction

The workflow runner parses the *historical* 90-anchor structure (`src-<vendor>-<axis>` headings). The current public `comparison.mdx` uses per-vendor tables with `src-<vendor>` anchors instead, so the runner requires an explicit path to an MDX file in the historical format.

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

1. Create a new dated ledger `docs/comparison-full-audit-YYYY-MM-DD.md` (never rewrite an older one). For each cell record: historical claim, verdict, corrected claim, final URL read (note redirects), access date, and a verbatim excerpt. Keep the verdict-count header line in the same format; `comparison-check.mjs` parses it.
2. Negatives: never infer absence from silence. Record exactly what was read (product index, docs navigation, sitemap) and keep the verdict `UNVERIFIABLE`; public copy renders these as "Not marketed†".
3. Update the vendor tables in `comparison.mdx` (claim, source link, excerpt) and the `<Callout>` review date / counts; append accepted changes to the Corrections log.
4. Update `ROWS`, `LAST_REVIEWED`, `AUDIT_LEDGER_URL`, and the cell-count constants in `apps/website/src/sections/compare.ts`. Cells render as neutral text (no scoring marks); only inferential negatives get a †.
5. Run `pnpm check:surfaces`, `pnpm --filter presence build`, and `pnpm --filter obs-unified-docs types:check && pnpm --filter obs-unified-docs build`.
6. Commit doc, website, and ledger together so citations and public claims never drift apart.

---

## History

- **2026-05-31:** initial draft baseline (9 vendors × 10 axes) published with citations.
- **2026-10-11:** evidence-integrity review recorded 0 of 90 cells independently verified against live primary sources; the public matrix was withheld and replaced by a product-evaluation guide.
- **2026-10-13:** full manual pass (runbook Option B, no workflow). Every cited page was fetched directly; 81/90 directly source-checked (59 still accurate, 12 tightened, 9 outdated, 1 false), 9 inferential negatives. Notable corrections: PostHog shipped OTLP distributed tracing (beta, Jul 2026); Datadog added BYOC Log Management; Grafana Session Replay is public preview (we had overstated it); Honeycomb Agent Timeline and Grafana Agent Observability reached GA. The matrix was restored to the public site with per-cell citations and the † convention.
