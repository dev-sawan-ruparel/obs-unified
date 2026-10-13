import { DOCS_URL } from "../config";
import { messaging } from "../content/messaging.generated";

type Cell = { v: string; inferred?: boolean };
type VendorKey =
  | "datadog"
  | "sentry"
  | "posthog"
  | "honeycomb"
  | "newrelic"
  | "grafana"
  | "signoz"
  | "uptrace"
  | "hyperdx";
type Row = { label: string; obs: Cell } & Record<VendorKey, Cell>;

const COMPARISON_URL = `${DOCS_URL}/comparison`;

// Keep in sync with the Callout "Reviewed …" date at the top of
// apps/docs/content/docs/comparison.mdx and with the tracked ledger below.
// apps/website/scripts/comparison-check.mjs enforces this.
export const LAST_REVIEWED = "2026-10-13";
export const AUDIT_LEDGER_URL =
  "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/comparison-full-audit-2026-10-13.md";
export const SOURCE_CHECKED_CELLS = 81;
export const INFERRED_CELLS = 9;
export const TOTAL_CELLS = 90;

const VENDOR_KEYS: VendorKey[] = [
  "datadog",
  "sentry",
  "posthog",
  "honeycomb",
  "newrelic",
  "grafana",
  "signoz",
  "uptrace",
  "hyperdx",
];

// SOURCE_CHECKED_CELLS counts cells whose historical claim was checked directly
// against the vendor's live page (verdict TRUE, PARTIALLY_TRUE, OUTDATED, or
// FALSE; corrected where needed). INFERRED_CELLS are the UNVERIFIABLE
// inferential negatives below.
//
// "Not marketed" cells are inferential negatives: the vendor's product index,
// docs navigation, or sitemap was read on LAST_REVIEWED and no such product was
// found. They are rendered with a dagger and explained in the footnote.
const NOT_MARKETED: Cell = { v: "Not marketed", inferred: true };

// Every competitor claim below is backed by a primary-source excerpt in the
// vendor section of the comparison doc (anchor `src-<vendor>`) and a verdict
// row in the audit ledger.
const ROWS: Row[] = [
  {
    label: "Hosting model",
    obs:       { v: messaging.authored.positioning.distribution.hosting },
    datadog:   { v: "SaaS · BYOC for logs" },
    sentry:    { v: "SaaS or Fair Source self-host" },
    posthog:   { v: "Cloud-first · hobby self-host" },
    honeycomb: { v: "SaaS · Private Cloud (AWS)" },
    newrelic:  { v: "SaaS (US · EU · JP)" },
    grafana:   { v: "Cloud or self-host OSS LGTM" },
    signoz:    { v: "Cloud · BYOC · OSS self-host" },
    uptrace:   { v: "Cloud · OSS (AGPL) · on-prem" },
    hyperdx:   { v: "Cloud · OSS (MIT) · ClickStack" },
  },
  {
    label: "Pricing model",
    obs:       { v: "Free (MIT) · your infra bill" },
    datadog:   { v: "Per host + per signal" },
    sentry:    { v: "Tier + per-unit overage" },
    posthog:   { v: "Per-unit, per product" },
    honeycomb: { v: "Per event volume" },
    newrelic:  { v: "$/GB + per-user (or Compute)" },
    grafana:   { v: "$19/mo + per series + $/GB" },
    signoz:    { v: "$49/mo min · $0.30/GB" },
    uptrace:   { v: "Per GB ingested · tiers · 50 GB free" },
    hyperdx:   { v: "$20 flat + $0.40/GB" },
  },
  {
    label: "Traces / APM",
    obs:       { v: "OTLP-native (HTTP)" },
    datadog:   { v: "Yes · OTLP (Agent or direct)" },
    sentry:    { v: "Tracing · OTLP beta" },
    posthog:   { v: "OTLP tracing (beta, Jul 2026)" },
    honeycomb: { v: "OTLP-native" },
    newrelic:  { v: "Native OTLP" },
    grafana:   { v: "Tempo · OTLP" },
    signoz:    { v: "OTLP-native" },
    uptrace:   { v: "OTLP-native (gRPC + HTTP)" },
    hyperdx:   { v: "OTLP-native (gRPC + HTTP)" },
  },
  {
    label: "Structured logs",
    obs:       { v: "Trace-correlated" },
    datadog:   { v: "Yes" },
    sentry:    { v: "Yes · trace-connected" },
    posthog:   { v: "Yes · OTLP (GA Jan 2026)" },
    honeycomb: { v: "Log Analytics · event model" },
    newrelic:  { v: "Yes · server-side parsing" },
    grafana:   { v: "Loki" },
    signoz:    { v: "Yes · Logs Explorer" },
    uptrace:   { v: "Yes" },
    hyperdx:   { v: "Yes · ClickHouse-backed" },
  },
  {
    label: "AI / LLM observability",
    obs:       { v: "Built-in · Agent Action Graph" },
    datadog:   { v: "Agent Observability" },
    sentry:    { v: "Agent Tracing · Seer" },
    posthog:   { v: "AI Observability" },
    honeycomb: { v: "Agent Timeline (GA Jun 2026)" },
    newrelic:  { v: "AI Monitoring" },
    grafana:   { v: "Agent Observability (GA Jul 2026)" },
    signoz:    { v: "LLM Observability" },
    uptrace:   { v: "OTel GenAI instrumentation guides" },
    hyperdx:   { v: "Via OTel LLM SDKs" },
  },
  {
    label: "Session replay",
    obs:       { v: "rrweb" },
    datadog:   { v: "Yes (RUM)" },
    sentry:    { v: "Yes (web + mobile)" },
    posthog:   { v: "rrweb" },
    honeycomb: NOT_MARKETED,
    newrelic:  { v: "Yes · DOM-based" },
    grafana:   { v: "Public preview add-on" },
    signoz:    NOT_MARKETED,
    uptrace:   NOT_MARKETED,
    hyperdx:   { v: "Yes · auto-linked" },
  },
  {
    label: "Product analytics",
    obs:       { v: "Usage analytics" },
    datadog:   { v: "Yes" },
    sentry:    NOT_MARKETED,
    posthog:   { v: "Flagship" },
    honeycomb: NOT_MARKETED,
    newrelic:  { v: "Browser journeys · NRQL funnels" },
    grafana:   NOT_MARKETED,
    signoz:    NOT_MARKETED,
    uptrace:   NOT_MARKETED,
    hyperdx:   NOT_MARKETED,
  },
  {
    label: "Alerts",
    obs:       { v: "Built-in" },
    datadog:   { v: "30+ types · Watchdog" },
    sentry:    { v: "Issues · uptime · crons" },
    posthog:   { v: "Insights + logs" },
    honeycomb: { v: "Triggers · BubbleUp" },
    newrelic:  { v: "NRQL conditions" },
    grafana:   { v: "Grafana Alerting" },
    signoz:    { v: "5 alert types" },
    uptrace:   { v: "Metric + error monitors" },
    hyperdx:   { v: "Search-based" },
  },
  {
    label: "Cross-signal pivots",
    obs:       { v: "One traversable graph" },
    datadog:   { v: "Within platform · tags" },
    sentry:    { v: "Within platform · trace ID" },
    posthog:   { v: "One project / event store" },
    honeycomb: { v: "One event store" },
    newrelic:  { v: "Via NRQL" },
    grafana:   { v: "Per-data-source links" },
    signoz:    { v: "Trace ↔ logs" },
    uptrace:   { v: "One store" },
    hyperdx:   { v: "Auto-linked across signals" },
  },
  {
    label: "Data ownership",
    obs:       { v: "Your D1/R2 or Postgres/S3" },
    datadog:   { v: "Datadog site · BYOC logs" },
    sentry:    { v: "Sentry cloud or yours" },
    posthog:   { v: "PostHog cloud or yours" },
    honeycomb: { v: "Honeycomb US/EU or your AWS" },
    newrelic:  { v: "New Relic US/EU/JP" },
    grafana:   { v: "Grafana cloud or yours" },
    signoz:    { v: "US/EU/India · BYOC · yours" },
    uptrace:   { v: "Cloud (Germany) or yours" },
    hyperdx:   { v: "Cloud (US) or yours" },
  },
];

export function comparisonRows(): Row[] {
  return ROWS;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cell(c: Cell): string {
  // Cells are rendered as neutral text on purpose: the methodology is
  // non-judgmental, so no check marks, circles, or dashes are injected.
  const dagger = c.inferred ? `<sup class="cmp-ref" title="Not marketed by the vendor on the pages read ${LAST_REVIEWED}; inferential, see footnote">†</sup>` : "";
  return `<td class="cmp-cell">${escapeHtml(c.v)}${dagger}</td>`;
}

function row(r: Row): string {
  return `
<tr>
  <th scope="row" class="cmp-row-label">${escapeHtml(r.label)}</th>
  ${cell(r.obs)}
  ${VENDOR_KEYS.map((k) => cell(r[k])).join("\n  ")}
</tr>`;
}

export function renderCompare(): string {
  const { comparison } = messaging.authored.positioning;
  const headers = comparison.agentRows.map((agent) => {
    const isUs = agent.key === "obs";
    if (isUs) {
      return `<th scope="col" class="cmp-head cmp-head-us">${escapeHtml(agent.name)}</th>`;
    }
    // Each vendor header links to the cited vendor section of the docs page.
    return `<th scope="col" class="cmp-head"><a href="${COMPARISON_URL}#src-${agent.key}" rel="noopener" aria-label="${escapeHtml(agent.name)} sources — opens documentation">${escapeHtml(agent.name)}</a><sup class="cmp-ref">[src]</sup></th>`;
  }).join("");

  return `
<section id="compare" class="compare" aria-labelledby="compare-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">How it compares <span class="cmp-asof">— source-checked ${LAST_REVIEWED} against vendor pages</span></p>
      <h2 id="compare-title">${escapeHtml(comparison.headline)}</h2>
      <p class="section-lead">
        Most teams glue an APM, a product-analytics tool, an error/session tool, and an LLM-observability tool together.
        Observability Unified brings those workflows under one identity chain and one dashboard, deploying to your own infrastructure via Cloudflare Workers with D1/R2 or Node with PostgreSQL/S3.
      </p>
    </header>
    <div class="cmp-scroll" role="region" aria-label="Comparison table" tabindex="0">
      <table class="cmp-table">
        <thead>
          <tr>
            <th scope="col" class="cmp-corner">Capability</th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${ROWS.map(row).join("")}
        </tbody>
      </table>
    </div>
    <p class="cmp-footnote muted small">
      ${SOURCE_CHECKED_CELLS} of ${TOTAL_CELLS} vendor cells were directly checked against the vendor's own live page on ${LAST_REVIEWED} and corrected where the source had changed;
      the ${INFERRED_CELLS} cells marked † are inferential (the vendor does not market that capability on the pages we read) and are not claimed as source-checked.
      Cells are descriptive, not scored. Vendor headers link to the cited sources in <a href="${COMPARISON_URL}" rel="noopener">the comparison doc</a>;
      per-cell verdicts and excerpts live in the <a href="${AUDIT_LEDGER_URL}" rel="noopener">tracked audit ledger</a>.
      Pricing changes often; treat prices as of the review date.
    </p>
  </div>
</section>
`;
}
