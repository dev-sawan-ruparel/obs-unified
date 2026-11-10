// Additional views come from other demo data, not the checkout proof above.
const screenshots = [
  {
    src: "/screenshots/app/logs-correlated.png",
    title: "Structured logs",
    body: "Filter collected logs by service and severity while investigating an incident.",
  },
  {
    src: "/screenshots/app/timeline-unified.png",
    title: "Unified timeline",
    body: "User, trace, log, replay, and usage events from one seeded session on a shared timeline.",
  },
  {
    src: "/screenshots/app/service-map-astronomy.png",
    title: "Astronomy Shop service map",
    body: "Service dependencies, edge volume, latency, and errors from the OpenTelemetry demo.",
  },
  {
    src: "/screenshots/app/agent-action-graph.png",
    title: "Agent Action Graph",
    body: "For AI applications: an agent run, its tool calls, evals, trace ID, and interaction ID in one causal view.",
  },
  {
    src: "/screenshots/app/ai-cost-spans.png",
    title: "AI cost and LLM spans",
    body: "For AI applications: model, token, cost, latency, and error signals stay queryable together.",
  },
];

export function renderScreenshots() {
  return `
    <section id="screenshots" class="screenshots">
      <div class="container">
        <div class="section-header">
          <p class="eyebrow">Product proof</p>
          <h2>See where a slow checkout spent its time.</h2>
          <p class="section-lead">In a seeded demo, an AI agent found a 980 ms checkout request through MCP. An engineer can open the same trace in the dashboard and see the payment call span 710 ms, about 72% of the request.</p>
        </div>

        <div class="screenshot-showcase">
          <figure class="screenshot-card checkout-proof">
            <div class="screenshot-frame">
              <img src="/screenshots/app/checkout-trace-proof.png" alt="Dashboard waterfall for the seeded checkout showing a 980 ms request, a 710 ms payment call, and a nested 120 ms database span" loading="lazy" width="1044" height="288" />
            </div>
            <figcaption>
              <span>Seeded checkout trace</span>
              <p>The dashboard and MCP return the same trace and span IDs. The waterfall shows where the request spent its time. It leaves the underlying cause of the payment delay open.</p>
            </figcaption>
          </figure>
          <p class="screenshot-grid-label">Other views, from separate demo data</p>
          <div class="screenshot-grid" aria-label="Other Observability Unified views from separate demo data">
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
