import { DOCS_URL, GITHUB_URL, PACKAGE_NAMES } from "../config";

const YEAR = new Date().getFullYear();

export function renderFooter(): string {
  return `
<footer class="site-footer" role="contentinfo">
  <div class="container footer-grid">
    <div class="footer-brand">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <!-- Prompt + record mark — see @obs-unified/brand/logo/mark.svg. -->
          <svg width="22" height="22" viewBox="0 0 32 32" fill="currentColor"><path d="M7 9 L10 14 L7 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="bevel" stroke-linecap="square"/><rect x="14" y="12.9" width="12" height="2.2"/><rect x="14" y="18.9" width="8" height="2.2"/></svg>
        </span>
        <span class="brand-name">obs-unified</span>
      </div>
      <p class="muted small">Self-hosted observability. One collector, every signal.</p>
    </div>
    <nav class="footer-nav" aria-label="Documentation">
      <h4>Docs</h4>
      <a href="${DOCS_URL}">Introduction</a>
      <a href="${DOCS_URL}/installation">Installation</a>
      <a href="${DOCS_URL}/sdks">SDKs</a>
      <a href="${DOCS_URL}/instrumenting">Instrumenting</a>
    </nav>
    <div class="footer-nav" aria-label="Packages">
      <h4>Packages</h4>
      ${PACKAGE_NAMES.map((p) => `<span class="footer-pkg muted">${p}</span>`).join("")}
    </div>
    <nav class="footer-nav" aria-label="Project">
      <h4>Project</h4>
      <a href="${GITHUB_URL}">GitHub</a>
      <a href="${DOCS_URL}">Read the docs</a>
      <span class="muted small">Open source · MIT</span>
    </nav>
  </div>
  <div class="footer-bottom-wrap">
    <div class="container footer-bottom">
      <p class="muted small">© ${YEAR} obs-unified contributors</p>
      <p class="muted small">Built with vanilla TypeScript + Vite</p>
    </div>
  </div>
</footer>
`;
}
