# Competitor Comparison Audit Ledger: AI agent access (MCP) row (2026-11-10)

> **Audit status: 9 of 9 vendor cells directly source-checked against live primary pages on 2026-11-10; 0 cells are inferential negatives.** Every vendor in the matrix documents a first-party MCP server on its own docs or product domain, so no cell is rendered as "Not marketed†".
>
> **Verdict counts (claims as drafted for this new row, checked against the live page before publication):**
> `TRUE` **9** · `PARTIALLY_TRUE` **0** · `OUTDATED` **0** · `FALSE` **0** · `UNVERIFIABLE` **0** · Total **9**
>
> **Method:** Manual audit (runbook Option B in [`apps/docs/scripts/COMPARISON_AUDIT.md`](../apps/docs/scripts/COMPARISON_AUDIT.md)). No multi-agent workflow was run. Every cited page was fetched directly with `curl -sSL --compressed` on 2026-11-10 and converted to text with a standard-library Python HTML parser (`python3 -I`). No page in this pass needed a page-fetch tool: the grafana.com docs pages read here were served to `curl` without the brotli-only issue that affects `grafana.com/pricing/` and `grafana.com/products/cloud/`, and the PostHog MCP docs page rendered its text server-side. Excerpts below are verbatim from the fetched page text. Search-engine snippets were not used as evidence.
>
> **Relationship to the main ledger:** this is a supplement to [`comparison-full-audit-2026-10-13.md`](./comparison-full-audit-2026-10-13.md), which remains the ledger for the other 90 cells (10 axes × 9 vendors) and their 2026-10-13 review date. This file covers only the eleventh axis, added on 2026-11-10. `apps/website/scripts/comparison-check.mjs` validates both ledgers.

---

## 1. Scope and rules

- **Matrix:** 9 vendors × 1 axis = 9 cells. The Observability Unified column is checked against this repository, not a vendor page (see section 5).
- **Axis:** *AI agent access (MCP)* — whether the vendor ships a first-party Model Context Protocol server that AI agents can connect to, whether it is hosted by the vendor or run by the customer, and, where the vendor states it, how write tools are gated.
- **First-party test:** the MCP server must be documented on the vendor's own docs or product domain (for HyperDX, ClickHouse's docs, since ClickHouse acquired HyperDX; see the main ledger). Community or third-party MCP servers do not count.
- **Evidence standard:** as in the main ledger. A cell is `TRUE` only if a directly fetched vendor page contains text that supports the precise claim. Where a vendor does not state whether tools are read-only or can write, the cell says nothing about it.
- **Negatives:** never inferred from silence. Had a vendor had no first-party MCP server on the pages read, the cell would have been rendered as "Not marketed†" and marked `UNVERIFIABLE`. None qualified on 2026-11-10.
- **Verdict meaning for a new row:** there is no historical claim for this axis. Each verdict records whether the drafted cell is supported by the live page on 2026-11-10. Drafts were adjusted to the source before publication; no drafted claim was published unsupported.
- **Redirects:** the final URL after redirects is recorded.

### Verdict rubric (from the runbook)

| Verdict | Meaning |
|---|---|
| `TRUE` | Claim accurate; supporting text present on the live page. |
| `PARTIALLY_TRUE` | Directionally right but imprecise; wording tightened. |
| `OUTDATED` | Was true when written; vendor changed it (rename, GA, price, new option). |
| `FALSE` | Not true now; usually a negative cell the vendor has since filled. |
| `UNVERIFIABLE` | Inferential negative with no explicit vendor statement; softened to "Not marketed". |

---

## 2. Summary of public copy

| Column | Public cell (website table) |
|---|---|
| Observability Unified | Stdio MCP · read-only default · citations |
| Datadog | Remote MCP · writes need permissions |
| Sentry | Hosted MCP (OAuth) · local via CLI |
| PostHog | Hosted MCP · read + write tools |
| Honeycomb | Hosted MCP · scoped write tools |
| New Relic | Hosted MCP (US · EU · JP) |
| Grafana Cloud | Hosted Cloud MCP · self-managed OSS |
| SigNoz | Hosted MCP (Cloud) · self-host binary |
| Uptrace | Built-in MCP · read/write scopes |
| HyperDX | ClickStack OSS/BYOC MCP · not v1 cloud |

---

## 3. The 9-cell ledger

| # | Vendor | Claim (2026-11-10) | Verdict | Final URL read (redirect) | Verbatim excerpt |
|---|---|---|---|---|---|
| 1 | Datadog | Remote (Datadog-hosted) MCP server; write tools require the matching Datadog permission | `TRUE` | https://docs.datadoghq.com/bits_ai/mcp_server/ → https://docs.datadoghq.com/mcp_server/ | "It provides remote access to most Datadog products (APM, logs, metrics, monitors, dashboards, security signals, and more)."; "Write operations require the corresponding permission, such as monitors_write, and the MCP Server checks it on each tool call. A read-only user’s call to a write-enabled tool is rejected." |
| 2 | Sentry | Hosted MCP server over HTTP with OAuth; local stdio server via the Sentry CLI | `TRUE` | https://docs.sentry.io/product/sentry-mcp/ → https://mcp.sentry.dev/ | "All connections use OAuth."; "The base MCP server address is: https://mcp.sentry.dev/mcp"; "Install the Sentry CLI and log in, then register sentry mcp as a stdio MCP server." |
| 3 | PostHog | Free hosted MCP endpoint; agents can read and write across PostHog products | `TRUE` | https://posthog.com/docs/model-context-protocol | "The PostHog Model Context Protocol (MCP) server is a free, hosted endpoint that lets your AI agent use PostHog"; "Once connected, your agent can read and write across PostHog's products." |
| 4 | Honeycomb | Hosted MCP server (US and EU endpoints); most tools read-only, writes require an OAuth or API-key scope | `TRUE` | https://docs.honeycomb.io/integrations/mcp/ → https://docs.honeycomb.io/integrations/mcp/concepts · https://docs.honeycomb.io/integrations/mcp/configuration-guide | "Most tools are read-only. Tools for Boards, Triggers, SLOs, notification recipients, and Canvas investigations require a scope for that resource."; "During OAuth consent, you can give read-only access to all resources, read and write access to all resources, or choose access for each resource."; config guide: "claude mcp add honeycomb --transport http https://mcp.honeycomb.io/mcp"; EU tab: `https://mcp.eu1.honeycomb.io/mcp`. |
| 5 | New Relic | Hosted MCP server with US, EU, and JP regional endpoints | `TRUE` | https://docs.newrelic.com/docs/agentic-ai/mcp/setup/ · https://docs.newrelic.com/docs/agentic-ai/mcp/overview/ | "the US region (default) MCP connection URL: https://mcp.newrelic.com/mcp/ … EU: https://mcp.eu.newrelic.com/mcp/ JP: https://mcp.jp.newrelic.com/mcp/"; overview: "The MCP server allows supported AI agent(s) to call certain tools that may help you query, investigate, or act on New Relic data in natural language." |
| 6 | Grafana Cloud | Two first-party options: fully hosted Grafana Cloud MCP server, and a self-managed OSS MCP server | `TRUE` | https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/ · https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/cloud-mcp/ · https://github.com/grafana/mcp-grafana | "Grafana offers two Model Context Protocol (MCP) server options"; "Cloud MCP Server: Fully hosted Model Context Protocol server that lets external AI agents connect directly to your Grafana Cloud data using OAuth 2.1 authorization."; "OSS MCP Server: Self-managed open source MCP server for Grafana Cloud and self-managed Grafana."; repo: "--disable-write: Disable write tools (create/update operations)". |
| 7 | SigNoz | Hosted MCP server for SigNoz Cloud; self-hosted users run the `signoz-mcp-server` binary | `TRUE` | https://signoz.io/docs/ai/signoz-mcp-server/ | "Connect your AI tool to SigNoz Cloud's hosted MCP server. No installation required: just add the URL and authenticate."; "https://mcp.<region>.signoz.cloud/mcp"; "Environment variables for the self-hosted MCP server. SigNoz Cloud users do not need to set these."; "Absolute path to the signoz-mcp-server binary". |
| 8 | Uptrace | MCP server built into Uptrace (cloud and self-hosted); OAuth grants carry read or write scopes | `TRUE` | https://uptrace.dev/features/mcp | "Uptrace ships with a built-in Model Context Protocol (MCP) server."; "OAuth grants expire, apply to one project, and carry read or write scopes."; "Write tools also require write permission."; "Self-hosted operators can configure these methods with mcp and oauth settings." |
| 9 | HyperDX | Built-in MCP server in open-source and BYOC ClickStack; not available on HyperDX v1 (hyperdx.io) | `TRUE` | https://clickhouse.com/docs/use-cases/observability/clickstack/mcp → https://clickhouse.com/docs/clickstack/mcp · https://www.hyperdx.io/docs | "ClickStack includes a built-in Model Context Protocol (MCP) server that lets AI assistants interact with your observability data."; "The MCP server is available in Open Source ClickStack and BYOC (Bring Your Own Cloud) deployments. HyperDX v1 (hyperdx.io) is not supported."; the `www.hyperdx.io/docs` navigation read on 2026-11-10 has no MCP entry, consistent with that statement. |

---

## 4. Inferential negatives (0 cells)

None. Every vendor documents a first-party MCP server on the pages read on 2026-11-10. If a later review finds a vendor's MCP docs removed, the cell must be re-read and, absent an explicit statement, rendered as "Not marketed†" with what was read listed here.

---

## 5. Observability Unified column (repository check, not a vendor read)

Checked against this repository on 2026-11-10:

- `packages/mcp-server/src/index.ts`: `new StdioServerTransport()` is the only transport; write tools are registered only when `process.env.OBS_MCP_ENABLE_WRITES?.trim().toLowerCase() === "true"`.
- `packages/mcp-server/README.md`: "The server is read-only by default."; "This is a stdio MCP server."; bundles carry "citations, and suggested pivots" and `retrievalRefs`; "The server registers 26 read-only tools by default. Four more tools can change collector state, and they are **not registered at all** unless you set `OBS_MCP_ENABLE_WRITES=true`".
- The server runs next to the agent and connects to a self-hosted collector (`OBS_COLLECTOR_URL`); there is no vendor-hosted MCP endpoint.

---

## 6. Source reads (consolidated)

All pages below were fetched with `curl -sSL --compressed` on **2026-11-10**. "→" marks a redirect from the requested URL to the URL actually read.

**Datadog:** `docs.datadoghq.com/bits_ai/mcp_server/` → `docs.datadoghq.com/mcp_server/`.

**Sentry:** `docs.sentry.io/product/sentry-mcp/` → `mcp.sentry.dev/`.

**PostHog:** `posthog.com/docs/model-context-protocol`.

**Honeycomb:** `docs.honeycomb.io/integrations/mcp/` → `docs.honeycomb.io/integrations/mcp/concepts` · `docs.honeycomb.io/integrations/mcp/configuration-guide/` → `docs.honeycomb.io/integrations/mcp/configuration-guide`.

**New Relic:** `docs.newrelic.com/docs/agentic-ai/mcp/overview/` · `docs.newrelic.com/docs/agentic-ai/mcp/setup/` · `docs.newrelic.com/docs/agentic-ai/mcp/tool-reference/`.

**Grafana:** `grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/` · `grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/cloud-mcp/` · `github.com/grafana/mcp-grafana` · `grafana.com/docs/grafana-cloud/machine-learning/assistant/` → `grafana.com/docs/grafana-cloud/platform/grafana-assistant/` (navigation only, used to locate the MCP pages).

**SigNoz:** `signoz.io/docs/ai/signoz-mcp-server/` · `github.com/SigNoz/signoz-mcp-server`.

**Uptrace:** `uptrace.dev/` · `uptrace.dev/features/mcp`.

**HyperDX:** `clickhouse.com/docs/use-cases/observability/clickstack/mcp` → `clickhouse.com/docs/clickstack/mcp` · `www.hyperdx.io/docs`.

---

## 7. Remaining gaps and next review

- **Write gating is described only where the vendor states it.** Sentry and New Relic pages read do not state a read-only default or a write switch, so their cells say nothing about writes. New Relic's OAuth scopes list `observability:read`, and its setup page warns that "your AI will take actions in your New Relic account on your behalf"; neither is summarized in the cell.
- **Preview / availability to re-check:** Grafana Cloud MCP requires Grafana Assistant to be available for the stack and counts toward Assistant usage; Datadog states the MCP Server "is not GovCloud compatible" and "is under significant development"; ClickStack MCP excludes HyperDX v1 (hyperdx.io).
- **Next review:** together with the main ledger on 2027-01-13, or sooner on a right-of-reply correction.
