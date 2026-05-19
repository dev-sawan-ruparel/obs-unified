import { DOCS_URL, GITHUB_URL } from "../config";

export function renderHero(): string {
  return `
<section class="hero" aria-labelledby="hero-title">
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Open source · MIT licensed</p>
      <h1 id="hero-title" class="hero-title">
        Every signal,<br/>
        <span class="accent">two clicks away.</span>
      </h1>
      <p class="hero-lead">
        <strong>obs-unified</strong> is a self-hosted observability stack where
        traces, logs, AI calls, usage events, replays, alerts, and user profiles
        all live in one collector — and the <strong>Connected rail</strong> on every
        detail page surfaces the entity's neighbors, so you pivot from any signal
        to any other in <strong>≤2 clicks</strong>. Runs end-to-end on Cloudflare
        Workers + D1 + R2, with a Node collector path for Postgres + S3-compatible storage.
      </p>
      <div class="cta-row">
        <a class="btn btn-primary" href="${DOCS_URL}">
          Read the docs
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
        <a class="btn btn-secondary" href="${GITHUB_URL}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.6.5.5 5.7.5 12.1c0 5.1 3.3 9.4 7.9 11 .6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.4-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.5-.3-5.1-1.3-5.1-5.7 0-1.2.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.7.2 2.9.1 3.2.7.8 1.2 1.9 1.2 3.1 0 4.4-2.6 5.4-5.1 5.7.4.4.8 1.1.8 2.3v3.4c0 .3.2.7.8.6 4.6-1.5 7.9-5.9 7.9-11C23.5 5.7 18.4.5 12 .5z"/></svg>
          View on GitHub
        </a>
      </div>
      <div class="hero-meta">
        <span><strong>npm</strong> install @obs-unified/telemetry-sdk</span>
      </div>
      <p class="hero-chain">
        Identity propagated end-to-end:
        <code>user_id → session_id → interaction_id → trace_id → span_id</code>
      </p>
    </div>
    <aside class="hero-preview" aria-hidden="true">
      <div class="window">
        <div class="window-chrome">
          <span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span>
          <span class="window-title">dashboard · trace · connected rail</span>
        </div>
        <div class="window-body">
          <div class="signal-row"><span class="tag tag-int">INTERACTION</span> button.checkout.click <span class="muted">user_412</span></div>
          <div class="signal-row indent"><span class="tag tag-trace">TRACE</span> POST /api/checkout <span class="muted">→ 187ms</span></div>
          <div class="signal-row indent"><span class="tag tag-log">LOG</span> stripe.charge.created <span class="muted">amount=4900</span></div>
          <div class="signal-row indent"><span class="tag tag-ai">AI</span> claude-sonnet-4 · 230ms · $0.0021</div>
          <div class="signal-row indent"><span class="tag tag-replay">REPLAY</span> 00:42 → 00:51 <span class="muted">rrweb</span></div>
          <div class="signal-row indent"><span class="tag tag-alert">ALERT</span> p99 latency · threshold breach</div>
        </div>
        <div class="window-footnote">↑ one trace · six neighbors · all ≤1 click away</div>
      </div>
    </aside>
  </div>
</section>
`;
}
