import { siteContent } from "../content/site";

export function renderCcr(): string {
  const { ccr } = siteContent;
  return `
<section id="evidence" class="ccr" aria-labelledby="ccr-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">${ccr.eyebrow}</p>
      <h2 id="ccr-title">${ccr.title}</h2>
      <p class="section-lead">${ccr.lead}</p>
    </header>

    <div class="ccr-compare" aria-label="Before and after compressed context retrieval">
      <article class="ccr-panel ccr-panel-before">
        <div class="ccr-panel-kicker">Before CCR</div>
        <h3>${ccr.beforeTitle}</h3>
        <p>${ccr.beforeBody}</p>
        <pre class="ccr-code"><code>search_logs({ traceId, limit: 500 })
get_trace(traceId)
get_action(actionId)
get_profile(profileId)
get_replay(sessionId)</code></pre>
      </article>

      <article class="ccr-panel ccr-panel-after">
        <div class="ccr-panel-kicker">After CCR</div>
        <h3>${ccr.afterTitle}</h3>
        <p>${ccr.afterBody}</p>
        <pre class="ccr-code"><code>get_evidence_bundle({ anchor, targetTokens })
retrieve_evidence_ref(refId)
search_evidence_ref(refId, "checkout 404")
get_evidence_stats()</code></pre>
      </article>
    </div>

    <div class="ccr-benchmark">
      <div class="ccr-benchmark-copy">
        <p class="eyebrow">Benchmark recipe</p>
        <h3>${ccr.benchmarkTitle}</h3>
        <p>${ccr.benchmarkLead}</p>
      </div>
      <div class="ccr-case-grid">
        ${ccr.benchmarkCases
          .map(
            (item) => `
          <article class="ccr-case">
            <h4>${item.name}</h4>
            <dl>
              <div>
                <dt>CCR off</dt>
                <dd>${item.withoutCcr}</dd>
              </div>
              <div>
                <dt>CCR on</dt>
                <dd>${item.withCcr}</dd>
              </div>
              <div>
                <dt>Measure</dt>
                <dd>${item.measure}</dd>
              </div>
            </dl>
          </article>`,
          )
          .join("")}
      </div>
    </div>
  </div>
</section>
`;
}
