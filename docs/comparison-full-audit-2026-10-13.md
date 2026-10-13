# Competitor Comparison Audit Ledger (2026-10-13)

> **Audit status: 81 of 90 cells directly source-checked against live primary pages on 2026-10-13 (historical claims compared with the live page and corrected where needed); 9 cells are inferential negatives (vendor does not market the capability) and remain `UNVERIFIABLE` by design.** "Source-checked" is not "still true": of the 81, 59 historical claims were still accurate, 12 were imprecise, 9 were outdated, and 1 was false. Public copy uses the corrected claims.
>
> **Verdict counts (historical claim at baseline `e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58`):**
> `TRUE` **59** · `PARTIALLY_TRUE` **12** · `OUTDATED` **9** · `FALSE` **1** · `UNVERIFIABLE` **9** · Total **90**
>
> **Method:** Manual audit (runbook Option B in [`apps/docs/scripts/COMPARISON_AUDIT.md`](../apps/docs/scripts/COMPARISON_AUDIT.md)). No multi-agent workflow was run. Every cited page was fetched directly with `curl` (HTML saved and converted to text) or, for two brotli-only pages (`grafana.com/pricing/`, `grafana.com/products/cloud/`), read through a page-fetch tool that returns verbatim quotes. Excerpts below are verbatim from the fetched page text unless marked *(paraphrase)*.
>
> **Supersedes:** [`comparison-full-audit-2026-10-11.md`](./comparison-full-audit-2026-10-11.md) (preserved unchanged as the historical 0/90 baseline record).

---

## 1. Scope and rules

- **Matrix:** 9 vendors × 10 axes = 90 cells, extracted from the historical baseline `comparison.mdx` / `compare.ts` at commit `e4ea90339a1ee6c61ce417a424e0a8c0cfeebe58` (first drafted 2026-05-31).
- **Vendors:** Datadog, Sentry, PostHog, Honeycomb, New Relic, Grafana Cloud, SigNoz, Uptrace, HyperDX.
- **Axes:** hosting model, pricing model, traces / APM, structured logs, AI / LLM observability, session replay, product analytics, alerting, cross-signal correlation, data ownership.
- **Evidence standard:** a cell is `TRUE` only if a directly fetched vendor page (docs, pricing, product page, official repo README, or official blog) contains text that supports the precise claim. Search snippets, third-party blogs, and HTTP 200 alone are not evidence.
- **Negatives:** "vendor does not offer X" is never inferred from silence alone. Each negative cell records what *was* directly read (product index, docs navigation, sitemap scan) and is classified `UNVERIFIABLE` (inferential). Public copy renders these as **"Not marketed"** with a footnote, never as a bare "—".
- **Bias check:** 22 historical claims were changed (12 `PARTIALLY_TRUE`, 9 `OUTDATED`, 1 `FALSE`). Where a change has a clear direction, it mostly moved a competitor *up* (PostHog tracing and alerts, Datadog BYOC, Grafana and Honeycomb agent observability GA, SigNoz BYOC); one moved a competitor *down* (Grafana session replay is public preview, not GA); the rest are renames, pricing restatements, or wording tightened without a directional change.
- **Redirects:** several baseline URLs now redirect; the ledger records the *final* URL that was read.

### Verdict rubric (from the runbook)

| Verdict | Meaning |
|---|---|
| `TRUE` | Claim still accurate; supporting text present on the live page. |
| `PARTIALLY_TRUE` | Directionally right but imprecise; wording tightened. |
| `OUTDATED` | Was true when written; vendor changed it (rename, GA, price, new option). |
| `FALSE` | Not true now; usually a negative cell the vendor has since filled. |
| `UNVERIFIABLE` | Inferential negative with no explicit vendor statement; softened to "Not marketed". |

---

## 2. Summary of changes applied to public copy

| # | Vendor · axis | Was (baseline) | Now | Why |
|---|---|---|---|---|
| 1, 82 | Datadog · hosting / data ownership | "SaaS only" / "Datadog cloud" | "SaaS (regional sites) · BYOC for logs" | Datadog now markets **Bring Your Own Cloud (BYOC) Log Management** that keeps logs in the customer's environment. Moves Datadog up. |
| 19 | Datadog · traces | "Yes · OTLP in Preview" | "Yes · OTLP (Agent/Collector or direct intake)" | Direct OTLP intake endpoints are documented without the previous Preview / CSM wording. |
| 37 | Datadog · AI | "LLM Observability" | "Agent Observability (formerly LLM Observability)" | Product page redirects to Agent Observability. |
| 21 | PostHog · traces | "LLM-scoped only" | "OTLP tracing (beta, Jul 2026)" | PostHog shipped general distributed tracing in beta on 2026-07-16. Negative was **FALSE**. Moves PostHog up. |
| 39 | PostHog · AI | "LLM Analytics" | "AI Observability" | Product renamed; URL redirects. |
| 66 | PostHog · alerts | "On trends only" | "Insight alerts (trends · funnels · SQL) + log alerts" | Alerts now cover trends, funnels, SQL insights, anomaly detection, and logs. Moves PostHog up. |
| 40 | Honeycomb · AI | "Agent Obs (Early Access)" | "Agent Timeline (GA Jun 2026)" | GA announced 2026-06-18. Moves Honeycomb up. |
| 13 | Honeycomb · pricing | "$130/mo" detail | "Pro from $150/mo" | Live pricing page. |
| 5, 86 | New Relic · hosting / data ownership | "SaaS only" / "US/EU" | "SaaS (US · EU · JP regions)" | A Japan region now exists; the "no BYOC" negative is not stated by the vendor and is dropped. |
| 42 | Grafana · AI | "AI Observability (preview)" | "Agent Observability (GA Jul 2026)" | Blog update: renamed and GA on 2026-07-30. Moves Grafana up. |
| 51 | Grafana · session replay | "Yes · Frontend Obs" | "Session Replay (public preview)" | The docs state Session Replay is in public preview and must be enabled per stack. The baseline cited the Sessions page, which does not describe replay; source corrected. Moves Grafana down. |
| 16 | SigNoz · pricing | "$0.30/GB ingest" | "$49/mo min · $0.30/GB" | Teams plan has a $49/month minimum that includes $49 of usage. |
| 7, 88 | SigNoz · hosting / data ownership | "Cloud or OSS self-host" | "Cloud · BYOC · OSS self-host" | README now lists Enterprise BYOC. |
| 17 | Uptrace · pricing | "$0.10/GB ingest" | "Per GB ingested · volume tiers · 50 GB free" (no starting rate quoted) | The live page is internally inconsistent: hero "then from $0.075/GB", FAQ "Rates start at $0.10/GB". Public copy describes the model only and explains the discrepancy. Metrics "$0.025 per 1M datapoints" is on the live page again (the 2026-10-11 read reported a per-timeseries rate). |
| 44 | Uptrace · AI | "—" | "OTel GenAI / OpenAI instrumentation guides" | uptrace.dev publishes OpenTelemetry GenAI/OpenAI instrumentation guides, so the bare negative was imprecise. No negative is asserted in the corrected claim; "no dedicated product" would be inferential and is not claimed. |
| 80 | Uptrace · cross-signal | "Within platform · UQL" | "One store (traces · metrics · logs)" | "UQL" not found on the live product page; dropped. |
| 38 | Sentry · AI | "Agent Mon · Seer" | "Agent Tracing · Seer" | Docs now call it AI observability / Agent tracing; product index lists "Agent Tracing". |
| 31 | Honeycomb · logs | "Modeled as wide events" | "Log Analytics · stored as structured events" | Docs: traces and logs are stored as structured events; Honeycomb also markets Log Analytics. |
| 32 | New Relic · logs | "Yes · Grok-parsed" | "Yes · server-side parsing" | Parsing page read; "Grok" wording not present in the text read. |
| 59 | New Relic · product analytics | "Browser-only" | "Journeys in Browser · NRQL funnels" | Browser Monitoring markets Sankey journeys / drop-offs; NRQL has `funnel()`. No standalone product found. |
| 72 | HyperDX · alerts | "Search + chart-based" | "Search-based alerts" | Alerts doc describes search-based threshold/duration alerts only. |
| 9 cells | Inferential negatives | "—" | "Not marketed" + footnote | See section 4. |

---

## 3. The 90-cell ledger

Columns: **#** ledger index · **Historical claim** (baseline) · **Verdict** · **Corrected claim** (what public copy now says) · **Source** (final URL read, all accessed 2026-10-13) · **Evidence** (verbatim excerpt unless marked paraphrase).

### Datadog

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 1 | Hosting | SaaS only | `OUTDATED` | SaaS (regional sites) · BYOC for logs | https://docs.datadoghq.com/getting_started/site/ · https://www.datadoghq.com/product/byoc-logs/ | "Datadog offers different sites throughout the world. Each site is completely independent, and you cannot share data across sites." · "Datadog Bring Your Own Cloud (BYOC) Log Management lets you keep your logs in your own environment while using the Datadog platform for querying, analytics, and investigations." Site table lists US1, US3, US5, EU1, US1-FED, US2-FED, AP1, AP2, UK1. |
| 10 | Pricing | Per host + per signal | `TRUE` | Per host (Infra, APM) + per signal (GB, events, sessions) | https://www.datadoghq.com/pricing/ | Infrastructure "Pro … $15 Per host, per month* … *Billed annually or $18 on-demand"; "Enterprise … $23 Per host, per month"; "APM … $31 Per host, per month"; "APM Pro … $35"; "APM Enterprise … $40"; Log Management "Ingest … $0.10 Per ingested or scanned GB, per month"; "Standard Indexing 15-day retention … $1.70 Per million log events, per month"; RUM "Per 1,000 sessions". |
| 19 | Traces / APM | Yes · OTLP in Preview | `OUTDATED` | Yes · OTLP via Agent/Collector or direct intake | https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/ | "For production workloads, Datadog recommends sending OpenTelemetry data through a Datadog Agent or OpenTelemetry Collector." · "Use the direct OTLP intake endpoints on this page when deploying a Collector or Agent is not feasible." Intake table lists `/v1/metrics`, `/v1/logs`, `/v1/traces` with payload limits. No "Preview" or "Customer Success Manager" text on the page. |
| 28 | Logs | Yes | `TRUE` | Yes · ingest decoupled from indexing | https://docs.datadoghq.com/logs/ | "Datadog Log Management … removes these limitations by decoupling log ingestion from indexing." · "Datadog Log Management unifies logs, metrics, and traces in a single view". |
| 37 | AI / LLM | LLM Observability | `OUTDATED` | Agent Observability (formerly LLM Observability) | https://www.datadoghq.com/products/ai/agent-observability/ (redirect from `/product/llm-observability/`) | Title "Agent Observability \| LLM Observability \| Datadog"; "Evaluate, improve, and trace your AI agents with offline experimentation and production observability in one platform." · "Run out-of-the-box and custom evaluators aligned to your KPIs". |
| 46 | Session replay | Yes (RUM) | `TRUE` | Yes · RUM Session Replay | https://www.datadoghq.com/product/session-replay/ (redirect) | "Jump from session replays to backend traces for full-stack visibility and faster troubleshooting"; "correlate replays with Error Tracking, RUM, and APM distributed traces". |
| 55 | Product analytics | Yes | `TRUE` | Yes · funnels, Sankeys, cohorts | https://www.datadoghq.com/product/product-analytics/ | "Optimize user journeys with sankeys, funnels, and conversion analysis"; "Improve user retention by tracking engagement trends through cohort analysis"; "a single SDK for RUM and Product Analytics". |
| 64 | Alerts | Many · Watchdog ML | `TRUE` | 30+ monitor types · Watchdog | https://docs.datadoghq.com/monitors/types/ | List includes "Anomaly: Detect anomalous behavior for a metric based on historical data.", "Forecast: Alert when a metric is projected to cross a threshold.", "Outlier …", "Composite: Alert on an expression combining multiple monitors.", "Watchdog: Get notified when Watchdog detects anomalous behavior." |
| 73 | Cross-signal | Within platform | `TRUE` | Within platform · tag correlation | https://www.datadoghq.com/product/ | "Navigate seamlessly between logs, metrics, and request traces"; "See log data in context with automated tagging and correlation". |
| 82 | Data ownership | Datadog cloud | `OUTDATED` | Datadog site · BYOC storage for logs | https://www.datadoghq.com/product/byoc-logs/ · https://docs.datadoghq.com/getting_started/site/ | "Retain logs entirely within your own infrastructure in regions like India, China, Vietnam, Malaysia, Brazil, South Africa, and Canada while preserving unified search and correlation"; sites: "you cannot share data across sites". BYOC covers logs only; no self-hosted backend for other signals is documented. |

### Sentry

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 2 | Hosting | SaaS or Fair Source self-host | `TRUE` | SaaS or Fair Source self-host | https://github.com/getsentry/self-hosted · https://open.sentry.io/licensing/ | README About: "Sentry, feature-complete and packaged up for low-volume deployments and proofs-of-concept"; topics include "fair-source". Licensing: "Functional Source License … Although this license is not among the OSI-approved licenses and does not fit the strict OSI definition of open source … it removes this one limitation after a two-year grace period, turning into a bare Apache". |
| 11 | Pricing | Tier + per-unit overage | `TRUE` | Tier ($26 / $80) + per-unit overage | https://sentry.io/pricing/ | "team $26/mo"; "business … $80/mo"; "+$0.50/GB additional" (Logs); "+$0.0315/hr" (Continuous Profiling); "+$1.00/uptime alert additional"; "+$0.78/monitor additional"; "Seer: AI debugging agent (subscription required)". |
| 20 | Traces / APM | Performance · OTLP beta | `TRUE` | Tracing · OTLP (open beta, no metrics) | https://docs.sentry.io/concepts/otlp/ | "This feature is currently in open beta." · "Sentry can ingest OpenTelemetry traces and logs via OTLP endpoints … Sentry does not support OTLP metrics at this time." |
| 29 | Logs | Yes · trace-connected | `TRUE` | Yes · trace-connected | https://docs.sentry.io/product/logs/ (redirect) | "Sentry's structured logs are searchable, trace-connected, and viewable alongside your errors." |
| 38 | AI / LLM | Agent Mon · Seer | `PARTIALLY_TRUE` | Agent Tracing · Seer | https://docs.sentry.io/product/agents/ (redirect) · https://sentry.io/product/seer/ | "Use AI observability in Sentry to trace and debug agent workflows and conversations. Monitor agent runs, tool calls, model interactions, token usage, and errors." · "Seer is Sentry's debugging agent." Product index (`sentry.io/welcome/`) lists "Agent Tracing". |
| 47 | Session replay | Yes (web + mobile) | `TRUE` | Yes · web + mobile (GA) | https://docs.sentry.io/product/session-replay/ (redirect) | "Session Replay is available for Web (all browser-based applications …) and Mobile (Android, iOS, React Native, and Flutter). Both are generally available and stable." |
| 56 | Product analytics | — | `UNVERIFIABLE` | Not marketed | https://sentry.io/welcome/ | Inferential negative. Product index read 2026-10-13 lists: Error Monitoring, Logs, Seer, Session Replay, Tracing, Agent Tracing, Profiling, Cron Monitoring, Uptime Monitoring. No product-analytics product; no explicit vendor denial. |
| 65 | Alerts | Issues · uptime · crons | `TRUE` | Issue alerts · uptime · crons | https://docs.sentry.io/product/monitors-and-alerts/alerts/ (redirect) · https://sentry.io/pricing/ | "An alert can send notifications, create tickets, call webhooks, or use other integrations for issues coming from projects or Monitors." Pricing lists Uptime Monitoring and Cron Monitoring line items. |
| 74 | Cross-signal | Within platform · trace-id | `TRUE` | Within platform · trace ID | https://docs.sentry.io/concepts/key-terms/tracing/ | "The trace ID connects all the actions that take place, starting from the moment a user performs an action on the frontend, all the way through to the actions this triggers across your application". |
| 83 | Data ownership | Sentry cloud or yours | `TRUE` | Sentry cloud or self-hosted | https://github.com/getsentry/self-hosted | Self-hosted Docker Compose distribution ("docker-compose.yml", "on-premise" topic) under FSL; see #2. |

### PostHog

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 3 | Hosting | Cloud-first · OSS self-host (hobby) | `TRUE` | Cloud-first · OSS self-host (hobby, unsupported) | https://posthog.com/docs/self-host · https://posthog.com/docs/self-host/open-source/disclaimer | "self-hosted deployments are officially unsupported"; "We offer a free Docker Compose deployment under an MIT license."; "All paid-plan features are Cloud-only."; "New deployments of PostHog's paid open source product using Kubernetes are no longer supported." Disclaimer: "Self-hosted open-source deployment is made for hobbyists". |
| 12 | Pricing | Per-unit, per product | `TRUE` | Per-unit, per product (free tier each) | https://posthog.com/product-analytics/pricing · https://posthog.com/session-replay/pricing · https://posthog.com/logs/pricing · https://posthog.com/ai-observability/pricing · https://posthog.com/error-tracking/pricing | "1,000,000 events free every month, then starting at $0.0000500/event"; "5,000 recordings free every month, then starting at $0.0050/recording"; "10 GBs free every month, then starting at $0.25/GB"; "100,000 events free every month, then starting at $0.000350/event" (AI Observability); "100,000 exceptions free every month, then starting at $0.000370/exception". Baseline "LLM Analytics from $0.00006/event" is now the *floor* ("as low as $0.000060/event"), not the starting rate. |
| 21 | Traces / APM | LLM-scoped only | `FALSE` | OTLP distributed tracing (beta, Jul 2026) | https://posthog.com/blog/traces-beta · https://posthog.com/docs/distributed-tracing | Blog (Jul 16, 2026): "Distributed tracing is now in beta."; "Point your existing OpenTelemetry exporter at PostHog's OTLP/HTTP endpoint". Docs: "PostHog Distributed Tracing works with the OpenTelemetry Protocol (OTLP)." |
| 30 | Logs | Yes (GA Jan 2026) | `TRUE` | Yes · OTLP (GA Jan 2026) | https://posthog.com/blog/logs-ga · https://posthog.com/docs/logs | Blog dated Jan 29, 2026: "Logs is generally available, and it lives in the same place as your errors, session replays, and product data." Docs: "Logs is an OpenTelemetry-native log store". |
| 39 | AI / LLM | LLM Analytics | `OUTDATED` | AI Observability | https://posthog.com/ai-observability (redirect from `/llm-analytics`) | "AI Observability captures the full context of each trace and connects it to other PostHog products (like Session Replay). Evals score your live traffic". |
| 48 | Session replay | rrweb | `TRUE` | Yes · rrweb | https://posthog.com/docs/how-posthog-works/recordings-ingestion | "We use rrweb to collect "snapshot data" from the browser." |
| 57 | Product analytics | Flagship | `TRUE` | Flagship · autocapture, funnels, retention | https://posthog.com/product-analytics | "Autocapture tracks pageviews, clicks, and form submissions without extra code. From there you build trends, funnels, retention curves, paths, and SQL queries – then jump straight into the session recordings behind any data point". |
| 66 | Alerts | On trends only | `OUTDATED` | Insight alerts (trends · funnels · SQL) + log alerts | https://posthog.com/docs/alerts · https://posthog.com/docs/logs | "Alerts are supported on trends, funnels (steps and trends views only), and SQL (HogQL) insights."; "use anomaly detection to automatically flag unusual patterns". Logs docs: "Search and filter logs, mine patterns, save views, and set up alerts." |
| 75 | Cross-signal | Within event store | `TRUE` | Within one project / event store | https://posthog.com/blog/logs-ga · https://posthog.com/docs/distributed-tracing | "Logs … lives in the same place as your errors, session replays, and product data."; "Traces use the same OpenTelemetry ingestion as Logs, in the same PostHog project as session replays, errors, and analytics." |
| 84 | Data ownership | PostHog cloud or yours | `TRUE` | PostHog Cloud or self-hosted (unsupported) | https://posthog.com/docs/self-host | "self-hosting PostHog means you run or purchase your own infrastructure, manage deployments, choose your own URLs". |

### Honeycomb

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 4 | Hosting | SaaS · Private Cloud AWS | `TRUE` | SaaS · Private Cloud (AWS) | https://www.honeycomb.io/platform/private-cloud · https://docs.honeycomb.io/get-started/honeycomb/private-cloud/deployment-models | "Choose a Honeycomb-managed or self-managed deployment inside your AWS account." Deployment models: "Honeycomb-Hosted", "Customer-Hosted: Honeycomb manages and operates your deployment within your cloud account." |
| 13 | Pricing | Per event volume | `PARTIALLY_TRUE` | Per event volume (Free 20M · Pro from $150/mo) | https://www.honeycomb.io/pricing | "Free … Event Volume: Up to 20M per month"; "Pro … Starting at $150 per month … Event Volume: Up to 750M per month"; "Pro: Starting at $150 / 50M events". Baseline "$130/mo for up to 1.5B" is outdated. |
| 22 | Traces / APM | OTLP-native | `TRUE` | OTLP-native (gRPC, HTTP/protobuf, HTTP/JSON) | https://docs.honeycomb.io/send-data/opentelemetry/ | "Honeycomb supports receiving telemetry data via OpenTelemetry's native protocol, OTLP, over gRPC, HTTP/protobuf, and HTTP/JSON." |
| 31 | Logs | Modeled as wide events | `PARTIALLY_TRUE` | Log Analytics · stored as structured events | https://docs.honeycomb.io/get-started/honeycomb/traces-metrics-logs (redirect) · https://www.honeycomb.io/platform/log-analytics | "In Honeycomb, traces and logs are stored as structured events: labeled JSON objects sent over HTTP, indexed automatically on every field at ingest". Log Analytics: "Search billions of log lines quickly". Baseline quote no longer present; page restructured. |
| 40 | AI / LLM | Agent Obs (Early Access) | `OUTDATED` | Agent Timeline (GA Jun 2026) | https://www.honeycomb.io/blog/agent-timeline-generally-available · https://www.honeycomb.io/platform/agent-timeline | Blog (June 18, 2026): "Agent Timeline is generally available to every Honeycomb customer". Product page: "Agent Timeline renders an entire multi-agent conversation as a visual sequence. It shows every agent, trace, tool call, and failure chronologically." |
| 49 | Session replay | — | `UNVERIFIABLE` | Not marketed | https://www.honeycomb.io/platform/frontend-observability · https://www.honeycomb.io/sitemap/pages/0.xml | Inferential negative. Frontend Observability page markets "end-to-end traces, errors and performance data", "Core Web and Mobile Vitals", user journeys; no replay. Pages sitemap (101 URLs) has no replay page. No explicit vendor denial. |
| 58 | Product analytics | — | `UNVERIFIABLE` | Not marketed | https://www.honeycomb.io/sitemap/pages/0.xml | Inferential negative. No product-analytics page in the 101-URL pages sitemap; baseline `/analyze` URL now returns 404. |
| 67 | Alerts | Triggers · BubbleUp | `TRUE` | Triggers · BubbleUp | https://docs.honeycomb.io/notify/triggers (redirect) · https://www.honeycomb.io/platform/bubbleup | "Triggers let you receive notifications when your Honeycomb data crosses thresholds that you define."; BubbleUp: "Compare outliers across high-cardinality data". Channels listed: PagerDuty, Slack, Microsoft Teams, Webhooks. |
| 76 | Cross-signal | Unified wide events | `TRUE` | One event store (logs · traces · metrics) | https://www.honeycomb.io/platform/log-analytics | "Use one unified tool to manage logs, traces, and metrics, simplifying workflows and tooling." |
| 85 | Data ownership | Honeycomb or your AWS | `TRUE` | Honeycomb US/EU or your AWS account | https://www.honeycomb.io/blog/honeycomb-launches-data-residency-europe · deployment-models doc | "customers to store their data in the US, in Europe, or both"; Customer-Hosted: "Your telemetry data never leaves your cloud account." |

### New Relic

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 5 | Hosting | SaaS only | `PARTIALLY_TRUE` | SaaS (US · EU · JP regions) | https://docs.newrelic.com/docs/accounts/accounts-billing/account-setup/choose-your-data-center/ | "New Relic's global data hosting structure consists of multiple regions to serve customers worldwide: the United States (US) region, the European Union (EU) region, and the Japan (JP) region." Baseline "two regions" outdated; the "no self-host/BYOC" negative is not stated by the vendor and is not asserted. |
| 14 | Pricing | $/GB + per-user seat | `TRUE` | $/GB ingest + per-user (Compute option) | https://newrelic.com/pricing | "100 GB of free data ingest per month and $0.40/GB ingested beyond."; Data Plus "$0.60/GB beyond free 100 GB"; "Core users … $49/user"; "Full platform users … Pro $349/user"; "New Relic Compute and Advanced Compute — Pay only for the compute you use, with no user fees". |
| 23 | Traces / APM | Native OTLP | `TRUE` | Native OTLP (preferred) | https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/ | "New Relic supports native OTLP ingest and recommends it as the preferred method for sending OpenTelemetry data to the New Relic platform." Endpoints `otlp.nr-data.net`, `otlp.eu01.nr-data.net`, `otlp.jp.nr-data.net`. |
| 32 | Logs | Yes · Grok-parsed | `PARTIALLY_TRUE` | Yes · server-side parsing | https://docs.newrelic.com/docs/logs/get-started/get-started-log-management/ · https://docs.newrelic.com/docs/logs/ui-data/parsing/ | Sources: APM agents, infrastructure agent, "Fluentd, Fluent Bit, Kubernetes, Logstash", Log API, OpenTelemetry Collector. Parsing: "Log parsing transforms unstructured log data into searchable attributes"; "Built-in parsing rules … Custom parsing rules". "Grok" not present in the text read. |
| 41 | AI / LLM | AI Monitoring | `TRUE` | AI Monitoring | https://docs.newrelic.com/docs/ai-monitoring/intro-to-ai-monitoring/ | "AI monitoring is our solution for application monitoring (APM) for AI. … end-to-end visibility into performance, cost, and quality of supported models from vendors like OpenAI, Bedrock and DeepSeek." |
| 50 | Session replay | Yes · DOM-based | `TRUE` | Yes · DOM snapshot (8-day default retention) | https://docs.newrelic.com/docs/browser/browser-monitoring/browser-pro-features/session-replay/get-started/ | "session replay takes a snapshot of the Document Object Model (DOM)"; "By default, Session Replay data is stored for 8 days". |
| 59 | Product analytics | Browser-only | `PARTIALLY_TRUE` | Journeys in Browser · NRQL funnels | https://newrelic.com/platform/browser-monitoring · https://docs.newrelic.com/docs/nrql/using-nrql/funnels-evaluate-data-series-related-events/ | "See how users navigate with Sankey diagrams and identify common routes and drop-offs."; NRQL "SELECT funnel(AN_ATTRIBUTE, ACTION_A, ACTION_B)". No standalone product-analytics SKU found in the pricing page or sitemap (inferential for the "no SKU" part). |
| 68 | Alerts | NRQL conditions | `TRUE` | NRQL alert conditions | https://docs.newrelic.com/docs/alerts/create-alert/create-alert-condition/create-nrql-alert-conditions/ | "We recommend creating an alert using a NRQL alert condition." |
| 77 | Cross-signal | Via NRQL | `TRUE` | Via NRQL | https://docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/ | "New Relic Query Language (NRQL) is a SQL-like language for querying your New Relic data. The same query language that powers New Relic's built-in charts and dashboards is available to you". Baseline quote replaced by this wording. |
| 86 | Data ownership | New Relic US/EU | `OUTDATED` | New Relic US · EU · JP | choose-your-data-center doc | See #5; "You are solely responsible for the selection of the appropriate processing and storage region". |

### Grafana Cloud

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 6 | Hosting | Cloud or self-host LGTM | `TRUE` | Cloud or self-host OSS LGTM | https://grafana.com/oss/ | "launch multiple open source projects, such as Metrictank, Loki, Tempo, Mimir, Faro, and Pyroscope"; "Grafana Alloy is an open source OpenTelemetery collector". |
| 15 | Pricing | Per series + $/GB | `TRUE` | Pro $19/mo + per series + $/GB | https://grafana.com/pricing/ | "$19/ month + usage"; "$6.50/ 1k series"; Logs/Traces/Profiles "$0.05/GB Process", "$0.40/GB Write", "$0.10/GB Retain"; "$0.75/ 1k sessions" (Frontend Observability); Assistant "$20/ active AI user"; Agent Observability "$1.50/ 1k generations"; Enterprise "$25,000/ year spend commit". *(read via page-fetch tool; brotli-only response)* |
| 24 | Traces / APM | Tempo · OTLP | `TRUE` | Tempo · OTLP | https://grafana.com/docs/grafana-cloud/send-data/otlp/ | "Grafana Labs supports the ingestion of metrics, logs, and traces through OTLP into Grafana Cloud." |
| 33 | Logs | Loki | `TRUE` | Loki | https://grafana.com/oss/ | "Loki is a horizontally scalable, highly available, multi-tenant log aggregation system using the same powerful data model as Prometheus." |
| 42 | AI / LLM | AI Observability (preview) | `OUTDATED` | Agent Observability (GA Jul 2026) | https://grafana.com/blog/ai-observability-for-agents-in-grafana-cloud/ | "Update: The tool featured in this post has been renamed Agent Observability, which is part of our growing AI Observability suite. It became Generally Available on Thursday, July 30, 2026." |
| 51 | Session replay | Yes · Frontend Obs | `PARTIALLY_TRUE` | Session Replay (public preview add-on) | https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/session-replay/ | "Session Replay is currently in public preview. Grafana Labs offers limited support, and breaking changes might occur prior to the feature being made generally available."; "Session Replay is an add-on feature for Grafana Cloud Frontend Observability … disabled by default and must be enabled per Grafana Cloud stack." Baseline cited the Sessions page, which does not describe replay. |
| 60 | Product analytics | — | `UNVERIFIABLE` | Not marketed | https://grafana.com/products/cloud/ | Inferential negative. Product list read 2026-10-13 (Assistant, Investigations, Agent Observability, Application Observability, Kubernetes Monitoring, Frontend Observability, Synthetic Monitoring, IRM, RUM, …) contains no product-analytics product; the words "product analytics" and "funnel" do not appear. *(read via page-fetch tool)* |
| 69 | Alerts | Unified Alerting | `TRUE` | Grafana Alerting (multi-source) | https://grafana.com/docs/grafana-cloud/observe-and-act/alert-and-measure-reliability/alerting/ (redirect) | "you create queries and expressions from multiple data sources, no matter where you store your data … alert on your metrics and logs". |
| 78 | Cross-signal | Per-data-source plumbing | `TRUE` | Per-data-source links (trace→logs/metrics/profiles) | https://grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/ | "Trace to logs: Navigate from spans to related logs in Loki or another log data source."; "Trace to metrics …"; "Trace to profiles …"; "Exemplars in the Prometheus data source (for metrics to traces)." Source upgraded from the generic OSS page. |
| 87 | Data ownership | Grafana cloud or yours | `TRUE` | Grafana Cloud or self-hosted OSS | https://grafana.com/oss/ | See #6. |

### SigNoz

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 7 | Hosting | Cloud or OSS self-host | `TRUE` | Cloud · BYOC · OSS self-host | https://github.com/SigNoz/signoz | "SigNoz Cloud (Recommended) … Enterprise Cloud, BYOC, or Enterprise Self-Hosted … Community: Free open-source SigNoz that runs in your own infrastructure." |
| 16 | Pricing | $0.30/GB ingest | `PARTIALLY_TRUE` | $49/mo minimum · $0.30/GB · $0.10/M samples | https://signoz.io/pricing/ | "Starts at $49/month, including $49 of usage"; "After the included $49 of usage, SigNoz Cloud bills: $0.30/GB" (logs, traces); "$0.10/mn samples" (metrics). |
| 25 | Traces / APM | OTLP-native | `TRUE` | OTLP-native | https://signoz.io/distributed-tracing/ | "Auto-instrument your applications with OpenTelemetry across all major languages and frameworks."; "OTLP gRPC HTTP". |
| 34 | Logs | Yes · Logs Explorer | `TRUE` | Yes · Logs Explorer | https://signoz.io/docs/userguide/logs_query_builder/ (redirect) | "The Logs Explorer in SigNoz provides a powerful interface for searching, filtering, and analyzing your log data." |
| 43 | AI / LLM | LLM Observability | `TRUE` | LLM Observability | https://signoz.io/llm-observability/ | "Instant setup for LangChain, LlamaIndex, CrewAI. Automatic instrumentation for OpenAI, Anthropic, Bedrock."; "Track input/output tokens by model, operation, and user." |
| 52 | Session replay | — | `UNVERIFIABLE` | Not marketed | https://github.com/SigNoz/signoz/discussions/3846 · https://signoz.io/docs/sitemap.xml · https://signoz.io/products/sitemap.xml | Inferential negative. Maintainer (2023 discussion): "As of now, this not in our near term roadmap (next 3-4 months)". Docs sitemap (963 URLs) and products sitemap (22 URLs) contain no replay page on 2026-10-13. No current explicit statement. |
| 61 | Product analytics | — | `UNVERIFIABLE` | Not marketed (trace funnels only) | https://signoz.io/trace-funnels/ · sitemaps above | Inferential negative. SigNoz markets "Trace Funnels" ("Each step filters traces by service name, operation, HTTP status code"), a trace-level feature, not user-behavior analytics. No product-analytics page in sitemaps. |
| 70 | Alerts | 5 alert types | `TRUE` | 5 alert types | https://signoz.io/docs/userguide/alerts-management/ | "Metric-based Alert", "Log-based Alert", "Trace-based Alert", "Exceptions-based Alert", "Anomaly-based Alert". |
| 79 | Cross-signal | Trace ↔ logs | `TRUE` | Trace ↔ logs via trace_id/span_id | https://signoz.io/docs/traces-management/guides/correlate-traces-and-logs/ | "SigNoz lets you jump from a trace directly to the logs that fired during it, and from a log entry back to the trace that caused it. This works because OpenTelemetry SDKs inject trace_id and span_id into every log". |
| 88 | Data ownership | SigNoz cloud or yours | `TRUE` | Cloud (US · EU · India) · BYOC · yours | https://signoz.io/pricing/ · https://github.com/SigNoz/signoz | "We have data centers in US, EU and India to comply with data privacy regulations. You can also run Self Hosted SigNoz in your own cloud."; README lists BYOC. |

### Uptrace

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 8 | Hosting | Cloud or OSS self-host | `TRUE` | Cloud · OSS (AGPL-3.0) · on-prem | https://github.com/uptrace/uptrace · https://uptrace.dev/pricing | README: "AGPL-3.0 license"; "Uptrace uses OpenTelemetry framework to collect data and ClickHouse database to store it. It also requires PostgreSQL database to store metadata". Pricing FAQ: "Install Uptrace on-premises with a license. Your telemetry never leaves your infrastructure". |
| 17 | Pricing | $0.10/GB ingest | `PARTIALLY_TRUE` | Per GB ingested · volume tiers · 50 GB free · no seat or host fees (no starting rate quoted) | https://uptrace.dev/pricing | Hero: "50 GB free every month, then from $0.075/GB. Volume discounts apply automatically. Unlimited users, services, and hosts."; FAQ on the same page: "Rates start at $0.10/GB and drop to $0.016/GB at scale."; "The rate starts at $0.025 per 1M datapoints"; "Uptrace Cloud keeps all data for 4 weeks (28 days) by default." The page states two different starting rates, so the per-GB model is supported but the baseline's single "$0.10/GB" figure is not; public copy quotes neither figure as *the* rate and explains the discrepancy. |
| 26 | Traces / APM | OTLP-native | `TRUE` | OTLP-native (gRPC + HTTP) | https://uptrace.dev/ · https://uptrace.dev/get/opentelemetry-go | "OpenTelemetry-native observability"; Go guide: "export spans (traces), logs, and metrics to Uptrace using OTLP/gRPC", endpoint "https://api.uptrace.dev:4317 (gRPC) — if your network blocks gRPC, switch to the HTTP endpoint". |
| 35 | Logs | Yes | `TRUE` | Yes | https://uptrace.dev/ · https://uptrace.dev/features/alerting | "Uptrace unifies traces, metrics, and logs in a single platform."; "Error monitors watch log records matching a set of conditions". |
| 44 | AI / LLM | — | `PARTIALLY_TRUE` | OTel GenAI / OpenAI instrumentation guides for sending LLM telemetry to Uptrace | https://uptrace.dev/guides/opentelemetry-openai · https://uptrace.dev/sitemap.xml · https://uptrace.dev/ | Sitemap (379 URLs) includes `/guides/opentelemetry-openai`, `/blog/llm-cost-monitoring`, `/glossary/llm-observability`, so the historical bare "—" understated what Uptrace documents. Observation only, not asserted as a claim: the home-page product navigation on 2026-10-13 listed "APM, Tracing, Metrics, Errors & logs, Alerting, Infrastructure, MCP". Whether a dedicated LLM product exists is not inferred from that absence. |
| 53 | Session replay | — | `UNVERIFIABLE` | Not marketed | https://uptrace.dev/sitemap.xml · https://uptrace.dev/ | Inferential negative. No replay URL in the 379-URL sitemap; not in product navigation. |
| 62 | Product analytics | — | `UNVERIFIABLE` | Not marketed | same | Inferential negative. No product-analytics URL in sitemap; not in product navigation. |
| 71 | Alerts | Metric + Error | `TRUE` | Metric + error monitors | https://uptrace.dev/features/alerting | "Metric monitors — threshold alerts on infrastructure and tracing metrics"; "Error monitors — alerts on log patterns and exceptions"; channels "email, Slack, Mattermost, Telegram, Microsoft Teams, PagerDuty, Opsgenie, AlertManager, and custom webhooks". |
| 80 | Cross-signal | Within platform · UQL | `PARTIALLY_TRUE` | One store (traces · metrics · logs) | https://uptrace.dev/ | "Traces, metrics, and logs in one place. No more jumping between tools or stitching data together manually." "UQL" not present on the page; dropped. |
| 89 | Data ownership | Uptrace cloud or yours | `TRUE` | Cloud (Germany) or yours | https://uptrace.dev/pricing | "Uptrace Cloud runs in Hetzner's Germany datacenters with redundant backups in Finland."; on-prem: "Your telemetry never leaves your infrastructure". |

### HyperDX

| # | Axis | Historical claim | Verdict | Corrected claim | Source | Evidence |
|---|---|---|---|---|---|---|
| 9 | Hosting | Cloud · OSS · ClickStack | `TRUE` | Cloud · OSS (MIT) · ClickStack in ClickHouse Cloud | https://www.hyperdx.io/docs/oss-vs-cloud · https://github.com/hyperdxio/hyperdx · https://clickhouse.com/blog/clickhouse-acquires-hyperdx-the-future-of-open-source-observability · https://clickhouse.com/blog/announcing-clickstack-in-clickhouse-cloud | "HyperDX offers both an self-hostable open source version … as well as a cloud hosted version"; README "MIT license"; "HyperDX Cloud will continue serving and onboarding new customers." / "The open-source project remains actively maintained and developed."; ClickStack post banner: "Managed ClickStack is now in beta." |
| 18 | Pricing | $20 flat + $0.40/GB | `TRUE` | $20/mo flat (50 GB) + $0.40/GB | https://www.hyperdx.io/pricing | "Starter … Includes 50 GB/mo … 30 Day Retention … Unlimited Users, Flat Rate … $20/mo … $0.40 per additional 1 GB … $0.40 per 100 metrics (1 DPM)"; Free "Store up to 3 GB/mo … 3 Day Retention … Up to 1 User". |
| 27 | Traces / APM | OTLP-native | `TRUE` | OTLP-native (HTTP + gRPC) | https://www.hyperdx.io/docs/install/opentelemetry | "HyperDX accepts telemetry directly from OpenTelemetry code instrumentation or collectors."; "Our OpenTelemetry HTTP endpoint is hosted at https://in-otel.hyperdx.io (gRPC at port 4317)". |
| 36 | Logs | Yes · ClickHouse-backed | `TRUE` | Yes · ClickHouse-backed | https://github.com/hyperdxio/hyperdx · https://www.hyperdx.io/docs/oss-vs-cloud | "An open source observability platform unifying session replays, logs, metrics, traces and errors powered by ClickHouse and OpenTelemetry."; feature table: Logs ✅, JSON Auto-parsing ✅, Live Tail ✅, Event Patterns ✅. |
| 45 | AI / LLM | Via OpenLLMetry | `TRUE` | Via OTel LLM SDKs (OpenLLMetry · OpenLIT · Mirascope) | https://www.traceloop.com/docs/openllmetry/integrations/hyperdx · https://www.hyperdx.io/docs | Traceloop: "HyperDX is an open source observability platform that natively supports OpenTelemetry. Just route the traces to HyperDX's endpoint"; HyperDX docs navigation lists "LLMs: Mirascope, OpenLIT, OpenLLMetry". Observation only: no first-party LLM product appeared in the docs navigation read; that absence is not asserted as a claim. |
| 54 | Session replay | Yes · auto-linked | `TRUE` | Yes · auto-linked | https://www.hyperdx.io/ · https://www.hyperdx.io/docs/oss-vs-cloud | "Automatically link session replays with backend logs and traces."; feature table: Session Replay ✅ OSS / ✅ Cloud. |
| 63 | Product analytics | — | `UNVERIFIABLE` | Not marketed | https://www.hyperdx.io/docs · https://www.hyperdx.io/ | Inferential negative. Docs navigation read 2026-10-13 (Search, Alerts, Dashboards, Install, SDKs, Platforms, Data Collectors, LLMs, Integrations, API) has no funnels/retention/analytics section. |
| 72 | Alerts | Search + chart-based | `PARTIALLY_TRUE` | Search-based alerts (threshold · duration) | https://www.hyperdx.io/docs/alerts | "create an alert to be notified when the number of events (logs or spans) matching the search exceeds or falls below a threshold"; "set the threshold, duration, and notification method for the alert (Slack, Email, PagerDuty or Slack Webhook)". Chart-based alerts not described on this page. |
| 81 | Cross-signal | Auto-linked across signals | `TRUE` | Auto-linked across signals | https://www.hyperdx.io/ | "Trace every request from a user's browser and phone to your backend servers and async workers, automatically." |
| 90 | Data ownership | Cloud (US) or yours | `TRUE` | Cloud (US) or your ClickHouse | https://www.hyperdx.io/terms/dpa · https://www.hyperdx.io/docs/oss-vs-cloud | DPA: "Hosting and Processing Location. DeploySentinel will host and process Customer Personal Data in the United States."; OSS self-hostable version (see #9). |

---

## 4. Inferential negatives (9 cells) — what was read, and why they stay `UNVERIFIABLE`

| # | Vendor · axis | What was directly read on 2026-10-13 | Public rendering |
|---|---|---|---|
| 56 | Sentry · product analytics | `sentry.io/welcome/` product index (9 products, none is product analytics). | Not marketed† |
| 49 | Honeycomb · session replay | Frontend Observability product page; 101-URL pages sitemap. | Not marketed† |
| 58 | Honeycomb · product analytics | 101-URL pages sitemap; `/analyze` → 404. | Not marketed† |
| 60 | Grafana Cloud · product analytics | Grafana Cloud products page (no such product; "funnel"/"product analytics" absent). | Not marketed† |
| 52 | SigNoz · session replay | 2023 maintainer discussion; 963-URL docs sitemap; 22-URL products sitemap. | Not marketed† |
| 61 | SigNoz · product analytics | Same sitemaps; Trace Funnels page (trace-level, not user analytics). | Not marketed† |
| 53 | Uptrace · session replay | 379-URL sitemap; home-page product navigation. | Not marketed† |
| 62 | Uptrace · product analytics | Same. | Not marketed† |
| 63 | HyperDX · product analytics | Docs navigation; home page feature list. | Not marketed† |

† Public copy footnotes these as "not marketed by the vendor on the pages/sitemaps read on 2026-10-13; absence is not an explicit vendor statement."

---

## 5. Source reads (consolidated)

All pages below were fetched on **2026-10-13**. "→" marks a redirect from the baseline URL to the URL actually read. Pages marked *(tool)* were brotli-only and were read through a page-fetch tool returning verbatim quotes.

**Datadog:** `docs.datadoghq.com/getting_started/site/` · `docs.datadoghq.com/opentelemetry/setup/otlp_ingest/` · `docs.datadoghq.com/logs/` · `docs.datadoghq.com/monitors/types/` · `www.datadoghq.com/pricing/` · `www.datadoghq.com/product/` · `www.datadoghq.com/product/llm-observability/` → `www.datadoghq.com/products/ai/agent-observability/` · `www.datadoghq.com/product/real-user-monitoring/session-replay/` → `www.datadoghq.com/product/session-replay/` · `www.datadoghq.com/product/product-analytics/` · `www.datadoghq.com/product/byoc-logs/` (new) · `www.datadoghq.com/architecture/op-vm-deployment/`.

**Sentry:** `github.com/getsentry/self-hosted` · `open.sentry.io/licensing/` · `sentry.io/pricing/` · `sentry.io/welcome/` · `sentry.io/product/seer/` · `docs.sentry.io/concepts/otlp/` · `docs.sentry.io/product/explore/logs/` → `docs.sentry.io/product/logs/` · `docs.sentry.io/product/insights/agents/` → `docs.sentry.io/product/agents/` · `docs.sentry.io/product/explore/session-replay/` → `docs.sentry.io/product/session-replay/` · `docs.sentry.io/product/alerts/` → `docs.sentry.io/product/monitors-and-alerts/alerts/` · `docs.sentry.io/concepts/key-terms/tracing/`.

**PostHog:** `posthog.com/docs/self-host` · `posthog.com/docs/self-host/open-source/disclaimer` · `posthog.com/pricing` (JS-rendered; per-product pricing pages used instead) · `posthog.com/product-analytics/pricing` · `posthog.com/session-replay/pricing` · `posthog.com/logs/pricing` · `posthog.com/ai-observability/pricing` · `posthog.com/error-tracking/pricing` · `posthog.com/docs/llm-analytics/traces` → `posthog.com/docs/ai-observability/traces` · `posthog.com/docs/distributed-tracing` (new) · `posthog.com/blog/traces-beta` (new) · `posthog.com/docs/logs` · `posthog.com/blog/logs-ga` · `posthog.com/llm-analytics` → `posthog.com/ai-observability` · `posthog.com/docs/how-posthog-works/recordings-ingestion` · `posthog.com/product-analytics` · `posthog.com/docs/alerts` · `posthog.com/sitemap/sitemap-0.xml`.

**Honeycomb:** `www.honeycomb.io/platform/private-cloud` · `docs.honeycomb.io/private-cloud/deployment-models` → `docs.honeycomb.io/get-started/honeycomb/private-cloud/deployment-models` · `www.honeycomb.io/pricing` · `docs.honeycomb.io/send-data/opentelemetry/` · `…/concepts/events-metrics-logs` → `docs.honeycomb.io/get-started/honeycomb/traces-metrics-logs` · `www.honeycomb.io/blog/honeycomb-launches-agent-observability-full-visibility-agentic-workflows` · `www.honeycomb.io/blog/agent-timeline-generally-available` (new) · `www.honeycomb.io/platform/agent-timeline` (new) · `www.honeycomb.io/use-cases/ai-llm-observability` (new) · `www.honeycomb.io/platform/frontend-observability` · `www.honeycomb.io/blog/redefining-rum-comparative-gap-analysis-existing-tools` · `www.honeycomb.io/analyze` (404) · `docs.honeycomb.io/notify/alert/triggers/` → `docs.honeycomb.io/notify/triggers` · `www.honeycomb.io/platform/bubbleup` · `www.honeycomb.io/platform/log-analytics` · `www.honeycomb.io/blog/honeycomb-launches-data-residency-europe` · `www.honeycomb.io/sitemap/pages/0.xml`.

**New Relic:** `docs.newrelic.com/docs/accounts/accounts-billing/account-setup/choose-your-data-center/` · `newrelic.com/pricing` · `docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/` · `docs.newrelic.com/docs/logs/get-started/get-started-log-management/` · `docs.newrelic.com/docs/logs/ui-data/parsing/` · `docs.newrelic.com/docs/ai-monitoring/intro-to-ai-monitoring/` · `docs.newrelic.com/docs/browser/browser-monitoring/browser-pro-features/session-replay/get-started/` · `newrelic.com/platform/browser-monitoring` · `docs.newrelic.com/docs/nrql/using-nrql/funnels-evaluate-data-series-related-events/` (new) · `docs.newrelic.com/docs/alerts/create-alert/create-alert-condition/create-nrql-alert-conditions/` · `docs.newrelic.com/docs/nrql/get-started/introduction-nrql-new-relics-query-language/` · `newrelic.com/sitemap.xml`.

**Grafana:** `grafana.com/oss/` · `grafana.com/pricing/` *(tool)* · `grafana.com/products/cloud/` *(tool)* · `grafana.com/docs/grafana-cloud/send-data/otlp/` · `grafana.com/blog/ai-observability-for-agents-in-grafana-cloud/` · `…/frontend-observability/sessions/` → `…/observe-and-act/monitor-applications/frontend-observability/visualize-data/sessions/` · `…/observe-and-act/monitor-applications/frontend-observability/` · `…/observe-and-act/monitor-applications/session-replay/` (new) · `grafana.com/docs/grafana-cloud/alerting-and-irm/alerting/` → `…/observe-and-act/alert-and-measure-reliability/alerting/` · `grafana.com/docs/grafana/latest/datasources/tempo/configure-tempo-data-source/` (new).

**SigNoz:** `github.com/SigNoz/signoz` · `github.com/SigNoz/signoz/discussions/3846` · `signoz.io/pricing/` · `signoz.io/distributed-tracing/` · `signoz.io/docs/userguide/logs/` → `signoz.io/docs/userguide/logs_query_builder/` · `signoz.io/llm-observability/` · `signoz.io/docs/userguide/alerts-management/` · `signoz.io/docs/traces-management/guides/correlate-traces-and-logs/` · `signoz.io/docs/architecture/` · `signoz.io/trace-funnels/` (new) · `signoz.io/docs/sitemap.xml` · `signoz.io/products/sitemap.xml`.

**Uptrace:** `github.com/uptrace/uptrace` · `uptrace.dev/pricing` · `uptrace.dev/` · `uptrace.dev/features/alerting` · `uptrace.dev/get/opentelemetry-go` (new) · `uptrace.dev/sitemap.xml`.

**HyperDX:** `clickhouse.com/blog/clickhouse-acquires-hyperdx-the-future-of-open-source-observability` · `clickhouse.com/blog/announcing-clickstack-in-clickhouse-cloud` · `github.com/hyperdxio/hyperdx` · `www.hyperdx.io/pricing` · `www.hyperdx.io/docs/install/opentelemetry` · `www.traceloop.com/docs/openllmetry/integrations/hyperdx` · `www.hyperdx.io/` · `www.hyperdx.io/docs` · `www.hyperdx.io/docs/alerts` · `www.hyperdx.io/terms/dpa` · `www.hyperdx.io/docs/oss-vs-cloud` · `www.hyperdx.io/docs/v2`.

---

## 6. Remaining gaps and next review

- **Inferential negatives (9 cells)** cannot be upgraded without an explicit vendor statement; they are rendered as "Not marketed" and reviewed each pass.
- **Volatile pricing:** Uptrace shows two different starting rates on one page ($0.075/GB in the hero, $0.10/GB in the FAQ), so public copy describes only the model (per GB, volume tiers, 50 GB free); Datadog, New Relic (new Compute model), SigNoz (new $49 minimum), and PostHog (per-product floors) change frequently. Pricing cells carry the review date and should be re-read before any pricing-led claim is made.
- **Preview / beta status to re-check:** Grafana Session Replay (public preview), PostHog distributed tracing (beta), Sentry OTLP (open beta), ClickHouse Managed ClickStack (beta).
- **Datadog BYOC** was source-checked from the product page only; the docs page for BYOC Log Management was not located from the pages read.
- **Proposed next review:** 2027-01-13 (quarterly), or sooner on a right-of-reply correction.
