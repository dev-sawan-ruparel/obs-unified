import { DOCS_URL } from "../config";

const COMPARISON_URL = `${DOCS_URL}/comparison`;
const AUDIT_LEDGER_URL =
  "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/comparison-full-audit-2026-10-11.md";

export function renderCompare(): string {
  return `
<section id="compare" class="compare" aria-labelledby="compare-title">
  <div class="container">
    <header class="section-header">
      <p class="eyebrow">Product evaluation & fit guide <span class="cmp-asof">— audit status: unverified competitor claims withheld</span></p>
      <h2 id="compare-title">Evaluate obs-unified for your stack</h2>
      <p class="section-lead">
        Observability Unified brings distributed traces, structured logs, session replay, and AI agent observability under one identity chain and one dashboard, deploying to your own infrastructure via Cloudflare Workers with D1/R2 or Node with PostgreSQL/S3.
      </p>
    </header>

    <div class="feature-card" style="margin-bottom: 24px; border-left: 4px solid var(--color-sys-warning);">
      <div class="feature-card-header">
        <h3 class="feature-title" style="margin: 0; font-size: 15px; color: var(--color-sys-on-surface);">Comparison Audit Status & Public Disclosure</h3>
        <span class="feature-badge" style="background: color-mix(in srgb, var(--color-sys-warning) 16%, transparent); color: var(--color-sys-warning);">Audit Incomplete (0/90)</span>
      </div>
      <p class="feature-body" style="margin: 8px 0 12px; font-size: 13px; line-height: 1.5; color: var(--color-sys-on-surface-muted);">
        In accordance with our evidence-integrity standards, the detailed 9-vendor comparison table has been withheld from public rendering. The tracked comparison audit ledger (<a href="${AUDIT_LEDGER_URL}" rel="noopener">docs/comparison-full-audit-2026-10-11.md</a>) records that <strong>0 of 90 vendor capability cells</strong> have been independently validated against live primary sources. Rather than publish unverified competitor claims, this section outlines repo-backed capabilities and operational boundaries to help you evaluate if obs-unified fits your stack.
      </p>
      <p class="feature-body" style="margin: 0; font-size: 12px; color: var(--color-sys-on-surface-subtle);">
        Read the architectural evaluation guide in <a href="${COMPARISON_URL}" rel="noopener">the documentation</a>, or inspect the raw audit ledger in the repository.
      </p>
    </div>

    <div class="feature-grid">
      <article class="feature-card">
        <h3 class="feature-title">Correlated Telemetry Graph</h3>
        <p class="feature-body">
          Connects distributed traces, structured logs, session replay (rrweb), and AI agent execution runs into one traversable graph. A single identity chain links client interactions directly to backend spans and LLM tool calls.
        </p>
      </article>

      <article class="feature-card">
        <h3 class="feature-title">Self-Hosted Storage Adapters</h3>
        <p class="feature-body">
          Runs in your own infrastructure. Supported storage engines include Cloudflare Workers with D1 and R2, or Node deployments with PostgreSQL and S3-compatible object storage. Telemetry is written directly to your configured datastores.
        </p>
      </article>

      <article class="feature-card">
        <h3 class="feature-title">OpenTelemetry Ingestion</h3>
        <p class="feature-body">
          Ingests telemetry via standard OpenTelemetry HTTP protocols (OTLP/HTTP for traces, logs, and metrics). Supports instrumentation with standard OpenTelemetry SDKs across TypeScript, Python, and Go.
        </p>
      </article>

      <article class="feature-card">
        <h3 class="feature-title">Documented Boundaries & Limitations</h3>
        <p class="feature-body">
          obs-unified is early-stage software designed for single-team deployments. It uses single-password token authentication (no enterprise SSO/RBAC), requires an OpenTelemetry Collector for gRPC workloads, and focuses on causal trace narratives rather than custom query builders.
        </p>
      </article>
    </div>

    <p class="cmp-footnote muted small">
      Detailed architectural documentation, self-hosting runbooks, and audit disclosures live in
      <a href="${COMPARISON_URL}" rel="noopener">the product evaluation doc</a> and the
      <a href="${AUDIT_LEDGER_URL}" rel="noopener">tracked audit ledger</a>.
    </p>
  </div>
</section>
`;
}
