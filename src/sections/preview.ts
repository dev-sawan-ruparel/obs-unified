import { SDK_DOCS_URL } from "../config";

const SDK_PATHS = `Backend:
  TypeScript  @obs-unified/* on GitHub Packages
  Go          sdks/go
  Rust        sdks/rust

Browser:
  React/vanilla  @obs-unified/analytics-sdk`;

const BACKEND = `import {
  initObservability,
  createLogger,
  startLLMSpan,
} from "@obs-unified/telemetry-sdk";

initObservability({
  collectorUrl: "https://obs.my-app.com",
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-api",
});

const log = createLogger("checkout");

app.post("/checkout", async (c) => {
  log.info("charge.starting", { user: c.user.id });
  const result = await stripe.charges.create({ amount: 4900 });

  const llm = startLLMSpan({
    provider: "anthropic",
    model: "claude-sonnet-4",
  });
  llm.setTokens({ prompt: 150, completion: 80, total: 230 });
  llm.setCost(0.0021);
  llm.end();

  return c.json(result);
});`;

const FRONTEND = `import {
  AnalyticsProvider,
  useAnalytics,
} from "@obs-unified/analytics-sdk/react";

function App() {
  return (
    <AnalyticsProvider
      collectorUrl="https://obs.my-app.com"
      apiKey="public-ingest-key"
      trackPageViews
      captureErrors
    >
      <Checkout />
    </AnalyticsProvider>
  );
}

function Checkout() {
  const { trackInteraction } = useAnalytics();
  return (
    <button onClick={() => trackInteraction("checkout_click")}>
      Pay $49
    </button>
  );
}`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function code(lang: string, src: string): string {
  return `<pre class="code-block" data-lang="${lang}"><code>${escapeHtml(src)}</code></pre>`;
}

export function renderPreview(): string {
  return `
<section id="preview" class="preview" aria-labelledby="preview-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Quick preview</p>
      <h2 id="preview-title">From zero to correlated signals in three steps</h2>
      <p class="section-lead">
        Pick the SDKs for your runtime, point them at your collector, and initialize each service.
        Backend spans, frontend interactions, and AI spans share the same identity chain automatically.
      </p>
    </header>
    <div class="preview-grid">
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">1</span> Pick SDKs</div>
        <p class="preview-step-note">Full language examples live in the <a href="${SDK_DOCS_URL}">SDK docs</a></p>
        ${code("text", SDK_PATHS)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">2</span> Instrument your backend</div>
        <p class="preview-step-note">TypeScript shown · equivalent <strong>Go</strong> and <strong>Rust</strong> examples live in the <a href="${SDK_DOCS_URL}">SDK docs</a></p>
        ${code("typescript", BACKEND)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">3</span> Instrument your frontend</div>
        ${code("tsx", FRONTEND)}
      </div>
    </div>
  </div>
</section>
`;
}
