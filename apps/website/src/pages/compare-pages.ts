import { DOCS_URL, GETTING_STARTED_URL } from "../config";
import {
  AGENT_ACCESS_LEDGER_URL,
  type Cell,
  GROUPS,
  MAIN_LEDGER_URL,
  OBS,
  type RowDef,
  VENDOR_PAGES_LEDGER_URL,
  VENDOR_PAGES_REVIEWED,
  VENDORS,
  type Vendor,
  verdictLabel,
} from "../content/vendor-compare";
import { LAST_REVIEWED, AGENT_ACCESS_REVIEWED } from "../sections/compare";

const COMPARISON_DOC_URL = `${DOCS_URL}/comparison`;
const RIGHT_OF_REPLY_URL = `${COMPARISON_DOC_URL}#right-of-reply`;

export const SITE_ORIGIN = "https://obsunified.com";

export function comparePath(vendor: Vendor): string {
  return `/compare/${vendor.slug}/`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function reviewedFor(row: RowDef): string {
  if (row.added) return VENDOR_PAGES_REVIEWED;
  if (row.key === "mcp_server") return AGENT_ACCESS_REVIEWED;
  return LAST_REVIEWED;
}

function cellHtml(c: Cell, who: string, row: RowDef): string {
  const inferred = c.verdict === "not_marketed";
  const dagger = inferred ? `<sup class="vc-dagger" aria-hidden="true">†</sup>` : "";
  const sourceLabel = who === "obs" ? "our docs" : hostOf(c.source);
  return `<td class="vc-cell">
    <span class="vc-verdict vc-${c.verdict}">${verdictLabel(c.verdict)}${dagger}</span>
    <span class="vc-text">${esc(c.text)}</span>
    <a class="vc-src" href="${esc(c.source)}" rel="noopener" title="Source read ${reviewedFor(row)}">${esc(sourceLabel)}</a>
  </td>`;
}

function tableHtml(vendor: Vendor): string {
  return GROUPS.map(
    (g) => `
    <h3 class="vc-group">${esc(g.title)}</h3>
    <div class="vc-scroll" role="region" aria-label="${esc(g.title)}" tabindex="0">
      <table class="vc-table">
        <thead>
          <tr>
            <th scope="col" class="vc-corner">Capability</th>
            <th scope="col" class="vc-head vc-head-us">Observability Unified</th>
            <th scope="col" class="vc-head">${esc(vendor.name)}</th>
          </tr>
        </thead>
        <tbody>
          ${g.rows
            .map(
              (r) => `
          <tr>
            <th scope="row" class="vc-label" title="${esc(r.question)}">${esc(r.label)}</th>
            ${cellHtml(OBS[r.key], "obs", r)}
            ${cellHtml(vendor.cells[r.key], vendor.key, r)}
          </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`,
  ).join("");
}

// The two summary lists are computed from the cells, so they cannot claim
// more than the table shows.
function differences(vendor: Vendor): { ours: RowDef[]; theirs: RowDef[] } {
  const rows = GROUPS.flatMap((g) => g.rows);
  return {
    ours: rows.filter((r) => OBS[r.key].verdict === "yes" && vendor.cells[r.key].verdict !== "yes"),
    theirs: rows.filter((r) => vendor.cells[r.key].verdict === "yes" && OBS[r.key].verdict !== "yes"),
  };
}

function listHtml(rows: RowDef[], vendor: Vendor, side: "ours" | "theirs"): string {
  if (rows.length === 0) return `<p class="muted small">None in the rows compared here.</p>`;
  return `<ul class="vc-list">${rows
    .map((r) => {
      const c = side === "ours" ? OBS[r.key] : vendor.cells[r.key];
      return `<li><strong>${esc(r.label)}.</strong> ${esc(c.text)}</li>`;
    })
    .join("")}</ul>`;
}

export function vendorPageTitle(vendor: Vendor): string {
  return `Observability Unified vs ${vendor.name}: capability comparison`;
}

export function vendorPageDescription(vendor: Vendor): string {
  return `Compare Observability Unified and ${vendor.name} on MCP access for AI agents, signals, profiles, self-hosting, and single sign-on. Every ${vendor.name} cell links to ${vendor.name}'s own page.`;
}

export function renderVendorPage(vendor: Vendor): string {
  const { ours, theirs } = differences(vendor);
  const others = VENDORS.filter((v) => v.key !== vendor.key);
  return `
<section class="vc-page" aria-labelledby="vc-title">
  <div class="container vc-container">
    <nav class="vc-crumbs muted small" aria-label="Breadcrumb">
      <a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/compare/">Compare</a> <span aria-hidden="true">/</span> <span>${esc(vendor.name)}</span>
    </nav>
    <header class="section-header vc-header">
      <p class="eyebrow">Comparison <span class="cmp-asof">— vendor pages read ${VENDOR_PAGES_REVIEWED}</span></p>
      <h1 id="vc-title">Observability Unified vs ${esc(vendor.name)}</h1>
      <p class="section-lead">${esc(vendor.summary)}</p>
      <p class="section-lead">Observability Unified is a self-hosted platform that connects traces, logs, replay, profiles, and AI agent activity through shared IDs, and gives AI agents evidence with citations through MCP. Each row below says Yes, Partial, or No for both products and links to the page that supports it.</p>
    </header>

    <div class="vc-summary">
      <div class="vc-summary-col">
        <h2 class="vc-summary-title">Where Observability Unified differs</h2>
        ${listHtml(ours, vendor, "ours")}
      </div>
      <div class="vc-summary-col">
        <h2 class="vc-summary-title">Where ${esc(vendor.name)} offers more</h2>
        ${listHtml(theirs, vendor, "theirs")}
      </div>
    </div>

    <h2 class="vc-section-title">Capability by capability</h2>
    ${tableHtml(vendor)}

    <div class="vc-choose">
      <h2 class="vc-section-title">Choosing between them</h2>
      <p><strong>Choose ${esc(vendor.name)} if</strong> ${esc(vendor.chooseIf)}</p>
      <p><strong>Choose Observability Unified if</strong> you want AI agents and engineers to investigate the same production evidence, with the telemetry kept on infrastructure you run. It is early-stage software suited to single-team deployments; the <a href="${COMPARISON_DOC_URL}#where-observability-unified-fits" rel="noopener">documented trade-offs</a> include no built-in SSO, OTLP over HTTP only, and browser-only session replay.</p>
      <p><a class="btn btn-primary" href="${GETTING_STARTED_URL}#investigate-a-slow-checkout">Try the seeded checkout investigation</a></p>
    </div>

    <div class="vc-method muted small">
      <h2 class="vc-section-title">How these cells were checked</h2>
      <p><strong>Yes</strong> and <strong>Partial</strong> cells cite the vendor's own docs, pricing, product page, or official repository. <strong>No</strong> is used only where the cited page says so. <strong>Not marketed†</strong> means we read the vendor's product pages and found no such capability; it is an inference, not a vendor statement. <strong>Not stated</strong> means the vendor's docs do not say either way.</p>
      <p>Rows for MCP write defaults, MCP links, agent tool calls, CPU profiles, self-hosting, and SSO were read on ${VENDOR_PAGES_REVIEWED} (<a href="${VENDOR_PAGES_LEDGER_URL}" rel="noopener">ledger with excerpts</a>). The MCP server row was read on ${AGENT_ACCESS_REVIEWED} (<a href="${AGENT_ACCESS_LEDGER_URL}" rel="noopener">ledger</a>), and the remaining rows on ${LAST_REVIEWED} (<a href="${MAIN_LEDGER_URL}" rel="noopener">ledger</a>). Vendors change their products often; if a cell is out of date, <a href="${RIGHT_OF_REPLY_URL}" rel="noopener">send a correction</a>. The <a href="${COMPARISON_DOC_URL}" rel="noopener">full comparison</a> covers all nine vendors with excerpts.</p>
    </div>

    <nav class="vc-others" aria-label="Other comparisons">
      <h2 class="vc-section-title">Other comparisons</h2>
      <ul>${others.map((v) => `<li><a href="${comparePath(v)}">Observability Unified vs ${esc(v.name)}</a></li>`).join("")}</ul>
    </nav>
  </div>
</section>`;
}

export function renderCompareIndex(): string {
  return `
<section class="vc-page" aria-labelledby="vc-title">
  <div class="container vc-container">
    <nav class="vc-crumbs muted small" aria-label="Breadcrumb">
      <a href="/">Home</a> <span aria-hidden="true">/</span> <span>Compare</span>
    </nav>
    <header class="section-header vc-header">
      <p class="eyebrow">Comparisons <span class="cmp-asof">— vendor pages read ${VENDOR_PAGES_REVIEWED}</span></p>
      <h1 id="vc-title">Compare Observability Unified</h1>
      <p class="section-lead">One page per vendor, with a Yes, Partial, or No for both products on each capability and a link to the page that supports it. The <a href="/#compare">homepage table</a> shows all nine vendors side by side.</p>
    </header>
    <ul class="vc-index">
      ${VENDORS.map((v) => `<li><a href="${comparePath(v)}"><strong>Observability Unified vs ${esc(v.name)}</strong><span class="muted small">${esc(v.summary)}</span></a></li>`).join("")}
    </ul>
  </div>
</section>`;
}
