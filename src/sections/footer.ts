import { DOCS_URL, FOOTER_PACKAGES, GITHUB_URL } from "../config";

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
      <p class="muted small footer-brand-copy">
        One collector for traces, logs, AI calls, product events, and replay.
        Keep the telemetry plane in your infrastructure.
      </p>
      <div class="footer-cta-row" aria-label="Primary project links">
        <a href="${DOCS_URL}/installation">Start locally</a>
        <a href="${GITHUB_URL}">View source</a>
      </div>
    </div>
    <nav class="footer-nav" aria-label="Documentation">
      <h4>Docs</h4>
      <a href="${DOCS_URL}">Introduction</a>
      <a href="${DOCS_URL}/installation">Installation</a>
      <a href="${DOCS_URL}/sdks">SDKs and packages</a>
      <a href="${DOCS_URL}/instrumenting">Instrumenting</a>
      <a href="${DOCS_URL}/comparison">Comparison</a>
    </nav>
    <nav class="footer-nav" aria-label="Packages">
      <h4>Packages</h4>
      ${FOOTER_PACKAGES.map((p) => `
        <a class="footer-package-link" href="${p.href}">
          <span>${p.label}</span>
          <code>${p.name}</code>
        </a>
      `).join("")}
    </nav>
    <nav class="footer-nav" aria-label="Project">
      <h4>Project</h4>
      <a href="${GITHUB_URL}">GitHub repository</a>
      <a href="${GITHUB_URL}/issues">Issues and roadmap</a>
      <a href="${GITHUB_URL}/blob/main/LICENSE">MIT license</a>
      <a href="${GITHUB_URL}/releases">Releases</a>
    </nav>
  </div>
  <div class="footer-bottom-wrap">
    <div class="container footer-bottom">
      <p class="muted small">Open source under MIT · public repo on GitHub · ${YEAR}</p>
      <p class="muted small">Cloudflare Workers/D1/R2 or Node/Postgres/S3-compatible storage.</p>
    </div>
  </div>
</footer>
`;
}
