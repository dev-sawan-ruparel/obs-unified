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

Verification was restricted to targeted spot-checks of high-drift items (preview statuses, pricing changes, and proposed competitor additions) using the specific retrieval methods delineated below.

---

## 2. Evidence Log by Verification Mechanism

### Category A: Direct Page Content Reads (`read_url_content`)
Only two vendor pages were directly retrieved and inspected in full during this session:

1. **Datadog — Direct OTLP Trace Intake Endpoint (`src-dd-otlp`)**
   - **Direct URL Checked:** `https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/`
   - **Method:** Fetched via `read_url_content`.
   - **Finding:** The page documents direct OTLP HTTP trace intake for applications and OpenTelemetry Collectors without requiring the Datadog Agent. The previous quoted claim (*"OTLP traces intake endpoint (in Preview): To request access for use, contact your Customer Success Manager"*) is no longer present; contact with a CSM is now only noted for unlisted managed platforms.
   - **Applied Correction:** Updated `src-dd-otlp` in `comparison.mdx` and updated `compare.ts` cell from `"Yes · OTLP in Preview"` (`partial`) to `"Yes · Native OTLP"` (`yes`).

2. **Datadog — Regional Sites & Architecture (`src-dd-hosting`)**
   - **Direct URL Checked:** `https://docs.datadoghq.com/getting_started/site/`
   - **Method:** Fetched via `read_url_content`.
   - **Finding:** Confirmed that Datadog operates independent regional sites (US1, US3, US5, EU1, AP1, AP2, Gov, UK1) and does not offer a self-hostable backend.

---

### Category B: Primary Documentation Confirmed via Web Search Snippets (`search_web`)
The following specific claims were checked via search queries targeting the vendor's primary domain:

3. **Honeycomb — Pro Plan Pricing (`src-hc-pricing`)**
   - **Primary URL:** `https://www.honeycomb.io/pricing`
   - **Finding:** Primary pricing page documents: *"Pro Plan: Starting at $150 / 50M events"*. The prior claim of "$130/mo" is stale.
   - **Applied Correction:** Updated `comparison.mdx` assertion from "$130/mo" to "$150/mo for 50M events".
4. **Honeycomb — Agent Timeline Status (`src-hc-llm`)**
   - **Primary URL:** `https://www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows`
   - **Finding:** Documentation and announcement confirm Agent Timeline graduated from Early Access to General Availability (GA).
   - **Applied Correction:** Updated `compare.ts` cell from `"Agent Obs (Early Access)"` (`partial`) to `"Agent Obs (GA)"` (`yes`) and updated `comparison.mdx`.
5. **Grafana Cloud — Agent Observability Status (`src-gr-llm`)**
   - **Primary URL:** `https://grafana.com/blog/ai-observability-for-agents-in-grafana-cloud/`
   - **Finding:** Grafana Cloud Agent Observability (formerly AI Observability in preview) graduated to General Availability on July 30, 2026.
   - **Applied Correction:** Updated `compare.ts` cell from `"AI Observability (preview)"` (`yes`) to `"Agent Observability"` (`yes`) and updated `comparison.mdx`.
6. **PostHog — Alerting Scope (`src-ph-alerts`)**
   - **Primary URL:** `https://posthog.com/docs/alerts`
   - **Finding:** PostHog supports alerts on insights/trends as well as error tracking alerts.
   - **Applied Correction:** Qualified `compare.ts` cell from `"On trends only"` to `"Trends + error alerts"` and updated `comparison.mdx`.
7. **Uptrace — AI & LLM Observability Scope (`src-up-llm`)**
   - **Primary URL:** `https://uptrace.dev/`
   - **Finding:** Uptrace does not market a separate commercial "LLM Observability" product SKU, but actively documents OpenTelemetry GenAI semantic conventions (token counts, latency) and provides a built-in Model Context Protocol (MCP) server.
   - **Applied Correction:** Qualified assertion in `comparison.mdx` to reflect OTel GenAI documentation and MCP support rather than a flat negative.
8. **Langfuse — AI Engineering & Tracing (`src-lf-*`)**
   - **Primary URLs:** `https://langfuse.com/docs/deployment/self-host`, `https://langfuse.com/pricing`, `https://langfuse.com/docs/opentelemetry`
   - **Findings:**
     - Licensing: MIT-licensed open-source self-hostable core.
     - Pricing: Free self-hosted; cloud offers free hobby tier and usage-based tiers (Core, Pro, Enterprise).
     - Capabilities: Built on OpenTelemetry. Traces multi-step agent execution graphs, tool calls, and evals. Also provides native MCP server support.
     - Scope Boundary: Focuses on AI application layer; does not provide continuous pprof CPU flame graphs or browser DOM session replay (rrweb).
9. **Arize Phoenix — AI Observability & Tracing (`src-phx-*`)**
   - **Primary URLs:** `https://github.com/Arize-ai/phoenix/blob/main/LICENSE`, `https://docs.arize.com/phoenix`, `https://arize.com/`
   - **Findings:**
     - Licensing: Source-available under **Elastic License 2.0 (ELv2)**, *not* Apache-2.0. Free to self-host with no feature gates; commercial managed hosting is restricted.
     - Pricing: Free self-hosted under ELv2; commercial cloud available via Arize.
     - Capabilities: Native OpenTelemetry and OpenInference semantic conventions for AI agents, tools, and retrievers. Features an evaluation workbench and a built-in Remote MCP Server (`/mcp` endpoint for Phoenix 19.0+).
     - Scope Boundary: Focuses on AI agent and RAG evaluation; does not provide continuous pprof CPU flame graphs or browser DOM session replay (rrweb).

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
   *Note: These claims remain inferential based on the absence of product pages, rather than explicit vendor denial quotes.*

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
