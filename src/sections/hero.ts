import { GETTING_STARTED_URL, GITHUB_URL, SDK_DOCS_URL } from "../config";
import { siteContent } from "../content/site";

export function renderHero(): string {
  const { hero } = siteContent;
  return `
<section class="hero" aria-labelledby="hero-title">
  <div class="container hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">${hero.eyebrow}</p>
      <h1 id="hero-title" class="hero-title">
        <span class="hero-title-line">${hero.titleLine}</span>
        <span class="accent">${hero.accent}</span>
      </h1>
      <p class="hero-lead">
        ${hero.leadHtml}
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
        <span>${hero.metaLabelHtml}</span>
        <a class="hero-meta-langs" href="${SDK_DOCS_URL}">${hero.metaLinkLabel}</a>
      </div>
      <p class="hero-chain">
        ${hero.identityLabel}
        <code>${hero.identityChain}</code>
        <span>${hero.identityBody}</span>
      </p>
    </div>
    <figure class="hero-product-shot">
      <div class="hero-shot-frame">
        <img src="/screenshots/app/agent-action-graph.png" alt="${hero.imageAlt}" width="1180" height="900" />
      </div>
      <figcaption>
        <span>${hero.figcaptionTitle}</span>
        <p>${hero.figcaptionBody}</p>
      </figcaption>
    </figure>
  </div>
</section>
`;
}
