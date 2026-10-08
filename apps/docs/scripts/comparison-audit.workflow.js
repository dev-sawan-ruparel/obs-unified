export const meta = {
  name: 'comparison-audit',
  description: 'Re-verify every competitor claim in comparison.mdx against live vendor sources',
  whenToUse: 'Run on the quarterly review cadence, or before any release that touches the landing-page comparison table, to catch vendor pricing/feature drift.',
  phases: [
    { title: 'Extract', detail: 'Parse comparison.mdx into structured per-vendor claims' },
    { title: 'Verify', detail: 'One agent per vendor re-checks every claim against its live source URL' },
    { title: 'Synthesize', detail: 'Aggregate verdicts, flag cells needing edits, propose next review date' },
  ],
}

// ---------------------------------------------------------------------------
// HOW TO RUN
//   This is a Claude Code *Workflow* script, not a standalone Node script. The
//   globals below (agent/parallel/phase/log/args) only exist inside the Workflow
//   runtime. Launch it from a Claude Code session with:
//
//     Workflow({ scriptPath: 'obs-unified-docs/scripts/comparison-audit.workflow.js',
//                args: { today: '2026-08-19' } })
//
//   `args.today` is required because the runtime forbids Date.now(); pass the
//   real date so the next-review date can be computed. `args.comparisonPath` is
//   optional (defaults below).
//
//   See ./COMPARISON_AUDIT.md for the full runbook and verdict rubric.
// ---------------------------------------------------------------------------

const COMPARISON_PATH =
  (args && args.comparisonPath) || 'obs-unified-docs/content/docs/comparison.mdx'
const TODAY = (args && args.today) || null

const VERDICTS = ['TRUE', 'PARTIALLY_TRUE', 'OUTDATED', 'FALSE', 'UNVERIFIABLE']

const CLAIMS_SCHEMA = {
  type: 'object',
  properties: {
    vendors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          claims: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                axis: { type: 'string', description: 'Capability axis, e.g. "Pricing model"' },
                anchorId: { type: 'string', description: 'The src-* anchor id on the heading' },
                assertion: { type: 'string', description: 'The factual claim the doc makes, in one sentence' },
                sourceUrl: { type: 'string', description: 'The vendor URL the claim cites' },
                quotedPhrase: { type: 'string', description: 'The verbatim quote the doc pulls from that source, if any' },
              },
              required: ['axis', 'anchorId', 'assertion', 'sourceUrl'],
            },
          },
        },
        required: ['name', 'claims'],
      },
    },
  },
  required: ['vendors'],
}

const VERDICTS_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          anchorId: { type: 'string' },
          axis: { type: 'string' },
          verdict: { type: 'string', enum: VERDICTS },
          quoteStillPresent: { type: 'boolean', description: 'Does the cited quotedPhrase still appear on the source page?' },
          evidence: { type: 'string', description: 'One sentence of proof for the verdict' },
          liveSourceUrl: { type: 'string', description: 'The URL actually checked (may differ if the cited URL moved)' },
          suggestedFix: { type: 'string', description: 'If not TRUE: the exact corrected wording for the doc/table cell' },
        },
        required: ['anchorId', 'axis', 'verdict', 'evidence'],
      },
    },
  },
  required: ['vendor', 'results'],
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two-to-three sentence overall accuracy verdict for the table' },
    totals: {
      type: 'object',
      properties: {
        TRUE: { type: 'number' },
        PARTIALLY_TRUE: { type: 'number' },
        OUTDATED: { type: 'number' },
        FALSE: { type: 'number' },
        UNVERIFIABLE: { type: 'number' },
      },
    },
    needsEdit: {
      type: 'array',
      description: 'Every claim that is not TRUE, in priority order (FALSE/OUTDATED first)',
      items: {
        type: 'object',
        properties: {
          anchorId: { type: 'string' },
          vendor: { type: 'string' },
          axis: { type: 'string' },
          verdict: { type: 'string', enum: VERDICTS },
          suggestedFix: { type: 'string' },
        },
        required: ['anchorId', 'vendor', 'axis', 'verdict', 'suggestedFix'],
      },
    },
    nextReviewDate: { type: 'string', description: 'today + 3 months, YYYY-MM-DD' },
  },
  required: ['summary', 'totals', 'needsEdit'],
}

function verifyPrompt(vendor) {
  return [
    `You are fact-checking the competitor-comparison doc for obs-unified against CURRENT public information.`,
    `Vendor under review: **${vendor.name}**.`,
    ``,
    `Below are the claims the doc currently makes about ${vendor.name}, as JSON. Each has an axis, the doc's assertion, the cited source URL, and (often) a verbatim quotedPhrase the doc pulled from that source:`,
    ``,
    JSON.stringify(vendor.claims, null, 2),
    ``,
    `For EACH claim:`,
    `1. Fetch the cited sourceUrl (use WebFetch). If it 404s or redirected, find the vendor's current equivalent page via WebSearch and note the new URL in liveSourceUrl.`,
    `2. Check whether the quotedPhrase still appears (or an equivalent statement does). Set quoteStillPresent accordingly.`,
    `3. Decide whether the assertion is still accurate as of today. Vendors ship fast — watch for: a capability that moved from Preview/beta to GA (or was newly launched), a pricing number that changed, a product rename, or a "vendor does NOT have X" negative claim that is now false because they shipped X.`,
    `4. Assign a verdict: TRUE / PARTIALLY_TRUE / OUTDATED / FALSE / UNVERIFIABLE.`,
    `   - OUTDATED = was true when written but the vendor has since changed; FALSE = not true now and likely wasn't.`,
    `   - Be skeptical and specific. Prefer the vendor's own domain as the source.`,
    `5. If the verdict is not TRUE, write suggestedFix = the exact corrected one-line wording for that cell.`,
    ``,
    `Return one result object per claim. Do not invent sources; if you cannot confirm, use UNVERIFIABLE and say why in evidence.`,
  ].join('\n')
}

function synthPrompt(vendorResults) {
  return [
    `You are aggregating a competitor-comparison audit for obs-unified.`,
    `Here are the per-vendor verdict sets as JSON:`,
    ``,
    JSON.stringify(vendorResults, null, 2),
    ``,
    `Produce a report:`,
    `- summary: 2-3 sentences on overall table accuracy and the headline problems.`,
    `- totals: count claims by verdict across all vendors.`,
    `- needsEdit: every claim whose verdict is not TRUE, sorted FALSE first, then OUTDATED, then PARTIALLY_TRUE, then UNVERIFIABLE. Carry through the suggestedFix verbatim.`,
    TODAY
      ? `- nextReviewDate: exactly three calendar months after ${TODAY}, formatted YYYY-MM-DD.`
      : `- nextReviewDate: leave as empty string (no base date was provided).`,
  ].join('\n')
}

// ---------------------------------------------------------------------------

phase('Extract')
const extracted = await agent(
  [
    `Read the file at ${COMPARISON_PATH} (use the Read tool).`,
    `It is an MDX vendor-comparison doc. Each vendor has a "## <Vendor>" section; within it, each capability axis is a "### <Axis> <a id="src-..." />" subsection followed by the doc's assertion, a "- Source: [text](url)" line, and usually a "> *"quote"*" line.`,
    `Extract every vendor and every per-axis claim into the schema: axis title, the anchorId from the <a id="..."/>, a one-sentence assertion, the source URL, and the verbatim quotedPhrase if present.`,
    `Include negative/"—" claims too (e.g. "no session replay") — set assertion to the absence claim and use the section's source if any.`,
  ].join('\n'),
  { label: 'extract-claims', phase: 'Extract', schema: CLAIMS_SCHEMA },
)
const vendors = (extracted && extracted.vendors) || []
const claimCount = vendors.reduce((n, v) => n + (v.claims ? v.claims.length : 0), 0)
log(`Extracted ${vendors.length} vendors / ${claimCount} claims from ${COMPARISON_PATH}`)

phase('Verify')
// One agent per vendor — mirrors the manual audit. Barrier here is fine: the
// synthesis step genuinely needs all vendors' verdicts together to total them.
const verified = (
  await parallel(
    vendors.map((v) => () =>
      agent(verifyPrompt(v), { label: `verify:${v.name}`, phase: 'Verify', schema: VERDICTS_SCHEMA }),
    ),
  )
).filter(Boolean)
const flagged = verified.reduce(
  (n, v) => n + v.results.filter((r) => r.verdict !== 'TRUE').length,
  0,
)
log(`Verified ${verified.length} vendors; ${flagged} claims flagged as not-TRUE`)

phase('Synthesize')
const report = await agent(synthPrompt(verified), {
  label: 'synthesize',
  phase: 'Synthesize',
  schema: REPORT_SCHEMA,
})

return { comparisonPath: COMPARISON_PATH, reviewedOn: TODAY, report, verdicts: verified }
