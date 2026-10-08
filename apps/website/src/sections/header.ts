import { GETTING_STARTED_URL, GITHUB_URL } from "../config";

export function renderHeader(): string {
  return `
<header class="site-header" role="banner">
  <div class="container header-row">
    <a class="brand" href="/" aria-label="Observability Unified home">
      <span class="brand-mark" aria-hidden="true">
        <!-- Prompt + record mark. Source of truth: @obsunified/brand
             (logo/mark.svg). Inline here so the header renders with no
             extra request; keep geometry in sync if the source mark changes. -->
        <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><path d="M7 9 L10 14 L7 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="bevel" stroke-linecap="square"/><rect x="14" y="12.9" width="12" height="2.2"/><rect x="14" y="18.9" width="8" height="2.2"/></svg>
      </span>
      <span class="brand-name">Observability Unified</span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="#screenshots">Product</a>
      <a href="#evidence">Evidence</a>
      <a href="#preview">How it works</a>
      <a href="#compare">Compare</a>
      <a class="btn btn-ghost" href="${GETTING_STARTED_URL}">Docs</a>
      <a class="btn btn-ghost" href="${GITHUB_URL}">GitHub</a>
    </nav>
  </div>
</header>
`;
}
