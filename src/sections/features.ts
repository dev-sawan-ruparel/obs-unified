type Feature = {
  title: string;
  body: string;
  icon: string;
};

const FEATURES: Feature[] = [
  {
    title: "Distributed tracing",
    body: "OTLP-native ingest. Spans, baggage, and propagation work with first-party Node, Go, and Rust SDKs — and any OpenTelemetry SDK over OTLP.",
    icon: `<path d="M3 6h6M3 12h12M3 18h9"/><circle cx="18" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
  },
  {
    title: "Structured logs",
    body: "JSON logs with severity, automatic trace correlation, and per-module loggers. Auto-attached to the active span — no copy-paste IDs.",
    icon: `<path d="M4 6h16M4 12h16M4 18h10"/>`,
  },
  {
    title: "AI / LLM calls",
    body: "First-class observability for model calls: provider, model, prompt and completion tokens, USD cost, latency, and failure category — across Anthropic, OpenAI, and OpenRouter.",
    icon: `<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/>`,
  },
  {
    title: "Session replay",
    body: "Browser sessions recorded with rrweb, stored as DOM-mutation chunks in R2, and replayed inline next to the trace they belong to.",
    icon: `<polygon points="6 4 20 12 6 20 6 4"/>`,
  },
  {
    title: "Usage analytics",
    body: "Page views, interactions, errors, UTM parameters, and identity stitching — the product-analytics layer, in the same store as your traces.",
    icon: `<path d="M3 20h18M6 16v-6M11 16V8M16 16v-3M21 16v-9"/>`,
  },
  {
    title: "Alerts",
    body: "Alert rules over any signal — latency, error rate, AI spend, custom usage events. One rules engine and one notification surface across the stack.",
    icon: `<path d="M12 2a7 7 0 0 0-7 7v4l-2 3h18l-2-3V9a7 7 0 0 0-7-7z"/><path d="M9 18a3 3 0 0 0 6 0"/>`,
  },
  {
    title: "User profiles",
    body: "Identity linking from anonymous visitor to logged-in user, with traits and event history. Every signal can be filtered by user and replayed from their perspective.",
    icon: `<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>`,
  },
  {
    title: "Polyglot SDKs",
    body: "First-party SDKs for TypeScript, Go, and Rust — same API surface, same identity chain, all feeding one collector. Any OpenTelemetry SDK works as a fallback.",
    icon: `<polyline points="8 18 2 12 8 6"/><polyline points="16 6 22 12 16 18"/><line x1="14" y1="4" x2="10" y2="20"/>`,
  },
];

function card({ title, body, icon }: Feature): string {
  return `
<article class="feature-card">
  <div class="feature-icon" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
  </div>
  <h3 class="feature-title">${title}</h3>
  <p class="feature-body">${body}</p>
</article>
`;
}

export function renderFeatures(): string {
  return `
<section id="features" class="features" aria-labelledby="features-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Every signal · every language · one collector</p>
      <h2 id="features-title">Every signal reachable from every other in ≤2 clicks.</h2>
      <p class="section-lead">
        obs-unified replaces the patchwork of APM + logging + product analytics + session replay
        + LLM observability + alerting — with one self-hosted stack, correlated through a single
        identity chain.
      </p>
    </header>
    <div class="feature-grid">${FEATURES.map(card).join("")}</div>
  </div>
</section>
`;
}
