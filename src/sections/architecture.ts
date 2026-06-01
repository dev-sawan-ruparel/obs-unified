export function renderArchitecture(): string {
  return `
<section id="architecture" class="architecture" aria-labelledby="arch-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Architecture</p>
      <h2 id="arch-title">One collector. Your telemetry graph.</h2>
      <p class="section-lead">
        Instrumented services write telemetry into obs-unified. Humans and agents
        read the same connected graph through a separate investigation boundary.
      </p>
    </header>

    <figure class="arch-map" aria-label="obs-unified product architecture map">
      <div class="arch-side arch-side-left">
        <div class="arch-side-label">Instrumented systems</div>
        <div class="arch-mini-node">
          <span>Frontend app</span>
          <p>interactions, replay, errors</p>
        </div>
        <div class="arch-mini-node">
          <span>Backend services</span>
          <p>traces, logs, profiles</p>
        </div>
        <div class="arch-mini-node">
          <span>Workers</span>
          <p>edge requests, jobs</p>
        </div>
        <div class="arch-mini-node">
          <span>AI / LLM calls</span>
          <p>tokens, cost, tool spans</p>
        </div>
      </div>

      <div class="arch-core-map">
        <div class="arch-boundary arch-boundary-write">
          <span class="arch-node-kicker">Write boundary</span>
          <strong>SDKs + OTLP ingest</strong>
          <p>Write-only keys send telemetry without read access.</p>
        </div>

        <div class="arch-core">
          <div class="arch-core-label">obs-unified</div>
          <div class="arch-core-step">
            <span>Collector</span>
            <p>Normalizes every signal into one identity chain.</p>
          </div>
          <div class="arch-core-split">
            <div>
              <span>Owned storage</span>
              <p>D1/R2 or Postgres/S3</p>
            </div>
            <div>
              <span>Connected graph</span>
              <p>interaction ID, traces, logs, replay, AI cost, CPU</p>
            </div>
          </div>
        </div>

        <div class="arch-boundary arch-boundary-read">
          <span class="arch-node-kicker">Read boundary</span>
          <strong>Dashboard + APIs</strong>
          <p>Read access is separate from ingest credentials.</p>
        </div>
      </div>

      <div class="arch-side arch-side-right">
        <div class="arch-side-label">Investigation clients</div>
        <div class="arch-mini-node">
          <span>Dashboard users</span>
          <p>inspect sessions, traces, logs, replay, alerts, costs</p>
        </div>
        <div class="arch-mini-node">
          <span>Debugging agents</span>
          <p>traverse read APIs using stable IDs</p>
        </div>
        <div class="arch-mini-node">
          <span>Incident workflows</span>
          <p>follow evidence from action to root cause</p>
        </div>
      </div>
    </figure>
  </div>
</section>
`;
}
