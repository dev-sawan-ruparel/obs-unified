const screenshots = [
  {
    src: "/screenshots/app/agent-action-graph.png",
    title: "Agent Action Graph",
    body: "The agent run, plan, tool calls, evals, trace ID, and interaction ID are visible in one causal view.",
  },
  {
    src: "/screenshots/app/service-map-astronomy.png",
    title: "Astronomy Shop service map",
    body: "Service dependencies, edge volume, latency, and errors in a demo environment.",
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
    title: "Structured logs",
    body: "Filter the collected logs by service and severity while investigating an incident.",
  },
];

export function renderScreenshots() {
  return `
    <section id="screenshots" class="screenshots">
      <div class="container">
        <div class="section-header">
          <p class="eyebrow">Product proof</p>
          <h2>Explore the dashboard across signals.</h2>
          <p class="section-lead">These dashboard views show OpenTelemetry Astronomy Shop traffic and seeded examples. Engineers can inspect traces, logs, usage, and agent activity.</p>
        </div>

        <div class="screenshot-showcase">
          <div class="screenshot-grid" aria-label="Additional Observability Unified product screenshots">
            ${screenshots
              .map(
                (shot) => `
                  <figure class="screenshot-card">
                    <div class="screenshot-frame">
                      <img src="${shot.src}" alt="${shot.title} in the Observability Unified dashboard" loading="lazy" width="${shot.src.includes("agent-action-graph") ? "1180" : "1440"}" height="900" />
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
