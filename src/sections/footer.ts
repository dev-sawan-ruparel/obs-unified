const YEAR = new Date().getFullYear();

export function renderFooter(): string {
  return `
<footer class="site-footer" role="contentinfo">
  <div class="container footer-grid">
    <div class="footer-brand">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M3 12h4M17 12h4M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>
        </span>
        <span class="brand-name">obs-unified</span>
      </div>
      <p class="muted small">Self-hosted observability. One collector, every signal.</p>
    </div>
    <nav class="footer-nav" aria-label="Documentation">
      <h4>Docs</h4>
      <a href="https://obsunified.com/docs">Introduction</a>
      <a href="https://obsunified.com/docs/installation">Installation</a>
      <a href="https://obsunified.com/docs/sdks">SDKs</a>
      <a href="https://obsunified.com/docs/instrumenting">Instrumenting</a>
    </nav>
    <nav class="footer-nav" aria-label="Packages">
      <h4>Packages</h4>
      <a href="https://www.npmjs.com/package/@obs-unified/collector">@obs-unified/collector</a>
      <a href="https://www.npmjs.com/package/@obs-unified/telemetry-sdk">@obs-unified/telemetry-sdk</a>
      <a href="https://www.npmjs.com/package/@obs-unified/analytics-sdk">@obs-unified/analytics-sdk</a>
      <a href="https://www.npmjs.com/package/@obs-unified/dashboard">@obs-unified/dashboard</a>
    </nav>
    <nav class="footer-nav" aria-label="Project">
      <h4>Project</h4>
      <a href="https://github.com/obs-unified/obs-unified" rel="noopener" target="_blank">GitHub</a>
      <a href="https://github.com/obs-unified/obs-unified/blob/main/README.md" rel="noopener" target="_blank">README</a>
      <a href="https://github.com/obs-unified/obs-unified/issues" rel="noopener" target="_blank">Issues</a>
      <a href="https://github.com/obs-unified/obs-unified/blob/main/CONTRIBUTING.md" rel="noopener" target="_blank">Contributing</a>
    </nav>
  </div>
  <div class="container footer-bottom">
    <p class="muted small">© ${YEAR} obs-unified contributors · MIT License</p>
    <p class="muted small">Built with vanilla TypeScript + Vite</p>
  </div>
</footer>
`;
}
