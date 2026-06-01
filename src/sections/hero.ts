import { GETTING_STARTED_URL, GITHUB_URL, SDK_DOCS_URL } from "../config";

export function renderHero(): string {
  return `
<section class="hero" aria-labelledby="hero-title">
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Open source · MIT licensed</p>
      <h1 id="hero-title" class="hero-title">
        <span class="hero-title-line">Unified observability</span>
        <span class="accent">for every signal.</span>
      </h1>
      <p class="hero-lead">
        <strong>Built for agentic debugging:</strong> one telemetry graph agents
        can traverse from user action to a bookmarkable Agent Action Graph,
        backend trace, logs, replay, AI cost, CPU profile, and MCP tool context.
        <strong>obs-unified</strong> puts every signal into <strong>one
        collector</strong>, <strong>one identity chain</strong>, <strong>one
        dashboard</strong>, and a read-only <strong>MCP server for
        agents</strong>, so humans and agents discover root cause faster. Start
        locally with one Docker image, then run on Cloudflare Workers + D1 + R2
        or Node + Postgres + S3.
      </p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${GETTING_STARTED_URL}">
          Get started
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
        <a class="btn btn-secondary" href="${GITHUB_URL}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.6.5.5 5.7.5 12.1c0 5.1 3.3 9.4 7.9 11 .6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.5-.3-5.1-1.3-5.1-5.7 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.1 0 4.4-2.6 5.4-5.1 5.7.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6 4.6-1.5 7.9-5.9 7.9-11C23.5 5.7 18.4.5 12 .5z"/></svg>
          View on GitHub
        </a>
      </div>
      <div class="hero-meta">
        <span><strong>SDKs + MCP</strong> TypeScript · Go · Rust · browser · agents</span>
        <a class="hero-meta-langs" href="${SDK_DOCS_URL}">SDK docs</a>
      </div>
      <p class="hero-chain">
        Identity propagated end-to-end:
        <code>user_id → session_id → interaction_id → trace_id → span_id</code>
        <span>The interaction ID follows a frontend action into backend spans, logs,
        AI calls, and MCP tools; CPU/off-CPU profiles join through the trace it
        caused.</span>
      </p>
    </div>
    <figure class="hero-product-shot">
      <div class="hero-shot-frame">
        <img src="/screenshots/app/agent-action-graph.png" alt="obs-unified dashboard showing an agent action graph connected to traces, logs, replay, AI costs, and CPU profile evidence" width="1440" height="1000" />
      </div>
      <figcaption>
        <span>Bookmarkable Agent Action Graph</span>
        <p>Nested action pages tie the user action to agent steps, tool calls, backend traces, logs, replay, AI cost, MCP context, and profile evidence.</p>
      </figcaption>
    </figure>
  </div>
</section>
`;
}
