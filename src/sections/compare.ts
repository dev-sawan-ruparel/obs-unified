import { DOCS_URL } from "../config";

type Cell = { v: string; tone?: "yes" | "no" | "partial" | "neutral"; ref?: string };
type Row = {
  label: string;
  obs: Cell;
  datadog: Cell;
  sentry: Cell;
  posthog: Cell;
  honeycomb: Cell;
  newrelic: Cell;
  grafana: Cell;
  signoz: Cell;
  uptrace: Cell;
  hyperdx: Cell;
};

const COMPARISON_URL = `${DOCS_URL}/comparison`;

// Anchor ids match `<a id="src-..." />` headings in
// obs-unified-docs/content/docs/comparison.mdx. Updating that doc updates
// the destination of these footnote links.
const ROWS: Row[] = [
  {
    label: "Hosting model",
    obs:       { v: "Self-host on your infra",  tone: "yes" },
    datadog:   { v: "SaaS only",                tone: "no",      ref: "dd-hosting" },
    sentry:    { v: "SaaS or OSS self-host",    tone: "partial", ref: "se-hosting" },
    posthog:   { v: "Cloud or OSS self-host",   tone: "partial", ref: "ph-hosting" },
    honeycomb: { v: "SaaS · Private Cloud AWS", tone: "partial", ref: "hc-hosting" },
    newrelic:  { v: "SaaS only",                tone: "no",      ref: "nr-hosting" },
    grafana:   { v: "Cloud or self-host LGTM",  tone: "partial", ref: "gr-hosting" },
    signoz:    { v: "Cloud or OSS self-host",   tone: "partial", ref: "sn-hosting" },
    uptrace:   { v: "Cloud or OSS self-host",   tone: "partial", ref: "up-hosting" },
    hyperdx:   { v: "Cloud · OSS · ClickStack",  tone: "partial", ref: "hx-hosting" },
  },
  {
    label: "Pricing model",
    obs:       { v: "Free · pay your own infra", tone: "yes" },
    datadog:   { v: "Per host + per signal",     tone: "no",      ref: "dd-pricing" },
    sentry:    { v: "Tier + per-unit overage",   tone: "partial", ref: "se-pricing" },
    posthog:   { v: "Per-unit, per product",     tone: "partial", ref: "ph-pricing" },
    honeycomb: { v: "Per event volume",          tone: "partial", ref: "hc-pricing" },
    newrelic:  { v: "$/GB + per-user seat",      tone: "no",      ref: "nr-pricing" },
    grafana:   { v: "Per series + $/GB",         tone: "partial", ref: "gr-pricing" },
    signoz:    { v: "$0.30/GB ingest",           tone: "partial", ref: "sn-pricing" },
    uptrace:   { v: "$0.10/GB ingest",           tone: "partial", ref: "up-pricing" },
    hyperdx:   { v: "$20 flat + $0.40/GB",       tone: "partial", ref: "hx-pricing" },
  },
  {
    label: "Traces / APM",
    obs:       { v: "OTLP-native (HTTP)",        tone: "yes" },
    datadog:   { v: "Yes · OTLP in Preview",     tone: "partial", ref: "dd-otlp" },
    sentry:    { v: "Performance · OTLP beta",   tone: "partial", ref: "se-otlp" },
    posthog:   { v: "LLM-scoped only",           tone: "no",      ref: "ph-traces" },
    honeycomb: { v: "OTLP-native",               tone: "yes",     ref: "hc-otlp" },
    newrelic:  { v: "Native OTLP",               tone: "yes",     ref: "nr-otlp" },
    grafana:   { v: "Tempo · OTLP",              tone: "yes",     ref: "gr-otlp" },
    signoz:    { v: "OTLP-native",               tone: "yes",     ref: "sn-otlp" },
    uptrace:   { v: "OTLP-native",               tone: "yes",     ref: "up-otlp" },
    hyperdx:   { v: "OTLP-native",               tone: "yes",     ref: "hx-otlp" },
  },
  {
    label: "Structured logs",
    obs:       { v: "Trace-correlated",          tone: "yes" },
    datadog:   { v: "Yes",                       tone: "yes",     ref: "dd-logs" },
    sentry:    { v: "Yes · trace-connected",     tone: "yes",     ref: "se-logs" },
    posthog:   { v: "Yes (GA Jan 2026)",         tone: "yes",     ref: "ph-logs" },
    honeycomb: { v: "Modeled as wide events",    tone: "partial", ref: "hc-logs" },
    newrelic:  { v: "Yes · Grok-parsed",         tone: "yes",     ref: "nr-logs" },
    grafana:   { v: "Loki",                      tone: "yes",     ref: "gr-logs" },
    signoz:    { v: "Yes · Logs Explorer",       tone: "yes",     ref: "sn-logs" },
    uptrace:   { v: "Yes",                       tone: "yes",     ref: "up-logs" },
    hyperdx:   { v: "Yes · ClickHouse-backed",   tone: "yes",     ref: "hx-logs" },
  },
  {
    label: "AI / LLM observability",
    obs:       { v: "Built-in",                  tone: "yes" },
    datadog:   { v: "LLM Observability",         tone: "yes",     ref: "dd-llm" },
    sentry:    { v: "Agent Mon · Seer",          tone: "yes",     ref: "se-llm" },
    posthog:   { v: "LLM Analytics",             tone: "yes",     ref: "ph-llm" },
    honeycomb: { v: "Agent Obs (Early Access)",  tone: "partial", ref: "hc-llm" },
    newrelic:  { v: "AI Monitoring",             tone: "yes",     ref: "nr-llm" },
    grafana:   { v: "Assistant only",            tone: "partial", ref: "gr-llm" },
    signoz:    { v: "LLM Observability",         tone: "yes",     ref: "sn-llm" },
    uptrace:   { v: "—",                         tone: "no",      ref: "up-llm" },
    hyperdx:   { v: "Via OpenLLMetry",           tone: "partial", ref: "hx-llm" },
  },
  {
    label: "Session replay",
    obs:       { v: "rrweb",                     tone: "yes" },
    datadog:   { v: "Yes (RUM)",                 tone: "yes",     ref: "dd-replay" },
    sentry:    { v: "Yes (web + mobile)",        tone: "yes",     ref: "se-replay" },
    posthog:   { v: "rrweb",                     tone: "yes",     ref: "ph-replay" },
    honeycomb: { v: "—",                         tone: "no",      ref: "hc-replay" },
    newrelic:  { v: "Yes · DOM-based",           tone: "yes",     ref: "nr-replay" },
    grafana:   { v: "—",                         tone: "no",      ref: "gr-replay" },
    signoz:    { v: "—",                         tone: "no",      ref: "sn-replay" },
    uptrace:   { v: "—",                         tone: "no",      ref: "up-replay" },
    hyperdx:   { v: "Yes · auto-linked",         tone: "yes",     ref: "hx-replay" },
  },
  {
    label: "Product analytics",
    obs:       { v: "Yes",                       tone: "yes" },
    datadog:   { v: "Yes",                       tone: "yes",     ref: "dd-pa" },
    sentry:    { v: "—",                         tone: "no",      ref: "se-pa" },
    posthog:   { v: "Flagship",                  tone: "yes",     ref: "ph-pa" },
    honeycomb: { v: "—",                         tone: "no",      ref: "hc-pa" },
    newrelic:  { v: "Browser-only",              tone: "partial", ref: "nr-pa" },
    grafana:   { v: "—",                         tone: "no",      ref: "gr-pa" },
    signoz:    { v: "—",                         tone: "no",      ref: "sn-pa" },
    uptrace:   { v: "—",                         tone: "no",      ref: "up-pa" },
    hyperdx:   { v: "—",                         tone: "no",      ref: "hx-pa" },
  },
  {
    label: "Alerts",
    obs:       { v: "All signals · one engine",  tone: "yes" },
    datadog:   { v: "Many · Watchdog ML",        tone: "yes",     ref: "dd-alerts" },
    sentry:    { v: "Issues · uptime · crons",   tone: "yes",     ref: "se-alerts" },
    posthog:   { v: "On trends only",            tone: "partial", ref: "ph-alerts" },
    honeycomb: { v: "Triggers · BubbleUp",       tone: "yes",     ref: "hc-alerts" },
    newrelic:  { v: "NRQL conditions",           tone: "yes",     ref: "nr-alerts" },
    grafana:   { v: "Unified Alerting",          tone: "yes",     ref: "gr-alerts" },
    signoz:    { v: "5 alert types",             tone: "yes",     ref: "sn-alerts" },
    uptrace:   { v: "Metric + Error",            tone: "partial", ref: "up-alerts" },
    hyperdx:   { v: "Search + chart-based",      tone: "partial", ref: "hx-alerts" },
  },
  {
    label: "Cross-signal pivots",
    obs:       { v: "≤2 clicks across all",      tone: "yes" },
    datadog:   { v: "Within platform",           tone: "partial", ref: "dd-correlation" },
    sentry:    { v: "Within platform · trace-id", tone: "partial", ref: "se-correlation" },
    posthog:   { v: "Within event store",        tone: "partial", ref: "ph-correlation" },
    honeycomb: { v: "Unified wide events",       tone: "partial", ref: "hc-correlation" },
    newrelic:  { v: "Via NRQL",                  tone: "partial", ref: "nr-correlation" },
    grafana:   { v: "Per-data-source plumbing",  tone: "partial", ref: "gr-correlation" },
    signoz:    { v: "Trace ↔ logs",              tone: "partial", ref: "sn-correlation" },
    uptrace:   { v: "Within platform · UQL",     tone: "partial", ref: "up-correlation" },
    hyperdx:   { v: "Auto-linked across signals", tone: "yes",     ref: "hx-correlation" },
  },
  {
    label: "Data ownership",
    obs:       { v: "Your D1/R2 or Postgres/S3", tone: "yes" },
    datadog:   { v: "Datadog cloud",             tone: "no",      ref: "dd-hosting" },
    sentry:    { v: "Sentry cloud or yours",     tone: "partial", ref: "se-hosting" },
    posthog:   { v: "PostHog cloud or yours",    tone: "partial", ref: "ph-hosting" },
    honeycomb: { v: "Honeycomb or your AWS",     tone: "partial", ref: "hc-residency" },
    newrelic:  { v: "New Relic US/EU",           tone: "no",      ref: "nr-hosting" },
    grafana:   { v: "Grafana cloud or yours",    tone: "partial", ref: "gr-hosting" },
    signoz:    { v: "SigNoz cloud or yours",     tone: "partial", ref: "sn-residency" },
    uptrace:   { v: "Uptrace cloud or yours",    tone: "partial", ref: "up-hosting" },
    hyperdx:   { v: "Cloud (US) or yours",       tone: "partial", ref: "hx-residency" },
  },
];

// Assign a footnote number to every distinct ref id in the order they appear
// in ROWS, so the landing-page superscripts are consistently ordered.
function buildRefIndex(): Map<string, number> {
  const idx = new Map<string, number>();
  let n = 0;
  for (const r of ROWS) {
    for (const c of [r.datadog, r.sentry, r.posthog, r.honeycomb, r.newrelic, r.grafana, r.signoz, r.uptrace, r.hyperdx]) {
      if (c.ref && !idx.has(c.ref)) idx.set(c.ref, ++n);
    }
  }
  return idx;
}

function refMarker(refId: string | undefined, refIndex: Map<string, number>): string {
  if (!refId) return "";
  const n = refIndex.get(refId);
  if (!n) return "";
  return ` <sup class="cmp-ref"><a href="${COMPARISON_URL}#src-${refId}" rel="noopener" aria-label="Source ${n} — opens documentation">[${n}]</a></sup>`;
}

function cell(c: Cell, refIndex: Map<string, number>): string {
  const tone = c.tone ?? "neutral";
  return `<td class="cmp-cell cmp-${tone}">${c.v}${refMarker(c.ref, refIndex)}</td>`;
}

function row(r: Row, refIndex: Map<string, number>): string {
  return `
<tr>
  <th scope="row" class="cmp-row-label">${r.label}</th>
  ${cell(r.obs, refIndex)}
  ${cell(r.datadog, refIndex)}
  ${cell(r.sentry, refIndex)}
  ${cell(r.posthog, refIndex)}
  ${cell(r.honeycomb, refIndex)}
  ${cell(r.newrelic, refIndex)}
  ${cell(r.grafana, refIndex)}
  ${cell(r.signoz, refIndex)}
  ${cell(r.uptrace, refIndex)}
  ${cell(r.hyperdx, refIndex)}
</tr>`;
}

export function renderCompare(): string {
  const refIndex = buildRefIndex();
  return `
<section id="compare" class="compare" aria-labelledby="compare-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">How it compares <span class="cmp-asof">— snapshot as of May 2026</span></p>
      <h2 id="compare-title">One stack instead of three (or nine)</h2>
      <p class="section-lead">
        Most teams glue an APM, a product-analytics tool, an error/session tool, and now an LLM-observability tool together.
        obs-unified keeps those workflows on your own infrastructure under one identity chain that lets you pivot between every signal type in ≤2 clicks.
      </p>
    </header>
    <div class="cmp-scroll" role="region" aria-label="Comparison table" tabindex="0">
      <table class="cmp-table">
        <thead>
          <tr>
            <th scope="col" class="cmp-corner">Capability</th>
            <th scope="col" class="cmp-head cmp-head-us">obs-unified</th>
            <th scope="col" class="cmp-head">Datadog</th>
            <th scope="col" class="cmp-head">Sentry</th>
            <th scope="col" class="cmp-head">PostHog</th>
            <th scope="col" class="cmp-head">Honeycomb</th>
            <th scope="col" class="cmp-head">New Relic</th>
            <th scope="col" class="cmp-head">Grafana Cloud</th>
            <th scope="col" class="cmp-head">SigNoz</th>
            <th scope="col" class="cmp-head">Uptrace</th>
            <th scope="col" class="cmp-head">HyperDX</th>
          </tr>
        </thead>
        <tbody>
          ${ROWS.map((r) => row(r, refIndex)).join("")}
        </tbody>
      </table>
    </div>
    <p class="cmp-footnote muted small">
      Numbered superscripts link to the underlying vendor source.
      Full methodology, vendor profiles, and quoted citations live in
      <a href="${COMPARISON_URL}" rel="noopener">the comparison research doc</a>
      (last reviewed 2026-05-19 · re-reviewed quarterly).
    </p>
  </div>
</section>
`;
}
