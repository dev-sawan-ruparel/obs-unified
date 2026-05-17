const DOCS_URL = "https://obsunified.com/docs";
const GITHUB_URL = "https://github.com/obs-unified/obs-unified";

export function renderHeader(): string {
  return `
<header class="site-header" role="banner">
  <div class="container header-row">
    <a class="brand" href="/" aria-label="obs-unified home">
      <span class="brand-mark" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 12h4M17 12h4M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>
      </span>
      <span class="brand-name">obs-unified</span>
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="#features">Features</a>
      <a href="#preview">Preview</a>
      <a href="#architecture">Architecture</a>
      <a href="#faq">FAQ</a>
      <a href="${DOCS_URL}">Docs</a>
      <a class="btn btn-ghost" href="${GITHUB_URL}" rel="noopener" target="_blank">GitHub</a>
    </nav>
  </div>
</header>
`;
}
