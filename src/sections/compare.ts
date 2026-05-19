type Cell = { v: string; tone?: "yes" | "no" | "partial" | "neutral" };
type Row = { label: string; obs: Cell; datadog: Cell; sentry: Cell; posthog: Cell };

const ROWS: Row[] = [
  {
    label: "Hosting model",
    obs: { v: "Self-hosted on your infra", tone: "yes" },
    datadog: { v: "SaaS only", tone: "no" },
    sentry: { v: "SaaS or self-host", tone: "partial" },
    posthog: { v: "SaaS or self-host", tone: "partial" },
  },
  {
    label: "Pricing model",
    obs: { v: "Free · pay your own infra", tone: "yes" },
    datadog: { v: "Per host + per signal", tone: "no" },
    sentry: { v: "Per event", tone: "partial" },
    posthog: { v: "Per event", tone: "partial" },
  },
  {
    label: "Traces / APM",
    obs: { v: "OTLP-native", tone: "yes" },
    datadog: { v: "Yes", tone: "yes" },
    sentry: { v: "Performance", tone: "partial" },
    posthog: { v: "—", tone: "no" },
  },
  {
    label: "Structured logs",
    obs: { v: "Trace-correlated", tone: "yes" },
    datadog: { v: "Yes", tone: "yes" },
    sentry: { v: "Yes", tone: "yes" },
    posthog: { v: "—", tone: "no" },
  },
  {
    label: "AI / LLM observability",
    obs: { v: "Built-in", tone: "yes" },
    datadog: { v: "Separate product", tone: "partial" },
    sentry: { v: "—", tone: "no" },
    posthog: { v: "—", tone: "no" },
  },
  {
    label: "Session replay",
    obs: { v: "rrweb", tone: "yes" },
    datadog: { v: "Yes", tone: "yes" },
    sentry: { v: "Yes", tone: "yes" },
    posthog: { v: "rrweb", tone: "yes" },
  },
  {
    label: "Product analytics",
    obs: { v: "Yes", tone: "yes" },
    datadog: { v: "—", tone: "no" },
    sentry: { v: "—", tone: "no" },
    posthog: { v: "Yes", tone: "yes" },
  },
  {
    label: "Alerts",
    obs: { v: "All signals · one engine", tone: "yes" },
    datadog: { v: "Yes", tone: "yes" },
    sentry: { v: "Yes", tone: "yes" },
    posthog: { v: "On insights", tone: "partial" },
  },
  {
    label: "Cross-signal pivots",
    obs: { v: "≤2 clicks across all signals", tone: "yes" },
    datadog: { v: "Within product", tone: "partial" },
    sentry: { v: "Within product", tone: "partial" },
    posthog: { v: "Within product", tone: "partial" },
  },
  {
    label: "Data ownership",
    obs: { v: "Your D1/R2 or Postgres/S3", tone: "yes" },
    datadog: { v: "Datadog cloud", tone: "no" },
    sentry: { v: "Sentry cloud or yours", tone: "partial" },
    posthog: { v: "PostHog cloud or yours", tone: "partial" },
  },
];

function cell(c: Cell): string {
  const tone = c.tone ?? "neutral";
  return `<td class="cmp-cell cmp-${tone}">${c.v}</td>`;
}

function row(r: Row): string {
  return `
<tr>
  <th scope="row" class="cmp-row-label">${r.label}</th>
  ${cell(r.obs)}
  ${cell(r.datadog)}
  ${cell(r.sentry)}
  ${cell(r.posthog)}
</tr>`;
}

export function renderCompare(): string {
  return `
<section id="compare" class="compare" aria-labelledby="compare-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">How it compares</p>
      <h2 id="compare-title">One stack instead of three</h2>
      <p class="section-lead">
        Many teams glue together an APM, a product-analytics tool, and an error/session tool.
        obs-unified keeps those workflows on your own infrastructure, with a single identity chain
        that lets you pivot between every signal type.
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
          </tr>
        </thead>
        <tbody>
          ${ROWS.map(row).join("")}
        </tbody>
      </table>
    </div>
    <p class="cmp-footnote muted small">
      High-level positioning only; product capabilities and packaging change over time.
    </p>
  </div>
</section>
`;
}
