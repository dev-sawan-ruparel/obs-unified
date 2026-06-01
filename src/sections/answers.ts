const ANSWERS = [
  {
    id: "what-is-obs-unified",
    q: "What is obs-unified?",
    a: "obs-unified is an open-source, self-hosted observability platform for traces, logs, AI calls, usage events, session replay, alerts, profiles, and investigations.",
  },
  {
    id: "what-is-agentic-debugging",
    q: "What is agentic debugging?",
    a: "Agentic debugging means software agents can traverse one telemetry graph from a user action to backend traces, logs, replay, AI cost, and CPU profiling evidence.",
  },
  {
    id: "what-is-interaction-id",
    q: "What is the interaction ID?",
    a: "The interaction ID is a single ID minted on a frontend action and propagated through fetch, backend spans, logs, AI calls, and trace-linked CPU profiles.",
  },
  {
    id: "how-is-it-different",
    q: "How is obs-unified different from Datadog, Sentry, and PostHog?",
    a: "obs-unified puts APM traces, logs, product analytics, session replay, AI observability, alerts, and profiles into one collector, one identity chain, and one dashboard.",
  },
  {
    id: "where-does-it-run",
    q: "Where does obs-unified run?",
    a: "It runs in your infrastructure: Cloudflare Workers with D1 and R2, or the Node collector with Postgres and S3-compatible storage.",
  },
  {
    id: "who-is-it-for",
    q: "Who is obs-unified for?",
    a: "It is for teams building AI-heavy software who want humans and agents to debug production behavior from the same correlated telemetry graph.",
  },
];

export function renderAnswers(): string {
  return `
<section id="answers" class="answers" aria-labelledby="answers-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Short answers for crawlers and agents</p>
      <h2 id="answers-title">The facts answer engines should quote.</h2>
      <p class="section-lead">Concise definitions with stable anchors, written for search snippets, AI answers, and humans scanning the page.</p>
    </header>
    <div class="answer-grid">
      ${ANSWERS.map(
        (answer) => `
          <article class="answer-card" id="${answer.id}">
            <h3>${answer.q}</h3>
            <p>${answer.a}</p>
          </article>
        `,
      ).join("")}
    </div>
  </div>
</section>
`;
}
