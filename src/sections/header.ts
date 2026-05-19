import { DOCS_URL, GITHUB_URL } from "../config";

export function renderHeader(): string {
  return `
<header class="site-header" role="banner">
  <div class="container header-row">
    <a class="brand" href="/" aria-label="obs-unified home">
      <span class="brand-mark" aria-hidden="true">
        <!-- Three-rows ledger mark. Source of truth: @obs-unified/brand
             (logo/mark.svg). Inline here so the header renders with no
             extra request; keep geometry in sync if the source mark changes. -->
        <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><rect x="6" y="9" width="17" height="2.5"/><rect x="6" y="14.75" width="11" height="2.5"/><rect x="6" y="20.5" width="20" height="2.5"/></svg>
      </span>
      <span class="brand-name">obs-unified</span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="#features">Features</a>
      <a href="#preview">Preview</a>
      <a href="#compare">Compare</a>
      <a href="#architecture">Architecture</a>
      <a href="#faq">FAQ</a>
      <a href="${DOCS_URL}">Docs</a>
      <a class="btn btn-ghost" href="${GITHUB_URL}">GitHub</a>
    </nav>
  </div>
</header>
`;
}
