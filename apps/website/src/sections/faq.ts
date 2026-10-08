import { FAQS, type QA } from "../content/faq";

function item({ q, a }: QA): string {
  return `
<details class="faq-item">
  <summary>${q}</summary>
  <p>${a}</p>
</details>`;
}

export function renderFaq(): string {
  return `
<section id="faq" class="faq" aria-labelledby="faq-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">FAQ</p>
      <h2 id="faq-title">Operational questions, answered up front</h2>
      <p class="section-lead">The questions evaluators ask in the first call — also exposed as structured data for AI search.</p>
    </header>
    <div class="faq-list">${FAQS.map(item).join("")}</div>
  </div>
</section>
`;
}
