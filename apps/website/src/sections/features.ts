import { siteContent, type Feature } from "../content/site";
import { messaging } from "../content/messaging.generated";

function card(item: Feature): string {
  const capability = messaging.authored.capabilities.find((c) => c.id === item.capabilityId);
  const status = capability ? capability.status : "shipped";
  const badgeClass = `feature-badge badge-${status}`;
  const badgeLabel = status.charAt(0).toUpperCase() + status.slice(1);

  return `
<article class="feature-card">
  <div class="feature-card-header">
    <div class="feature-icon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
    </div>
    <span class="${badgeClass}">${badgeLabel}</span>
  </div>
  <h3 class="feature-title">${item.title}</h3>
  <p class="feature-body">${item.body}</p>
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

