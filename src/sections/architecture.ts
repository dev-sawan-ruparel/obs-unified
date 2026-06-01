const ARCHITECTURE_STEPS = [
  {
    step: "01",
    title: "Ingest",
    body: "Backend services and browser apps send traces, logs, errors, AI calls, usage events, and replay through write-only ingest keys.",
    detail: "SDK -> collector",
  },
  {
    step: "02",
    title: "Store",
    body: "One collector normalizes the stream and writes to storage you own: Cloudflare D1/R2 or Node with Postgres and S3-compatible blobs.",
    detail: "D1/R2 or PG/S3",
  },
  {
    step: "03",
    title: "Investigate",
    body: "Operators and agents query the same connected graph through a separate read boundary for dashboards, traces, logs, replay, AI cost, and profiles.",
    detail: "dashboard + API",
  },
];

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

    <div class="arch-flow" aria-label="obs-unified architecture flow">
      ${ARCHITECTURE_STEPS.map(
        (item) => `
          <article class="arch-card">
            <div class="arch-card-top">
              <span class="arch-step-num">${item.step}</span>
              <span class="arch-detail">${item.detail}</span>
            </div>
            <h3>${item.title}</h3>
            <p>${item.body}</p>
          </article>
        `,
      ).join("")}
    </div>
  </div>
</section>
`;
}
