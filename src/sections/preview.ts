import { EXAMPLES_URL, GETTING_STARTED_URL, SDK_DOCS_URL } from "../config";

const FIRST_RUN = `# Fastest first run
docker run --rm -p 5173:5173 -p 8790:8790 \\
  ghcr.io/obs-unified/local:latest

# Editable local repo
git clone https://github.com/obs-unified/obs-unified.git
cd obs-unified
pnpm install
pnpm local:image
pnpm local:run`;

const SDK_PATHS = `Backend:
  TypeScript  @obs-unified/* on GitHub Packages
  Go          sdks/go
  Rust        sdks/rust

Browser:
  React/vanilla  @obs-unified/analytics-sdk`;

const INSTRUMENT = `// Backend
initObservability({ serviceName: "checkout-api" });
const log = createLogger("checkout");
const llm = startLLMSpan("checkout.assistant");
log.info("charge.starting", { interaction_id });
llm.end();

// Frontend
trackInteraction("checkout_click");`;

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function code(lang: string, src: string): string {
  return `
    <div class="code-panel" data-lang="${lang}">
      <div class="code-panel-head">
        <span>${lang}</span>
        <button class="copy-button" type="button" data-copy="${escapeAttr(src)}">Copy</button>
      </div>
      <pre class="code-block"><code>${escapeHtml(src)}</code></pre>
    </div>
  `;
}

export function renderPreview(): string {
  return `
<section id="preview" class="preview" aria-labelledby="preview-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Quick preview</p>
      <h2 id="preview-title">From zero to correlated signals in three steps</h2>
      <p class="section-lead">
        Start the local stack, pick SDKs for your runtime, and initialize each service.
        Backend spans, frontend interactions, and AI spans share the same identity chain automatically.
      </p>
    </header>
    <div class="preview-grid">
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">1</span> Run the GHCR image</div>
        <p class="preview-step-note">Pull the all-in-one image from GHCR, or build the same image from a clone.</p>
        ${code("bash", FIRST_RUN)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">2</span> Pick SDKs</div>
        <p class="preview-step-note">Runnable examples and recipes live in <a href="${EXAMPLES_URL}">Examples</a> and <a href="${SDK_DOCS_URL}">SDK docs</a></p>
        ${code("text", SDK_PATHS)}
      </div>
      <div class="preview-card">
        <div class="preview-step"><span class="step-num">3</span> Instrument backend and frontend</div>
        <p class="preview-step-note">Short path shown. Full TypeScript, <strong>Go</strong>, and <strong>Rust</strong> examples live in <a href="${GETTING_STARTED_URL}">Getting started</a>.</p>
        ${code("typescript", INSTRUMENT)}
      </div>
    </div>
  </div>
</section>
`;
}
