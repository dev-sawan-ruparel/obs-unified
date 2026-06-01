export function renderArchitecture(): string {
  return `
<section id="architecture" class="architecture" aria-labelledby="arch-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Architecture</p>
      <h2 id="arch-title">One collector. Your telemetry graph.</h2>
      <p class="section-lead">
        obs-unified keeps ingest, storage, and investigation in your infrastructure,
        with separate write and read boundaries so no external telemetry vendor sits in the data path.
      </p>
    </header>

    <figure class="arch-diagram" aria-label="obs-unified architecture diagram">
      <div class="arch-lane">
        <div class="arch-lane-label">Instrumented services</div>
        <div class="arch-node arch-node-source">
          <span class="arch-node-kicker">Runtime sources</span>
          <strong>Frontend, backend, workers</strong>
          <span>Browser interactions, server spans, structured logs, errors, and replay.</span>
        </div>
        <div class="arch-arrow arch-join" aria-hidden="true">+</div>
        <div class="arch-node arch-node-source">
          <span class="arch-node-kicker">AI services</span>
          <strong>LLM calls and tools</strong>
          <span>Model, token, latency, cost, prompt, and tool-call spans.</span>
        </div>
        <div class="arch-arrow" aria-hidden="true">-></div>
        <div class="arch-node arch-node-boundary">
          <span class="arch-node-kicker">SDK / OTLP</span>
          <strong>Write-only ingest</strong>
          <span>Ingest keys send telemetry without read access.</span>
        </div>
      </div>

      <div class="arch-lane arch-lane-core">
        <div class="arch-lane-label">obs-unified core</div>
        <div class="arch-node arch-node-collector">
          <span class="arch-node-kicker">Collector</span>
          <strong>Normalize and correlate</strong>
          <span>Every signal joins one identity chain from interaction ID to trace and profile evidence.</span>
        </div>
        <div class="arch-arrow" aria-hidden="true">-></div>
        <div class="arch-node arch-node-storage">
          <span class="arch-node-kicker">Owned storage</span>
          <strong>D1/R2 or Postgres/S3</strong>
          <span>Data stays in your Cloudflare or Node deployment.</span>
        </div>
        <div class="arch-arrow" aria-hidden="true">-></div>
        <div class="arch-node arch-node-graph">
          <span class="arch-node-kicker">Connected graph</span>
          <strong>Trace, logs, replay, AI cost, CPU</strong>
          <span>One graph links the evidence humans and agents need.</span>
        </div>
      </div>

      <div class="arch-lane arch-lane-read">
        <div class="arch-lane-label">Investigation clients</div>
        <div class="arch-node arch-node-source">
          <span class="arch-node-kicker">Humans</span>
          <strong>Dashboard users</strong>
          <span>Engineers inspect sessions, traces, logs, replay, alerts, and costs.</span>
        </div>
        <div class="arch-arrow arch-join" aria-hidden="true">+</div>
        <div class="arch-node arch-node-source">
          <span class="arch-node-kicker">Agents</span>
          <strong>Debugging agents</strong>
          <span>Agents traverse the same connected graph through read APIs and stable IDs.</span>
        </div>
        <div class="arch-arrow" aria-hidden="true">-></div>
        <div class="arch-node arch-node-boundary">
          <span class="arch-node-kicker">Read boundary</span>
          <strong>Dashboard login + API keys</strong>
          <span>Read access is separate from write-only ingest credentials.</span>
        </div>
      </div>
    </figure>
  </div>
</section>
`;
}
