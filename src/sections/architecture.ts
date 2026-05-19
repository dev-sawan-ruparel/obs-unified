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
    <figure class="arch-visual" aria-label="Flow diagram: telemetry from backend services and browser apps flows through write-only keys into a customer-owned collector and storage layer. Operators use a separate dashboard password to query traces, logs, AI calls, errors, and replay.">
      <div class="arch-visual-head">
        <span class="arch-kicker">Client-owned telemetry plane</span>
        <span class="arch-state">No vendor in path</span>
      </div>
      <svg class="arch-flow-svg" viewBox="0 0 920 560" role="img" aria-labelledby="arch-flow-title arch-flow-desc">
        <title id="arch-flow-title">obs-unified telemetry and observation flow</title>
        <desc id="arch-flow-desc">Backend and browser telemetry use write-only ingest keys to reach the collector. The collector stores telemetry in Cloudflare or Node storage. Operators authenticate separately to observe traces, logs, AI calls, errors, and replay through the dashboard and API.</desc>
        <defs>
          <marker id="arrow-ingest" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arch-arrow arch-arrow-ingest"></path>
          </marker>
          <marker id="arrow-read" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arch-arrow arch-arrow-read"></path>
          </marker>
          <marker id="arrow-store" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" class="arch-arrow arch-arrow-store"></path>
          </marker>
        </defs>

        <rect class="arch-zone" x="14" y="44" width="654" height="492"></rect>
        <text class="arch-zone-label" x="34" y="76">runs inside your infrastructure</text>

        <g class="arch-node-svg arch-node-source" transform="translate(36 104)">
          <rect width="170" height="82"></rect>
          <text x="18" y="30">Backend services</text>
          <text class="arch-node-small" x="18" y="56">OTLP spans · logs</text>
          <text class="arch-node-small" x="18" y="74">AI call traces</text>
        </g>
        <g class="arch-node-svg arch-node-source" transform="translate(36 224)">
          <rect width="170" height="82"></rect>
          <text x="18" y="30">Browser app</text>
          <text class="arch-node-small" x="18" y="56">Usage · errors</text>
          <text class="arch-node-small" x="18" y="74">rrweb replay</text>
        </g>
        <g class="arch-node-svg arch-node-operator" transform="translate(36 374)">
          <rect width="170" height="82"></rect>
          <text x="18" y="30">Operators</text>
          <text class="arch-node-small" x="18" y="56">Investigate incidents</text>
          <text class="arch-node-small" x="18" y="74">Review behavior</text>
        </g>

        <g class="arch-node-svg arch-node-auth" transform="translate(270 104)">
          <rect width="150" height="82"></rect>
          <text class="arch-node-tag" x="18" y="27">WRITE-ONLY</text>
          <text x="18" y="55">Server key</text>
        </g>
        <g class="arch-node-svg arch-node-auth" transform="translate(270 224)">
          <rect width="150" height="82"></rect>
          <text class="arch-node-tag" x="18" y="27">WRITE-ONLY</text>
          <text x="18" y="55">Browser key</text>
        </g>
        <g class="arch-node-svg arch-node-auth arch-node-read" transform="translate(270 374)">
          <rect width="150" height="82"></rect>
          <text class="arch-node-tag" x="18" y="27">READ ACCESS</text>
          <text x="18" y="55">Dashboard login</text>
        </g>

        <g class="arch-node-svg arch-node-collector" transform="translate(500 142)">
          <rect width="168" height="214"></rect>
          <text x="20" y="34">Collector</text>
          <text class="arch-node-small" x="20" y="58">single deployable service</text>
          <text class="arch-route" x="20" y="98">/v1/* ingest</text>
          <text class="arch-route" x="20" y="128">/internal/* query</text>
          <text class="arch-route" x="20" y="158">/dashboard/* UI</text>
          <text class="arch-route" x="20" y="188">/health</text>
        </g>

        <g class="arch-node-svg arch-node-storage" transform="translate(500 414)">
          <rect width="168" height="82"></rect>
          <text x="18" y="31">Owned storage</text>
          <text class="arch-node-small" x="18" y="57">D1/R2 or PG/S3</text>
        </g>

        <g class="arch-observe">
          <rect class="arch-observe-shell" x="718" y="90" width="170" height="374"></rect>
          <text class="arch-zone-label" x="738" y="122">what you observe</text>
          <g class="arch-pill" transform="translate(738 150)">
            <rect width="130" height="38"></rect>
            <text x="14" y="25">Traces</text>
          </g>
          <g class="arch-pill" transform="translate(738 202)">
            <rect width="130" height="38"></rect>
            <text x="14" y="25">Logs</text>
          </g>
          <g class="arch-pill" transform="translate(738 254)">
            <rect width="130" height="38"></rect>
            <text x="14" y="25">AI calls</text>
          </g>
          <g class="arch-pill" transform="translate(738 306)">
            <rect width="130" height="38"></rect>
            <text x="14" y="25">Errors</text>
          </g>
          <g class="arch-pill" transform="translate(738 358)">
            <rect width="130" height="38"></rect>
            <text x="14" y="25">Replay</text>
          </g>
        </g>

        <path class="arch-edge arch-edge-ingest" d="M 206 145 H 270" marker-end="url(#arrow-ingest)"></path>
        <path class="arch-edge arch-edge-ingest" d="M 420 145 H 500" marker-end="url(#arrow-ingest)"></path>
        <path class="arch-edge arch-edge-ingest" d="M 206 265 H 270" marker-end="url(#arrow-ingest)"></path>
        <path class="arch-edge arch-edge-ingest" d="M 420 265 H 500" marker-end="url(#arrow-ingest)"></path>
        <path class="arch-edge arch-edge-store" d="M 584 356 V 414" marker-end="url(#arrow-store)"></path>
        <path class="arch-edge arch-edge-read" d="M 206 415 H 270" marker-end="url(#arrow-read)"></path>
        <path class="arch-edge arch-edge-read" d="M 420 415 C 462 415 474 326 500 326" marker-end="url(#arrow-read)"></path>
        <path class="arch-edge arch-edge-read" d="M 668 249 H 718" marker-end="url(#arrow-read)"></path>

        <text class="arch-edge-label arch-label-store" x="600" y="391">persist</text>
      </svg>
      <div class="arch-flow-stack" aria-hidden="true">
        <div class="arch-step arch-step-ingest">
          <strong>1. Telemetry enters</strong>
          <span>Backend and browser SDKs send spans, logs, errors, AI calls, and replay with write-only ingest keys.</span>
        </div>
        <div class="arch-step arch-step-store">
          <strong>2. Collector stores it</strong>
          <span>The single collector writes to Cloudflare D1/R2 or Node with Postgres and S3-compatible blobs.</span>
        </div>
        <div class="arch-step arch-step-read">
          <strong>3. Operators observe</strong>
          <span>Human users authenticate separately, then query dashboards, traces, logs, errors, AI calls, and replay.</span>
        </div>
      </div>
    </figure>
  </div>
</section>
`;
}
