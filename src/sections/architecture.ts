const DIAGRAM = `                       Your Infrastructure
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │   Your Backend  ──(API key)──>  Collector Service    │
  │                                 ├─ /v1/*   ingest    │
  │   Your Frontend ──(API key)──>  ├─ /internal/* query │
  │                                 ├─ /dashboard/* UI   │
  │                                 └─ /health           │
  │                                       │              │
  │                                  D1/R2 or PG/S3      │
  └──────────────────────────────────────────────────────┘`;

export function renderArchitecture(): string {
  return `
<section id="architecture" class="architecture" aria-labelledby="arch-title">
  <div class="container arch-grid">
    <div class="arch-copy">
      <p class="eyebrow">Architecture</p>
      <h2 id="arch-title">One collector. Two auth boundaries. Your data.</h2>
      <p>
        The <strong>collector</strong> is a single deployable service that receives telemetry,
        stores it in D1/R2 on Cloudflare or Postgres/S3-compatible storage on Node,
        and serves the dashboard. Two auth boundaries
        keep ingest and read paths separate:
      </p>
      <ul class="arch-list">
        <li><strong>SDK → Collector</strong> — write-only ingest API key, like PostHog or Sentry.</li>
        <li><strong>Dashboard → Collector</strong> — password login for human operators, like Grafana.</li>
      </ul>
      <p class="muted">
        Cloudflare Workers + D1 + R2 is the default low-ops deployment path; the Node collector
        runs with Postgres and S3-compatible blob storage.
        No external telemetry vendor in the data path.
      </p>
    </div>
    <pre class="diagram" aria-label="Architecture diagram: backend and frontend send telemetry to a single collector backed by Cloudflare D1/R2 or Postgres/S3 storage">${DIAGRAM}</pre>
  </div>
</section>
`;
}
