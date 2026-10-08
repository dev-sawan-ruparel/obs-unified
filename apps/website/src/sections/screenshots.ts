const screenshots = [
  {
    src: "/screenshots/app/agent-action-graph.png",
    title: "Agent Action Graph",
    body: "The agent run, plan, tool calls, evals, trace ID, and interaction ID are visible in one causal view.",
  },
  {
    src: "/screenshots/app/interaction-id-path.png",
    title: "Interaction ID path",
    body: "The same interaction_id follows a frontend action into backend traces, logs, replay, AI spans, and profiles.",
  },
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
    src: "/screenshots/app/trace-profile-slot.png",
    title: "Trace to CPU profile",
    body: "Trace detail keeps the profile join point visible so agents can carry a root-cause path down to CPU evidence.",
  },
];

export function renderScreenshots() {
  return `
    <section id="screenshots" class="screenshots">
      <div class="container">
        <div class="section-header">
          <p class="eyebrow">Product proof</p>
          <h2>The same demo, seen through every signal.</h2>
          <p class="section-lead">Captured from the OpenTelemetry Astronomy Shop flowing through Observability Unified, including the Agent Action Graph, interaction ID path, connected trace evidence, AI cost, and profile join point.</p>
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
