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
];

export function renderScreenshots() {
  return `
    <section id="screenshots" class="screenshots">
      <div class="container">
        <div class="section-header">
          <p class="eyebrow">Product proof</p>
          <h2>The same demo, seen through every signal.</h2>
          <p class="section-lead">Captured from the OpenTelemetry Astronomy Shop flowing through obs-unified, with the interaction ID seeded into the local telemetry store.</p>
        </div>

        <div class="screenshot-showcase">
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
