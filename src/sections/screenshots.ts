const screenshots = [
  {
    src: "/screenshots/app/service-map-astronomy.png",
    title: "Astronomy Shop service map",
    body: "Real demo traffic across 21 services, edge volume, latency, and errors.",
  },
  {
    src: "/screenshots/app/ai-cost-spans.png",
    title: "AI cost and LLM spans",
    body: "Model, token, cost, latency, and error signals stay queryable together.",
  },
  {
    src: "/screenshots/app/timeline-unified.png",
    title: "Unified timeline",
    body: "User, trace, log, replay, and usage events line up in one incident story.",
  },
  {
    src: "/screenshots/app/logs-correlated.png",
    title: "Correlated logs",
    body: "Structured logs remain tied to services, traces, and interaction context.",
  },
  {
    src: "/screenshots/app/usage-analytics.png",
    title: "Usage analytics",
    body: "Product sessions, events, visitors, views, and interactions share the graph.",
  },
  {
    src: "/screenshots/app/alerts-rules.png",
    title: "Alert rules",
    body: "Operational thresholds sit beside the evidence agents need to inspect.",
  },
];

export function renderScreenshots() {
  return `
    <section id="screenshots" class="screenshots">
      <div class="container">
        <div class="section-header">
          <p class="eyebrow">Product screenshots</p>
          <h2>Built for agentic debugging, shown from the real demo.</h2>
          <p class="section-lead">Captured from the OpenTelemetry Astronomy Shop flowing through obs-unified, with an agent graph and interaction ID seeded into the same local telemetry store.</p>
        </div>

        <div class="screenshot-showcase">
          <figure class="screenshot-primary">
            <div class="screenshot-frame screenshot-frame-primary">
              <img src="/screenshots/app/agent-action-graph.png" alt="obs-unified agent action graph with AI spans, causal action tree, and connected telemetry rail" width="1440" height="1000" />
            </div>
            <figcaption>
              <span>Agent action graph</span>
              <p>One telemetry graph an agent can traverse from user action to backend traces, logs, replay, AI cost, and profiling evidence.</p>
            </figcaption>
          </figure>

          <div class="screenshot-grid" aria-label="Additional obs-unified product screenshots">
            ${screenshots
              .map(
                (shot) => `
                  <figure class="screenshot-card">
                    <div class="screenshot-frame">
                      <img src="${shot.src}" alt="${shot.title} in the obs-unified dashboard" loading="lazy" width="1440" height="1000" />
                    </div>
                    <figcaption>
                      <span>${shot.title}</span>
                      <p>${shot.body}</p>
                    </figcaption>
                  </figure>
                `,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}
