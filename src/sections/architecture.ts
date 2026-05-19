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
    <figure class="arch-visual" aria-label="Architecture diagram: backend and frontend send telemetry through write-only ingest keys to one collector. Operators use a separate dashboard password. The collector stores data in Cloudflare D1/R2 or Postgres/S3-compatible storage.">
      <div class="arch-visual-head">
        <span class="arch-kicker">Your infrastructure</span>
        <span class="arch-state">No vendor in path</span>
      </div>
      <div class="arch-map">
        <div class="arch-source-stack" aria-label="Telemetry producers">
          <div class="arch-node arch-source">
            <span class="arch-node-label">Backend services</span>
            <span class="arch-node-meta">OTLP spans · logs · AI spans</span>
          </div>
          <div class="arch-node arch-source">
            <span class="arch-node-label">Browser app</span>
            <span class="arch-node-meta">Usage · errors · rrweb replay</span>
          </div>
          <div class="arch-node arch-source">
            <span class="arch-node-label">Operators</span>
            <span class="arch-node-meta">Dashboard sessions · investigations</span>
          </div>
        </div>

        <div class="arch-boundaries" aria-label="Authentication boundaries">
          <div class="arch-boundary arch-boundary-ingest">
            <span class="arch-flow-label">write-only</span>
            <strong>Server ingest key</strong>
          </div>
          <div class="arch-boundary arch-boundary-ingest">
            <span class="arch-flow-label">write-only</span>
            <strong>Browser ingest key</strong>
          </div>
          <div class="arch-boundary arch-boundary-read">
            <span class="arch-flow-label">operator read</span>
            <strong>Dashboard password</strong>
          </div>
        </div>

        <div class="arch-node arch-collector">
          <span class="arch-node-label">Collector service</span>
          <span class="arch-node-meta">single deployable runtime</span>
          <div class="arch-routes">
            <span><code>/v1/*</code> ingest</span>
            <span><code>/internal/*</code> query</span>
            <span><code>/dashboard/*</code> UI</span>
            <span><code>/health</code> liveness</span>
          </div>
        </div>

        <div class="arch-storage" aria-label="Storage options">
          <div class="arch-node arch-store">
            <span class="arch-node-label">Cloudflare path</span>
            <span class="arch-node-meta">Workers · D1 · R2</span>
          </div>
          <div class="arch-node arch-store">
            <span class="arch-node-label">Node path</span>
            <span class="arch-node-meta">Postgres · S3-compatible blobs</span>
          </div>
        </div>
      </div>
    </figure>
  </div>
</section>
`;
}
