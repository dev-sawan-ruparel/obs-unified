import { siteContent, type Feature } from "../content/site";

function card({ title, body, icon }: Feature): string {
  return `
<article class="feature-card">
  <div class="feature-icon" aria-hidden="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
  </div>
  <h3 class="feature-title">${title}</h3>
  <p class="feature-body">${body}</p>
</article>
`;
}

export function renderFeatures(): string {
  const { features } = siteContent;
  return `
<section id="features" class="features" aria-labelledby="features-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">${features.eyebrow}</p>
      <h2 id="features-title">${features.title}</h2>
      <p class="section-lead">
        ${features.lead}
      </p>
    </header>
    <div class="feature-grid">${features.items.map(card).join("")}</div>
  </div>
</section>
`;
}
