type QA = { q: string; a: string };

export const FAQS: QA[] = [
  {
    q: "What is obs-unified?",
    a: "obs-unified is an open-source, self-hosted observability platform. A single collector service ingests OpenTelemetry traces, structured logs, LLM/AI call records, frontend usage events, and rrweb session replays, stores them in Cloudflare D1/R2 or Postgres/S3-compatible storage, and serves a dashboard for querying and correlating them.",
  },
  {
    q: "How is it different from Datadog, Sentry, or PostHog?",
    a: "It runs on your own infrastructure — no external telemetry vendor sits in the data path. It also unifies signal types that those tools split across separate products: APM traces, logs, product analytics, session replay, AI observability, and alerting live in one collector and one dashboard, correlated through a single identity chain (user → session → interaction → trace → span).",
  },
  {
    q: "What's the data retention model?",
    a: "Retention is controlled by the RETENTION_HOURS environment variable on the collector and defaults to 72 hours. Profile blobs have a separate PROFILE_RETENTION_HOURS override because they're larger per record. Because everything lives in your storage account, you set the policy and pay the storage directly — there's no per-event retention tier to negotiate.",
  },
  {
    q: "When do I outgrow D1, and what's the upgrade path?",
    a: "D1's row-store is comfortable up to roughly 100M hot rows; the binding constraints are metric cardinality and profile sample metadata. The collector keeps profile blobs in R2 with only small metadata rows in D1 to push that ceiling further. For larger or non-Cloudflare installs, the Node collector uses Postgres plus S3-compatible blob storage.",
  },
  {
    q: "How does it handle PII and GDPR?",
    a: "Self-hosting is the headline answer: data never leaves your infrastructure, so residency and processor questions reduce to where you deploy. On top of that, the usage-event pipeline applies default-redact scrubbing on ingest — fields named like email, token, password, authorization, or cookie are stripped from context and properties JSON before storage. Session replays use rrweb, which masks input fields by default and supports per-element block/mask attributes.",
  },
  {
    q: "Does it support SSO or multi-user dashboards?",
    a: "Not today. Two auth boundaries ship: a write-only ingest API key for SDKs and a single password for the dashboard. Multi-user, RBAC, and SSO are out of scope and tracked separately. Most teams put the dashboard behind their existing identity proxy (Cloudflare Access, Tailscale, etc.) in the meantime.",
  },
  {
    q: "Can I migrate from Datadog, Sentry, or PostHog?",
    a: "Sentry and PostHog have step-by-step migration guides in the docs covering concept mapping, SDK swap, and identity backfill via /v1/identify. Datadog: the OTLP-native ingest accepts the standard OpenTelemetry SDK over OTLP HTTP, so traces and logs are a one-for-one config change; a dedicated walkthrough is coming.",
  },
  {
    q: "Does it work with my existing OpenTelemetry SDK?",
    a: "Yes. The collector accepts OTLP over HTTP (JSON and protobuf, with gzip). gRPC is intentionally not supported — Cloudflare Workers can't host it, and OTLP HTTP covers every official SDK. The first-party SDKs are thin wrappers that point the standard OpenTelemetry SDK at the collector and add OpenInference helpers for LLM and tool spans.",
  },
  {
    q: "Is it free and open source?",
    a: "Yes — MIT-licensed. You pay only for the infrastructure you run it on: Cloudflare Workers + D1 + R2, or the Node collector with Postgres + S3-compatible storage.",
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
      <h2 id="faq-title">Operational questions, answered up front</h2>
      <p class="section-lead">The questions evaluators ask in the first call — also exposed as structured data for AI search.</p>
    </header>
    <div class="faq-list">${FAQS.map(item).join("")}</div>
  </div>
</section>
`;
}
