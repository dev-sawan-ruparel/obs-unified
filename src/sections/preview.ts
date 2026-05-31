import { EXAMPLES_URL, GETTING_STARTED_URL, SDK_DOCS_URL } from "../config";

const FIRST_RUN = `# Fastest first run
pnpm local:image
pnpm local:run

# Editable local repo
pnpm install
pnpm run setup
pnpm run dev`;

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

  const llm = startLLMSpan("checkout.assistant", {
    provider: "anthropic",
    modelName: "claude-sonnet-4",
  });
  llm.setAttributes({
    "openinference.usage.prompt_tokens": 150,
    "openinference.usage.completion_tokens": 80,
    "llm.cost_usd": 0.0021,
  });
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
        Start the local stack, pick SDKs for your runtime, and initialize each service.
        Backend spans, frontend interactions, and AI spans share the same identity chain automatically.
      </p>
    </header>
    <div class="preview-grid">
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">1</span> Start locally</div>
        <p class="preview-step-note">The full first-run decision tree lives in <a href="${GETTING_STARTED_URL}">Getting started</a></p>
        ${code("bash", FIRST_RUN)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">2</span> Pick SDKs</div>
        <p class="preview-step-note">Runnable examples and recipes live in <a href="${EXAMPLES_URL}">Examples</a> and <a href="${SDK_DOCS_URL}">SDK docs</a></p>
        ${code("text", SDK_PATHS)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">3</span> Instrument backend and frontend</div>
        <p class="preview-step-note">TypeScript shown · equivalent <strong>Go</strong> and <strong>Rust</strong> examples live in the <a href="${SDK_DOCS_URL}">SDK docs</a></p>
        ${code("typescript", BACKEND)}
        ${code("tsx", FRONTEND)}
      </div>
    </div>
  </div>
</section>
`;
}
