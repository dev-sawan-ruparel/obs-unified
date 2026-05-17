type QA = { q: string; a: string };

const FAQS: QA[] = [
  {
    q: "What is obs-unified?",
    a: "obs-unified is an open-source, self-hosted observability platform. A single collector service ingests OpenTelemetry traces, structured logs, LLM/AI call records, frontend usage events, and rrweb session replays, stores them in D1 (SQLite) and R2, and serves a React dashboard for querying and correlating them.",
  },
  {
    q: "How is obs-unified different from Datadog, Sentry, or PostHog?",
    a: "obs-unified runs entirely on your own infrastructure — no external telemetry vendor sits in the data path. It also unifies signal types that those tools split across separate products: APM traces, logs, error tracking, product analytics, session replay, and LLM observability live in one collector and one dashboard, correlated through a single identity chain (user → session → interaction → trace → span).",
  },
  {
    q: "What runtimes and languages are supported?",
    a: "The collector runs on Cloudflare Workers (D1 + R2) or any Node.js, Bun, or Deno host with SQLite. SDKs ship for Node.js / TypeScript (Workers, Hono, Next.js, Express), Go, and Rust. The frontend SDK is a vanilla browser library with an optional React provider.",
  },
  {
    q: "Is obs-unified free and open source?",
    a: "Yes — MIT-licensed. The full source for the collector, SDKs, dashboard, and the OpenTelemetry Astronomy Shop demo wiring lives at github.com/obs-unified/obs-unified.",
  },
  {
    q: "Can I embed the dashboard inside my own admin panel?",
    a: "Yes. The dashboard ships as @obs-unified/dashboard with an ObsDashboardProvider and TelemetryDashboard React component. Pass a basePath that points at your collector and render whichever views you need.",
  },
  {
    q: "Does it work with my existing OpenTelemetry SDK?",
    a: "Yes. The collector accepts OTLP over HTTP. The included Node/Go/Rust SDKs are thin wrappers that configure the standard OpenTelemetry SDK to point at the collector and add OpenInference helpers for LLM/tool spans.",
  },
];

function item({ q, a }: QA): string {
  return `
<details class="faq-item">
  <summary>${q}</summary>
  <p>${a}</p>
</details>`;
}

export function renderFaq(): string {
  return `
<section id="faq" class="faq" aria-labelledby="faq-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">FAQ</p>
      <h2 id="faq-title">Frequently asked questions</h2>
      <p class="section-lead">Quick answers — also exposed as structured data for AI search.</p>
    </header>
    <div class="faq-list">${FAQS.map(item).join("")}</div>
  </div>
</section>
`;
}
