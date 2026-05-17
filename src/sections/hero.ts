export function renderHero(): string {
  return `
<section class="hero" aria-labelledby="hero-title">
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Open source · MIT licensed · Self-hosted</p>
      <h1 id="hero-title" class="hero-title">
        Every signal,<br/>
        <span class="accent">two clicks away.</span>
      </h1>
      <p class="hero-lead">
        <strong>obs-unified</strong> is a self-hosted observability stack where
        traces, logs, AI calls, sessions, replays, alerts, and profiles all live
        in one collector — and the <strong>Connected rail</strong> on every detail
        page surfaces the entity's neighbors, so you pivot from any signal to any
        other in <strong>≤2 clicks</strong>. End-to-end click-to-CPU on Cloudflare
        Workers + D1 + R2.
      </p>
      <div class="cta-row">
        <a class="btn btn-primary" href="https://obsunified.com/docs">
          Read the docs
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
        </a>
        <a class="btn btn-secondary" href="https://github.com/sawanruparel/obs-unified" rel="noopener" target="_blank">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.12 3.04.73.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.77 1.06.77 2.14 0 1.55-.01 2.79-.01 3.17 0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z"/></svg>
          Star on GitHub
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
