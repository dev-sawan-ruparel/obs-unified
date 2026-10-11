# Competitor Comparison Spot-Check Log (2026-10-11)

**Date:** October 11, 2026
**Type:** Limited Spot-Check Log (Not a Full Table Audit)
**Auditor:** Antigravity
**Surfaces Inspected & Modified:**
- `apps/docs/content/docs/comparison.mdx`
- `apps/website/src/sections/compare.ts`

---

## 1. Audit Scope & Verification Method Disclosures

> [!IMPORTANT]
> **No Claim of Full Table Verification:**
> This session did **not** perform an exhaustive 90-cell source-by-source audit across all nine vendors. Full semantic verification was not conducted across the entire matrix. The public review date on `comparison.mdx` (`Reviewed 2026-05-31 · Next review 2026-08-31`) and `compare.ts` (`snapshot as of May 2026`) is **preserved unchanged** because the comprehensive audit harness was not run and the vast majority of cells remain unverified.

Verification was restricted to targeted spot-checks of high-drift items (preview statuses, pricing changes, and proposed competitor additions) using web search result snippets (`search_web`) as provisional leads. Zero direct page content reads (`read_url_content`) were executed in this session; direct page reading was conducted in subsequent full-audit runs.

---

## 2. Evidence Log by Verification Mechanism

### Category A: Targeted Search Snippet Leads — Datadog Documentation (`search_web`)

> [!NOTE]
> **Audit Log Correction — No Direct Page Retrieval in this Session:**
> Run logs for this spot-check session (runs 20261011T170840Z-a0ee9dc4, 20261011T173059Z-a0f1ebbc, and 20261011T173439Z-a68e8a97) confirm zero completed `read_url_content` calls. Direct full-page retrieval occurred in subsequent full-audit runs, not in this spot-check. Evidence gathered here consisted of web search result snippets (`search_web`), which serve as provisional leads rather than complete semantic verification.

1. **Datadog — Direct OTLP Trace Intake Endpoint (`src-dd-otlp`)**
   - **Target Documentation Reference:** `https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/`
   - **Method:** Web search snippet lead (`search_web`); no direct page read (`read_url_content`) was executed in this spot-check session.
   - **Source Evidence Supported:** Search snippets indicated Datadog documents direct OTLP HTTP trace intake for applications and OpenTelemetry Collectors without surfacing the prior "Preview / contact Customer Success Manager" wording in the snippet context. As search snippets provide incomplete excerpts rather than full page content, this served as a provisional indicator rather than full semantic confirmation of all ingest terms or platform exceptions.
   - **Applied Correction in Public Files:** Updated `src-dd-otlp` in `comparison.mdx` and updated `compare.ts` cell from `"Yes · OTLP in Preview"` (`partial`) to `"Yes · Native OTLP"` (`yes`) to reflect the lead that native OTLP intake is documented without general preview restrictions.

2. **Datadog — Regional Sites & Architecture (`src-dd-hosting`)**
   - **Target Documentation Reference:** `https://docs.datadoghq.com/getting_started/site/`
   - **Method:** Web search snippet lead (`search_web`); no direct page read (`read_url_content`) was executed in this spot-check session.
   - **Source Evidence Supported:** Search snippets indicated Datadog documents regional cloud sites (e.g., US1, US3, US5, EU1, AP1, AP2, Gov, UK1) for its hosted service, with no self-hosted backend deployment options documented in the indexed site listings. Categorical absence across unindexed offerings is not asserted without full-source documentation.
   - **Applied Correction in Public Files:** Maintained Datadog hosting classification in comparison surfaces as managed regional cloud SaaS.

---

### Category B: Primary Documentation Leads via Web Search Snippets (`search_web`)
The following specific claims were investigated via search queries targeting vendor domains. Search result snippets are treated strictly as provisional leads for high-drift items rather than full semantic validation; the distinctions between what source evidence supports and what public files were modified to reflect are detailed below:

3. **Honeycomb — Pro Plan Pricing (`src-hc-pricing`)**
   - **Primary URL Referenced:** `https://www.honeycomb.io/pricing`
   - **Method:** Web search snippet lead (`search_web`).
   - **Source Evidence Supported:** Search snippet from Honeycomb's pricing page cited *"Pro Plan: Starting at $150 / 50M events"*, indicating the prior "$130/mo" reference was outdated. Full pricing tiers and overage structures were not fully audited.
   - **Applied Correction in Public Files:** Updated `comparison.mdx` assertion from "$130/mo" to "$150/mo for 50M events".
4. **Honeycomb — Agent Timeline Status (`src-hc-llm`)**
   - **Primary URL Referenced:** `https://www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows`
   - **Method:** Web search snippet lead (`search_web`).
   - **Source Evidence Supported:** Search snippets from Honeycomb announcement indicated Agent Timeline is released for agent observability workflows.
   - **Applied Correction in Public Files:** Updated `compare.ts` cell from `"Agent Obs (Early Access)"` (`partial`) to `"Agent Obs (GA)"` (`yes`) and updated `comparison.mdx`.
5. **Grafana Cloud — Agent Observability Status (`src-gr-llm`)**
   - **Primary URL Referenced:** `https://grafana.com/blog/ai-observability-for-agents-in-grafana-cloud/`
   - **Method:** Web search snippet lead (`search_web`).
   - **Source Evidence Supported:** Search snippets from Grafana blog indicated Agent Observability in Grafana Cloud reached General Availability (GA).
   - **Applied Correction in Public Files:** Updated `compare.ts` cell from `"AI Observability (preview)"` (`yes`) to `"Agent Observability"` (`yes`) and updated `comparison.mdx`.
6. **PostHog — Alerting Scope (`src-ph-alerts`)**
   - **Primary URL Referenced:** `https://posthog.com/docs/alerts`
   - **Method:** Web search snippet lead (`search_web`).
   - **Source Evidence Supported:** Search snippets documented alerting functionality on insights/trends as well as error tracking alerts.
   - **Applied Correction in Public Files:** Qualified `compare.ts` cell from `"On trends only"` to `"Trends + error alerts"` and updated `comparison.mdx`.
7. **Uptrace — AI & LLM Observability Scope (`src-up-llm`)**
   - **Primary URL Referenced:** `https://uptrace.dev/`
   - **Method:** Web search snippet lead (`search_web`).
   - **Source Evidence Supported:** Search snippets showed documentation for OpenTelemetry GenAI semantic conventions (token counts, latency) and a built-in Model Context Protocol (MCP) server. Snippets did not document a separate commercial "LLM Observability" product SKU; categorical absence across all unindexed capabilities is not asserted.
   - **Applied Correction in Public Files:** Qualified assertion in `comparison.mdx` to reflect documented OTel GenAI conventions and MCP support rather than a flat negative.
8. **Langfuse — AI Engineering & Tracing (`src-lf-*`)**
   - **Primary URLs Referenced:** `https://langfuse.com/docs/deployment/self-host`, `https://langfuse.com/pricing`, `https://langfuse.com/docs/opentelemetry`
   - **Method:** Web search snippet leads (`search_web`).
   - **Source Evidence Supported:**
     - Licensing: Snippets indicated an MIT-licensed core for self-hosting.
     - Pricing: Free self-hosted; cloud offers a free hobby tier and usage-based tiers (Core, Pro, Enterprise).
     - Capabilities: Built on OpenTelemetry; traces multi-step agent execution graphs, tool calls, and evals, with native MCP server support.
     - Scope Focus: Documented scope focuses on LLM application tracing, prompt management, and evaluations; continuous CPU profiling and DOM session replay were not identified in observed search leads (categorical absence across all ecosystem extensions is not asserted).
   - **Applied Correction in Public Files:** Added Langfuse entries in `comparison.mdx` and `compare.ts` reflecting its AI engineering focus.
9. **Arize Phoenix — AI Observability & Tracing (`src-phx-*`)**
   - **Primary URLs Referenced:** `https://github.com/Arize-ai/phoenix/blob/main/LICENSE`, `https://docs.arize.com/phoenix`, `https://arize.com/`
   - **Method:** Web search snippet leads (`search_web`).
   - **Source Evidence Supported:**
     - Licensing: Snippets confirmed licensing under the **Elastic License 2.0 (ELv2)**, *not* Apache-2.0. Free to self-host with commercial managed hosting restrictions.
     - Pricing: Free self-hosted under ELv2; commercial cloud available via Arize.
     - Capabilities: Native OpenTelemetry and OpenInference semantic conventions for AI agents, tools, and retrievers; evaluation workbench and remote MCP server (`/mcp` endpoint).
     - Scope Focus: Documented scope focuses on AI agent and RAG evaluation; continuous CPU profiling and DOM session replay were not identified in observed search leads (categorical absence across all ecosystem extensions is not asserted).
   - **Applied Correction in Public Files:** Added Arize Phoenix entries reflecting ELv2 licensing and AI evaluation positioning.

---

### Category C: URLs Inspected for HTTP 200 Live Status Only (From Prior Review)
The following endpoints were checked for HTTP 200 availability in the October 11 positioning review:
- `https://obsunified.com` (HTTP 200)
- `https://docs.obsunified.com/docs` (HTTP 200)
- `https://agentowl.dev` (HTTP 200)

---

## 3. Explicit List of Pending Full-Audit Items

The following claims and cells were **not** verified in this session and require an exhaustive quarterly review harness:

1. **Inferential Negative Claims (Absence Claims):**
   - Sentry Product Analytics (`src-se-pa`)
   - Honeycomb Session Replay (`src-hc-replay`) & Product Analytics (`src-hc-pa`)
   - Grafana Cloud Product Analytics (`src-gr-pa`)
   - SigNoz Product Analytics (`src-sn-pa`)
   - Uptrace Session Replay (`src-up-replay`) & Product Analytics (`src-up-pa`)
   - HyperDX Product Analytics (`src-hx-pa`)
   *Note: These claims remain inferential based on the absence of dedicated product landing pages rather than explicit vendor denial quotes or exhaustive audits. Categorical absence or uniqueness claims must not be asserted without direct supporting documentation.*

2. **Uninspected Capability & Pricing Cells (~62 cells):**
   - Full monitor catalog verification for Datadog (`src-dd-alerts`), Sentry (`src-se-alerts`), New Relic (`src-nr-alerts`), Grafana (`src-gr-alerts`), SigNoz (`src-sn-alerts`), Uptrace (`src-up-alerts`), and HyperDX (`src-hx-alerts`).
   - Detailed pricing overage tiers for Sentry, PostHog, New Relic, Grafana Cloud, SigNoz, Uptrace, and HyperDX.
   - Cross-signal correlation mechanics (e.g. tag linking vs. NRQL vs. ClickHouse UQL) across all nine platforms.
   - Sentry, PostHog, New Relic, Grafana, and HyperDX session replay platform capabilities and retention policies.

---

## 4. Local Validation Performed

- `pnpm check:surfaces`: Passed (exit code 0). Validated 6 internal consistency checks across package scopes, MCP tools, evidence fields, ingest key, dlx doctor, and shipped features.
- `pnpm messaging:check`: Passed (exit code 0).
- `npx @biomejs/biome check`: Denied by sandbox permission; per instructions, command execution was discontinued without retry.
