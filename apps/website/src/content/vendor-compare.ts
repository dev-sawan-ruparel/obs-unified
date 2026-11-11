// Per-vendor comparison pages (/compare/<slug>/). Every cell carries a
// verdict and a source URL; vendor cells cite the vendor's own page.
//
// Rows come from two places:
//   - Reused rows were source-checked for the main comparison table
//     (docs/comparison-full-audit-2026-10-13.md, and the AI agent access row in
//     docs/comparison-agent-access-audit-2026-11-10.md).
//   - Rows with an `audit` key were source-checked for these pages; AUDITS
//     gives each audit's date and ledger.
//
// Verdict rules (enforced by scripts/comparison-check.mjs):
//   yes / partial / no need a source URL. `no` is only used when the source
//   states it. `not_marketed` (we read the vendor's product pages and found no
//   such capability) and `not_stated` (the vendor's docs do not say) are never
//   rendered as "No".

export type Verdict = "yes" | "partial" | "no" | "not_marketed" | "not_stated";

export type Cell = {
  verdict: Verdict;
  /** Short neutral detail shown under the verdict. */
  text: string;
  /** The page that supports the cell. Vendor cells cite the vendor's own page. */
  source: string;
};

export type RowKey =
  | "mcp_server"
  | "mcp_read_only_default"
  | "mcp_links_to_records"
  | "agent_calls_in_app_traces"
  | "traces_otlp"
  | "logs"
  | "llm_observability"
  | "session_replay"
  | "profile_from_trace"
  | "full_self_host"
  | "managed_cloud"
  | "sso"
  | "release_flag_cohorts"
  | "causal_proof_levels"
  | "fix_verified_by_eval"
  | "gated_remediation"
  | "click_to_trace"
  | "contention_vs_regression";

export type RowDef = {
  key: RowKey;
  label: string;
  /** The question the row answers, shown as a tooltip and in the method notes. */
  question: string;
  /** Set when the row was researched for these pages; see AUDITS. */
  audit?: AuditKey;
};

export type Group = { title: string; rows: RowDef[] };

export type AuditKey = "pages" | "autosre";
export type Audit = { date: string; ledgerUrl: string; rows: string };
const LEDGER_BASE = "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/";
export const AUDITS: Record<AuditKey, Audit> = {
  pages: {
    date: "2026-11-10",
    ledgerUrl: `${LEDGER_BASE}comparison-vendor-pages-audit-2026-11-10.md`,
    rows: "MCP write defaults, MCP links, agent tool calls, CPU profiles, self-hosting, and SSO",
  },
  autosre: {
    date: "2026-11-11",
    ledgerUrl: `${LEDGER_BASE}comparison-vendor-pages-autosre-audit-2026-11-11.md`,
    rows: "release and flag comparison, proof of cause, fix verification, gated remediation, click to trace, and dependency contention",
  },
};
/** Most recent vendor-page review, shown in the page eyebrow. */
export const VENDOR_PAGES_REVIEWED = Object.values(AUDITS)
  .map((a) => a.date)
  .sort()
  .at(-1) as string;
export const MAIN_LEDGER_URL =
  "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/comparison-full-audit-2026-10-13.md";
export const AGENT_ACCESS_LEDGER_URL =
  "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/comparison-agent-access-audit-2026-11-10.md";

export const GROUPS: Group[] = [
  {
    title: "Investigating with AI agents",
    rows: [
      { key: "mcp_server", label: "First-party MCP server", question: "Does the vendor ship its own Model Context Protocol server?" },
      { key: "mcp_read_only_default", label: "MCP write tools off unless enabled", question: "Is the MCP server read-only until someone turns write tools on?", audit: "pages" },
      { key: "mcp_links_to_records", label: "MCP results link to source records", question: "Do MCP tool results include links or citations back to the underlying records?", audit: "pages" },
      { key: "agent_calls_in_app_traces", label: "Agent tool calls alongside app traces", question: "Do AI agent runs and tool calls appear alongside the application's backend traces?", audit: "pages" },
    ],
  },
  {
    title: "Change-aware investigation and remediation",
    rows: [
      { key: "release_flag_cohorts", label: "Compare releases and flag variants", question: "Can you compare errors or latency between release versions or feature-flag variants?", audit: "autosre" },
      { key: "contention_vs_regression", label: "Shared-dependency contention vs code regression", question: "Can the product tell shared-dependency contention apart from a regression in the service's own change?", audit: "autosre" },
      { key: "causal_proof_levels", label: "Root cause states its level of proof", question: "Do automated root-cause findings say how well the cause is proven?", audit: "autosre" },
      { key: "fix_verified_by_eval", label: "Fix verified by re-running the failing case", question: "Is a fix verified by re-running the case that failed, before and after?", audit: "autosre" },
      { key: "gated_remediation", label: "Remediation behind approval or a policy gate", question: "Does automated remediation pass an approval or policy gate before it runs?", audit: "autosre" },
    ],
  },
  {
    title: "Signals",
    rows: [
      { key: "traces_otlp", label: "Distributed tracing (OTLP)", question: "Can you send OpenTelemetry traces?" },
      { key: "logs", label: "Structured logs", question: "Are structured logs a product capability?" },
      { key: "llm_observability", label: "AI / LLM observability", question: "Is there a product capability for LLM and AI agent telemetry?" },
      { key: "session_replay", label: "Session replay", question: "Can you replay a user's browser session?" },
      { key: "click_to_trace", label: "Browser click linked to its backend trace", question: "Does a user's click in the browser link to the backend trace it caused?", audit: "autosre" },
      { key: "profile_from_trace", label: "CPU profile from a trace", question: "Can you open the CPU profile for a specific trace or span?", audit: "pages" },
    ],
  },
  {
    title: "Deployment and access",
    rows: [
      { key: "full_self_host", label: "Run the full platform yourself", question: "Can you run the whole platform on your own infrastructure, supported for production?", audit: "pages" },
      { key: "managed_cloud", label: "Vendor-hosted cloud service", question: "Does the vendor run a hosted service for you?" },
      { key: "sso", label: "Built-in single sign-on", question: "Is SAML or OIDC single sign-on built in?", audit: "pages" },
    ],
  },
];

const D = "https://docs.obsunified.com/docs";

export const OBS: Record<RowKey, Cell> = {
  mcp_server: { verdict: "yes", text: "Local stdio server, @obsunified/mcp-server", source: `${D}/mcp-server` },
  mcp_read_only_default: { verdict: "yes", text: "Writes register only with OBS_MCP_ENABLE_WRITES=true", source: `${D}/mcp-server` },
  mcp_links_to_records: { verdict: "yes", text: "Evidence bundles with citations; dashboard deep links when OBS_DASHBOARD_URL is set", source: `${D}/mcp-server` },
  agent_calls_in_app_traces: { verdict: "yes", text: "Agent Action Graph links tool calls to traces", source: `${D}/agent-action-graph` },
  traces_otlp: { verdict: "yes", text: "OTLP over HTTP; front gRPC with a Collector", source: `${D}/comparison#where-observability-unified-fits` },
  logs: { verdict: "yes", text: "Trace-correlated", source: `${D}/getting-started#investigate-a-slow-checkout` },
  llm_observability: { verdict: "yes", text: "AI calls, agent runs, evals", source: `${D}/agent-action-graph` },
  session_replay: { verdict: "yes", text: "rrweb, browser DOM only", source: `${D}/comparison#where-observability-unified-fits` },
  profile_from_trace: { verdict: "yes", text: "When profiling is enabled and samples carry the trace ID", source: `${D}/getting-started#investigate-a-slow-checkout` },
  full_self_host: { verdict: "yes", text: "Docker image, Node + Postgres/S3, or Cloudflare", source: `${D}/installation` },
  managed_cloud: { verdict: "no", text: "Self-hosted only", source: `${D}/installation` },
  sso: { verdict: "no", text: "Front it with Cloudflare Access or oauth2-proxy", source: `${D}/ops/production` },
  release_flag_cohorts: { verdict: "yes", text: "Error-rate lift per version and flag variant, normalized for traffic share", source: `${D}/autosre#1-progressive-rollout-vs-the-traffic-share-fallacy` },
  contention_vs_regression: { verdict: "yes", text: "Shared-degradation verdicts separate contention from the new version", source: `${D}/autosre#2-noisy-neighbor-shared-database-contention` },
  causal_proof_levels: { verdict: "yes", text: "Proof tier from unverified locus to counterfactual verified, kept apart from link certainty", source: `${D}/autosre#3-structural-code-overlap-without-causal-proof` },
  fix_verified_by_eval: { verdict: "yes", text: "Same eval input fails on the baseline and passes on the candidate", source: `${D}/autosre#4-paired-baseline-fail--candidate-pass-counterfactual-verification` },
  gated_remediation: { verdict: "yes", text: "Approval queue or single-use grant; your runner executes; a watchdog checks recovery", source: `${D}/autosre#approval--execution-handoff` },
  click_to_trace: { verdict: "yes", text: "x-obs-interaction links a click to its trace, logs, and replay (browser SDK or header)", source: `${D}/getting-started#application-compatibility--signal-matrix` },
};

export type Vendor = {
  key: string;
  slug: string;
  name: string;
  /** One neutral sentence describing the vendor, drawn from its sourced cells. */
  summary: string;
  /** "Choose <vendor> if…" guidance, editorial and favourable to the vendor. */
  chooseIf: string;
  cells: Record<RowKey, Cell>;
};

type ReusedKey = "mcp_server" | "traces_otlp" | "logs" | "llm_observability" | "session_replay" | "managed_cloud";
type AutosreKey =
  | "release_flag_cohorts"
  | "causal_proof_levels"
  | "fix_verified_by_eval"
  | "gated_remediation"
  | "click_to_trace"
  | "contention_vs_regression";
type PagesKey = Exclude<RowKey, ReusedKey | AutosreKey>;

const y = (text: string, source: string): Cell => ({ verdict: "yes", text, source });
const p = (text: string, source: string): Cell => ({ verdict: "partial", text, source });
const nm = (text: string, source: string): Cell => ({ verdict: "not_marketed", text, source });

// Reused cells: same claims and sources as the docs comparison tables
// (src-<vendor> sections), reviewed on LAST_REVIEWED, and the MCP server row
// on AGENT_ACCESS_REVIEWED.
const REUSED: Record<string, Record<ReusedKey, Cell>> = {
  datadog: {
    mcp_server: y("Remote, Datadog-hosted", "https://docs.datadoghq.com/mcp_server/"),
    traces_otlp: y("OTLP through the Agent, a Collector, or direct intake", "https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/"),
    logs: y("Ingestion decoupled from indexing", "https://docs.datadoghq.com/logs/"),
    llm_observability: y("Agent Observability", "https://www.datadoghq.com/products/ai/agent-observability/"),
    session_replay: y("RUM Session Replay", "https://www.datadoghq.com/product/session-replay/"),
    managed_cloud: y("Independent regional sites", "https://docs.datadoghq.com/getting_started/site/"),
  },
  sentry: {
    mcp_server: y("Hosted with OAuth; local stdio through the CLI", "https://mcp.sentry.dev/"),
    traces_otlp: p("Tracing; OTLP traces in open beta", "https://docs.sentry.io/concepts/otlp/"),
    logs: y("Trace-connected", "https://docs.sentry.io/product/logs/"),
    llm_observability: y("Agent Tracing and the Seer debugging agent", "https://docs.sentry.io/product/agents/"),
    session_replay: y("Web and mobile", "https://docs.sentry.io/product/session-replay/"),
    managed_cloud: y("Sentry SaaS", "https://sentry.io/pricing/"),
  },
  posthog: {
    mcp_server: y("Hosted endpoint", "https://posthog.com/docs/model-context-protocol"),
    traces_otlp: p("OTLP distributed tracing in beta (July 2026)", "https://posthog.com/blog/traces-beta"),
    logs: y("OTLP-native, GA January 2026", "https://posthog.com/blog/logs-ga"),
    llm_observability: y("AI Observability", "https://posthog.com/ai-observability"),
    session_replay: y("rrweb-based", "https://posthog.com/docs/how-posthog-works/recordings-ingestion"),
    managed_cloud: y("PostHog Cloud", "https://posthog.com/docs/self-host"),
  },
  honeycomb: {
    mcp_server: y("Hosted, US and EU endpoints", "https://docs.honeycomb.io/integrations/mcp/concepts"),
    traces_otlp: y("OTLP-native", "https://docs.honeycomb.io/send-data/opentelemetry/"),
    logs: y("Log Analytics on structured events", "https://docs.honeycomb.io/get-started/honeycomb/traces-metrics-logs"),
    llm_observability: y("Agent Timeline, GA June 2026", "https://www.honeycomb.io/blog/agent-timeline-generally-available"),
    session_replay: nm("Not on the frontend observability page", "https://www.honeycomb.io/platform/frontend-observability"),
    managed_cloud: y("SaaS, plus Private Cloud in your AWS account", "https://www.honeycomb.io/platform/private-cloud"),
  },
  newrelic: {
    mcp_server: y("Hosted, US, EU, and JP endpoints", "https://docs.newrelic.com/docs/agentic-ai/mcp/setup/"),
    traces_otlp: y("Native OTLP", "https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/"),
    logs: y("Agents, forwarders, Log API, or OTLP", "https://docs.newrelic.com/docs/logs/get-started/get-started-log-management/"),
    llm_observability: y("AI Monitoring", "https://docs.newrelic.com/docs/ai-monitoring/intro-to-ai-monitoring/"),
    session_replay: y("DOM snapshot based", "https://docs.newrelic.com/docs/browser/browser-monitoring/browser-pro-features/session-replay/get-started/"),
    managed_cloud: y("US, EU, and Japan regions", "https://docs.newrelic.com/docs/accounts/accounts-billing/account-setup/choose-your-data-center/"),
  },
  grafana: {
    mcp_server: y("Hosted Cloud server and a self-managed OSS server", "https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/"),
    traces_otlp: y("Tempo with OTLP ingest", "https://grafana.com/docs/grafana-cloud/send-data/otlp/"),
    logs: y("Loki", "https://grafana.com/oss/"),
    llm_observability: y("Agent Observability, GA July 2026", "https://grafana.com/blog/ai-observability-for-agents-in-grafana-cloud/"),
    session_replay: p("Add-on in public preview", "https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/session-replay/"),
    managed_cloud: y("Grafana Cloud", "https://grafana.com/docs/grafana-cloud/send-data/otlp/"),
  },
  signoz: {
    mcp_server: y("Hosted for SigNoz Cloud; a binary for self-hosted", "https://signoz.io/docs/ai/signoz-mcp-server/"),
    traces_otlp: y("OTLP-native", "https://signoz.io/distributed-tracing/"),
    logs: y("Logs Explorer with a query builder", "https://signoz.io/docs/userguide/logs_query_builder/"),
    llm_observability: y("LLM Observability", "https://signoz.io/llm-observability/"),
    session_replay: nm("Requested in a GitHub discussion", "https://github.com/SigNoz/signoz/discussions/3846"),
    managed_cloud: y("SigNoz Cloud", "https://github.com/SigNoz/signoz"),
  },
  uptrace: {
    mcp_server: y("Built into Uptrace", "https://uptrace.dev/features/mcp"),
    traces_otlp: y("OTLP over gRPC and HTTP", "https://uptrace.dev/get/opentelemetry-go"),
    logs: y("Logs alongside traces and metrics", "https://uptrace.dev/"),
    llm_observability: p("OpenTelemetry GenAI instrumentation guides", "https://uptrace.dev/guides/opentelemetry-openai"),
    session_replay: nm("Not in the product pages we read", "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/comparison-full-audit-2026-10-13.md"),
    managed_cloud: y("Uptrace Cloud", "https://github.com/uptrace/uptrace"),
  },
  hyperdx: {
    // Corrected 2026-11-10: managed ClickHouse Observability now has an MCP endpoint.
    mcp_server: y("ClickStack open source, BYOC, and managed ClickHouse Observability", "https://clickhouse.com/docs/clickstack/observability/mcp"),
    traces_otlp: y("OTLP over HTTP and gRPC", "https://www.hyperdx.io/docs/install/opentelemetry"),
    logs: y("ClickHouse-backed, with live tail and patterns", "https://github.com/hyperdxio/hyperdx"),
    llm_observability: p("OpenTelemetry LLM SDK guides", "https://www.hyperdx.io/docs/install/openllmetry"),
    session_replay: y("Linked to logs and traces", "https://www.hyperdx.io/"),
    managed_cloud: y("HyperDX Cloud, or ClickStack in ClickHouse Cloud (beta)", "https://www.hyperdx.io/docs/oss-vs-cloud"),
  },
};

// Cells researched for these pages (AUDITS.pages, 2026-11-10).
const ADDED: Record<string, Record<PagesKey, Cell>> = {
  datadog: {
    mcp_read_only_default: { verdict: "partial", text: "Writes need the mcp_write permission and an org setting", source: "https://docs.datadoghq.com/mcp_server/setup/" },
    mcp_links_to_records: { verdict: "partial", text: "A tool that builds DDSQL Editor links", source: "https://docs.datadoghq.com/mcp_server/tools/" },
    agent_calls_in_app_traces: { verdict: "yes", text: "Agent spans link to APM traces", source: "https://docs.datadoghq.com/llm_observability/instrument/agent_observability_and_apm/" },
    profile_from_trace: { verdict: "yes", text: "Span to profile in seven languages", source: "https://docs.datadoghq.com/profiler/connect_traces_and_profiles/" },
    full_self_host: { verdict: "partial", text: "SaaS, with BYOC for logs", source: "https://www.datadoghq.com/product/byoc-logs/" },
    sso: { verdict: "yes", text: "SAML", source: "https://docs.datadoghq.com/account_management/saml/" },
  },
  sentry: {
    mcp_read_only_default: { verdict: "partial", text: "Write skills are chosen at OAuth consent", source: "https://cli.sentry.dev/commands/mcp/" },
    mcp_links_to_records: { verdict: "yes", text: "Tool responses include Sentry URLs", source: "https://github.com/getsentry/toolkit/blob/main/docs/contributing/tool-responses.md" },
    agent_calls_in_app_traces: { verdict: "yes", text: "Agent runs shown with the app's trace", source: "https://docs.sentry.io/product/agents/" },
    profile_from_trace: { verdict: "yes", text: "Span details show the profile", source: "https://docs.sentry.io/product/profiling/" },
    full_self_host: { verdict: "partial", text: "Self-hosted for low-volume deployments", source: "https://github.com/getsentry/self-hosted" },
    sso: { verdict: "yes", text: "SAML2 on Business and Enterprise", source: "https://docs.sentry.io/organization/authentication/sso/" },
  },
  posthog: {
    mcp_read_only_default: { verdict: "partial", text: "Read and write by default; read-only mode is opt-in", source: "https://posthog.com/docs/model-context-protocol/faq" },
    mcp_links_to_records: { verdict: "partial", text: "Some tools return PostHog links", source: "https://posthog.com/docs/model-context-protocol/use-cases" },
    agent_calls_in_app_traces: { verdict: "partial", text: "Correlate by trace ID in SQL; not linked in the UI", source: "https://posthog.com/docs/distributed-tracing/link-ai-observability" },
    profile_from_trace: { verdict: "not_marketed", text: "No CPU profiling product in the sitemap", source: "https://posthog.com/sitemap/sitemap-0.xml" },
    full_self_host: { verdict: "partial", text: "Docker Compose self-host, officially unsupported", source: "https://posthog.com/docs/self-host" },
    sso: { verdict: "yes", text: "SAML and OIDC on the Scale package and up", source: "https://posthog.com/platform-packages" },
  },
  honeycomb: {
    mcp_read_only_default: { verdict: "yes", text: "Write tools need an explicit scope grant", source: "https://docs.honeycomb.io/integrations/mcp/concepts" },
    mcp_links_to_records: { verdict: "not_stated", text: "Not stated in the MCP docs", source: "https://docs.honeycomb.io/integrations/mcp/tools" },
    agent_calls_in_app_traces: { verdict: "yes", text: "Agent Timeline opens the full trace", source: "https://www.honeycomb.io/platform/agent-timeline" },
    profile_from_trace: { verdict: "not_marketed", text: "No profiling product in the sitemap", source: "https://docs.honeycomb.io/sitemap.xml" },
    full_self_host: { verdict: "yes", text: "Self-managed Private Cloud on AWS", source: "https://docs.honeycomb.io/get-started/honeycomb/private-cloud" },
    sso: { verdict: "yes", text: "SAML on Pro and Enterprise", source: "https://docs.honeycomb.io/get-started/honeycomb/log-in-with-saml-sso" },
  },
  newrelic: {
    mcp_read_only_default: { verdict: "not_stated", text: "Read OAuth scope; write default not stated", source: "https://docs.newrelic.com/docs/agentic-ai/mcp/overview/" },
    mcp_links_to_records: { verdict: "not_stated", text: "Not stated in the tool reference", source: "https://docs.newrelic.com/docs/agentic-ai/mcp/tool-reference/" },
    agent_calls_in_app_traces: { verdict: "yes", text: "Agent and tool spans in the APM trace", source: "https://docs.newrelic.com/docs/ai-monitoring/explore-ai-data/view-ai-agents/" },
    profile_from_trace: { verdict: "partial", text: "Java JFR profiling; Node.js in preview", source: "https://docs.newrelic.com/docs/apm/agents/java-agent/features/real-time-profiling-java-using-jfr-metrics/" },
    full_self_host: { verdict: "not_marketed", text: "SaaS regions in the US, EU, and Japan", source: "https://docs.newrelic.com/docs/accounts/accounts-billing/account-setup/choose-your-data-center/" },
    sso: { verdict: "yes", text: "SAML on paid editions", source: "https://docs.newrelic.com/docs/accounts/accounts-billing/new-relic-one-user-management/authentication-domains-saml-sso-scim-more/" },
  },
  grafana: {
    mcp_read_only_default: { verdict: "partial", text: "Write access is a consent checkbox; the OSS server has --disable-write", source: "https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/cloud-mcp/" },
    mcp_links_to_records: { verdict: "partial", text: "A generate_deeplink tool for dashboards and Explore", source: "https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/cloud-mcp/" },
    agent_calls_in_app_traces: { verdict: "yes", text: "Generations link to their traces in Tempo", source: "https://grafana.com/docs/grafana-cloud/observe-and-act/agent-observability/observe-and-troubleshoot/conversations/" },
    profile_from_trace: { verdict: "yes", text: "Span profiles for Go, Java, Ruby, .NET, and Python", source: "https://grafana.com/docs/pyroscope/latest/configure-client/trace-span-profiles/" },
    full_self_host: { verdict: "yes", text: "Self-managed open source or Enterprise stack", source: "https://grafana.com/docs/enterprise-traces/latest/" },
    sso: { verdict: "yes", text: "OIDC in all editions; SAML in Enterprise and Cloud", source: "https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/" },
  },
  signoz: {
    mcp_read_only_default: { verdict: "partial", text: "Writes on; scoped by the service account's role", source: "https://signoz.io/docs/ai/signoz-mcp-server/" },
    mcp_links_to_records: { verdict: "yes", text: "Deep links to dashboards, alerts, and traces", source: "https://signoz.io/docs/ai/signoz-mcp-server/" },
    agent_calls_in_app_traces: { verdict: "yes", text: "LLM and tool spans join app traces", source: "https://signoz.io/docs/llm-observability-core-concepts/" },
    profile_from_trace: { verdict: "not_marketed", text: "No profiling product in the docs or README", source: "https://github.com/SigNoz/signoz" },
    full_self_host: { verdict: "yes", text: "Community and Enterprise self-hosted editions", source: "https://github.com/SigNoz/signoz" },
    sso: { verdict: "yes", text: "SAML and OIDC on Cloud and Enterprise", source: "https://signoz.io/docs/manage/administrator-guide/sso/overview/" },
  },
  uptrace: {
    mcp_read_only_default: { verdict: "partial", text: "OAuth read or write scopes, plus write permission", source: "https://uptrace.dev/features/mcp" },
    mcp_links_to_records: { verdict: "not_stated", text: "Not stated on the MCP page", source: "https://uptrace.dev/features/mcp" },
    agent_calls_in_app_traces: { verdict: "partial", text: "OpenTelemetry GenAI instrumentation guides", source: "https://uptrace.dev/guides/opentelemetry-openai" },
    profile_from_trace: { verdict: "no", text: "Profiles are not ingested yet", source: "https://uptrace.dev/opentelemetry/profiles" },
    full_self_host: { verdict: "yes", text: "Community and paid self-hosted editions", source: "https://uptrace.dev/editions" },
    sso: { verdict: "yes", text: "Business and Enterprise editions", source: "https://uptrace.dev/editions" },
  },
  hyperdx: {
    mcp_read_only_default: { verdict: "partial", text: "Write tools on once connected, with a per-user key", source: "https://clickhouse.com/docs/clickstack/mcp" },
    mcp_links_to_records: { verdict: "not_stated", text: "Not stated in the MCP docs", source: "https://clickhouse.com/docs/clickstack/mcp" },
    agent_calls_in_app_traces: { verdict: "partial", text: "OpenTelemetry LLM SDK guides", source: "https://www.hyperdx.io/docs/install/openllmetry" },
    profile_from_trace: { verdict: "not_marketed", text: "No profiling product in the ClickStack docs", source: "https://clickhouse.com/docs/clickstack/overview" },
    full_self_host: { verdict: "yes", text: "ClickStack open source", source: "https://clickhouse.com/docs/clickstack/deployment/oss" },
    sso: { verdict: "yes", text: "SAML on the Enterprise plan", source: "https://www.hyperdx.io/docs/integrations/enterprise-sso" },
  },
};

// Cells researched on 2026-11-10/11 for the change-aware rows (AUDITS.autosre).
const AUTOSRE: Record<string, Record<AutosreKey, Cell>> = {
  datadog: {
    release_flag_cohorts: { verdict: "yes", text: "Deployment Tracking compares versions", source: "https://docs.datadoghq.com/tracing/services/deployment_tracking/" },
    contention_vs_regression: { verdict: "yes", text: "Watchdog RCA separates root cause from affected services", source: "https://docs.datadoghq.com/watchdog/rca/" },
    causal_proof_levels: { verdict: "yes", text: "Bits AI: evidence-backed conclusion or inconclusive", source: "https://docs.datadoghq.com/bits_ai/bits_investigation/investigate_issues/" },
    fix_verified_by_eval: { verdict: "partial", text: "Bits remediation PRs and a Verify Resolution check", source: "https://docs.datadoghq.com/bits_ai/bits_remediation/" },
    gated_remediation: { verdict: "yes", text: "Bits guardrails ask for approval before actions (Preview)", source: "https://docs.datadoghq.com/bits_ai/bits_remediation/guardrails/" },
    click_to_trace: { verdict: "yes", text: "RUM requests linked to backend APM traces", source: "https://docs.datadoghq.com/real_user_monitoring/correlate_with_other_telemetry/apm/" },
  },
  sentry: {
    release_flag_cohorts: { verdict: "yes", text: "Release metrics compared with all releases", source: "https://docs.sentry.io/product/releases/release-details/" },
    contention_vs_regression: { verdict: "partial", text: "Seer can point to a backend service as the cause", source: "https://docs.sentry.io/product/ai-in-sentry/seer/autofix/" },
    causal_proof_levels: { verdict: "partial", text: "Seer names the most likely root cause", source: "https://docs.sentry.io/product/ai-in-sentry/seer/autofix/" },
    fix_verified_by_eval: { verdict: "partial", text: "Seer PRs iterate on failing CI checks", source: "https://docs.sentry.io/product/ai-in-sentry/seer/autofix/" },
    gated_remediation: { verdict: "partial", text: "Autofix opens PRs; automation stop point is configurable", source: "https://docs.sentry.io/product/ai-in-sentry/seer/autofix/" },
    click_to_trace: { verdict: "yes", text: "Click spans parent their requests (experimental)", source: "https://docs.sentry.io/platforms/javascript/configuration/integrations/interactions/" },
  },
  posthog: {
    release_flag_cohorts: { verdict: "partial", text: "Filter issues by release and insights by flag", source: "https://posthog.com/docs/error-tracking/releases" },
    contention_vs_regression: { verdict: "partial", text: "Trace waterfall across services", source: "https://posthog.com/docs/distributed-tracing/basics" },
    causal_proof_levels: { verdict: "partial", text: "Inbox agent researches root cause", source: "https://posthog.com/docs/self-driving/inbox/research" },
    fix_verified_by_eval: { verdict: "partial", text: "Agent PRs add a regression test; a scout re-checks", source: "https://posthog.com/docs/self-driving/anatomy-of-a-pr" },
    gated_remediation: { verdict: "partial", text: "Agent PRs are reviewed; flag changes need approval", source: "https://posthog.com/docs/self-driving/self-improving-loop" },
    click_to_trace: { verdict: "partial", text: "Backend spans carry the replay session ID", source: "https://posthog.com/docs/distributed-tracing/installation/nodejs" },
  },
  honeycomb: {
    release_flag_cohorts: { verdict: "yes", text: "Team Agents check deploys for regressions (early access)", source: "https://www.honeycomb.io/platform/team-agents" },
    contention_vs_regression: { verdict: "partial", text: "BubbleUp compares outliers with a baseline", source: "https://docs.honeycomb.io/investigate/analyze/identify-outliers" },
    causal_proof_levels: { verdict: "partial", text: "Canvas surfaces hypotheses with linked queries", source: "https://docs.honeycomb.io/investigate/canvas/alert-investigation" },
    fix_verified_by_eval: { verdict: "partial", text: "Team Agent memory tracks whether fixes held", source: "https://www.honeycomb.io/platform/team-agents" },
    gated_remediation: { verdict: "yes", text: "Canvas flag changes ask for approval per call", source: "https://docs.honeycomb.io/investigate/canvas/connectors/launchdarkly" },
    click_to_trace: { verdict: "yes", text: "Frontend click to backend call tracing", source: "https://www.honeycomb.io/platform/frontend-observability" },
  },
  newrelic: {
    release_flag_cohorts: { verdict: "yes", text: "Change tracking compares before and after a change", source: "https://docs.newrelic.com/docs/change-tracking/view-analyze-data/" },
    contention_vs_regression: { verdict: "yes", text: "Autopilot attributes causes to downstream dependencies", source: "https://docs.newrelic.com/docs/release-notes/autopilot-release-notes/" },
    causal_proof_levels: { verdict: "partial", text: "Autopilot names likely root causes", source: "https://docs.newrelic.com/docs/agentic-ai/autopilot/overview/" },
    fix_verified_by_eval: { verdict: "partial", text: "Regression issue handed to Copilot; fix PR reviewed", source: "https://docs.newrelic.com/docs/agentic-ai/autopilot/change-tracking-for-github-copilot/" },
    gated_remediation: { verdict: "yes", text: "Workflow Automation approval gates for rollbacks", source: "https://docs.newrelic.com/docs/workflow-automation/introduction-to-workflow/" },
    click_to_trace: { verdict: "yes", text: "Browser interactions in distributed traces", source: "https://docs.newrelic.com/docs/browser/new-relic-browser/browser-pro-features/browser-data-distributed-tracing/" },
  },
  grafana: {
    release_flag_cohorts: { verdict: "partial", text: "Group and filter by service.version", source: "https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/application-observability/setup/resource-attributes/" },
    contention_vs_regression: { verdict: "yes", text: "Knowledge Graph root-cause analysis across dependencies", source: "https://grafana.com/docs/grafana-cloud/platform/knowledge-graph/troubleshoot-infra-apps/workbench-ai/" },
    causal_proof_levels: { verdict: "yes", text: "Investigations show each hypothesis's status and evidence", source: "https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/platform/investigation/" },
    fix_verified_by_eval: { verdict: "partial", text: "Sandboxes run checks on a proposed fix", source: "https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/platform/managed-sandboxes/" },
    gated_remediation: { verdict: "partial", text: "Per-tool approval policies; PR publish approval", source: "https://grafana.com/docs/grafana-cloud/platform/grafana-assistant/configure/mcp-servers/" },
    click_to_trace: { verdict: "yes", text: "Faro user actions with related traces", source: "https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-applications/frontend-observability/visualize-data/user-actions/" },
  },
  signoz: {
    release_flag_cohorts: { verdict: "yes", text: "Noz compares before and after a deploy (Cloud)", source: "https://signoz.io/docs/ai/use-cases/noz-incident-triage/" },
    contention_vs_regression: { verdict: "yes", text: "Noz attributes errors to a dependency or a release", source: "https://signoz.io/docs/ai/noz/" },
    causal_proof_levels: { verdict: "partial", text: "Noz points to a likely root cause", source: "https://signoz.io/docs/ai/noz/" },
    fix_verified_by_eval: { verdict: "partial", text: "Noz proposes fixes and confirms before applying", source: "https://signoz.io/docs/ai/overview/" },
    gated_remediation: { verdict: "partial", text: "Noz asks for confirmation before config changes", source: "https://signoz.io/docs/ai/noz/" },
    click_to_trace: { verdict: "partial", text: "Browser OpenTelemetry traces linked to backend", source: "https://signoz.io/docs/frontend-monitoring/sending-traces-with-opentelemetry/" },
  },
  uptrace: {
    release_flag_cohorts: { verdict: "partial", text: "Group by service version; deploy and flag annotations", source: "https://uptrace.dev/features/traces/querying-spans" },
    contention_vs_regression: { verdict: "partial", text: "Service graph with per-edge errors and latency", source: "https://uptrace.dev/features/service-graph" },
    causal_proof_levels: { verdict: "partial", text: "AI incident analysis with its evidence", source: "https://uptrace.dev/features/mcp" },
    fix_verified_by_eval: { verdict: "not_marketed", text: "Not in the Uptrace docs we read", source: "https://uptrace.dev/features/mcp" },
    gated_remediation: { verdict: "partial", text: "AI incident recommendations you accept or reject", source: "https://uptrace.dev/features/mcp" },
    click_to_trace: { verdict: "partial", text: "Browser OpenTelemetry spans correlated with backend", source: "https://uptrace.dev/get/opentelemetry-js/browser" },
  },
  hyperdx: {
    release_flag_cohorts: { verdict: "partial", text: "Release markers from service.version", source: "https://clickhouse.com/docs/clickstack/observability/features/dashboards/release-markers" },
    contention_vs_regression: { verdict: "partial", text: "Event Deltas and service maps", source: "https://clickhouse.com/docs/clickstack/observability/features/event-deltas" },
    causal_proof_levels: { verdict: "partial", text: "AI Notebooks summarize conclusions (beta)", source: "https://clickhouse.com/docs/clickstack/observability/notebooks" },
    fix_verified_by_eval: { verdict: "not_marketed", text: "Not in the ClickStack docs we read", source: "https://clickhouse.com/docs/clickstack/observability/notebooks" },
    gated_remediation: { verdict: "not_marketed", text: "Not in the ClickStack docs we read", source: "https://clickhouse.com/docs/clickstack/observability/mcp" },
    click_to_trace: { verdict: "yes", text: "Session replay links to backend traces", source: "https://clickhouse.com/docs/clickstack/observability/features/session-replay" },
  },
};

const META: { key: string; slug: string; name: string; summary: string; chooseIf: string }[] = [
  {
    key: "datadog", slug: "datadog", name: "Datadog",
    summary: "Datadog is a SaaS observability platform run from independent regional sites, covering APM, logs, RUM and session replay, product analytics, Agent Observability, and a Datadog-hosted MCP server.",
    chooseIf: "you want a managed platform with enterprise controls, broad integrations, and per-host budgeting.",
  },
  {
    key: "sentry", slug: "sentry", name: "Sentry",
    summary: "Sentry covers errors, tracing, logs, session replay on web and mobile, and Agent Tracing, as a SaaS or as a Fair Source self-hosted install.",
    chooseIf: "you want errors, session replay including mobile, and traces without running infrastructure.",
  },
  {
    key: "posthog", slug: "posthog", name: "PostHog",
    summary: "PostHog is a cloud-first product platform: product analytics, session replay, logs, AI Observability, and distributed tracing in beta since July 2026.",
    chooseIf: "product analytics comes first and you want session replay, logs, and tracing alongside it.",
  },
  {
    key: "honeycomb", slug: "honeycomb", name: "Honeycomb",
    summary: "Honeycomb is an OTLP-native observability platform built on wide structured events, with Agent Timeline for AI agents and a Private Cloud option in your AWS account.",
    chooseIf: "you want deep trace analysis and agent timelines on a wide-event store.",
  },
  {
    key: "newrelic", slug: "new-relic", name: "New Relic",
    summary: "New Relic is a SaaS observability platform with US, EU, and Japan regions, native OTLP ingest, AI Monitoring, session replay, and a hosted MCP server.",
    chooseIf: "you want a managed platform with enterprise controls, broad integrations, and NRQL across your telemetry.",
  },
  {
    key: "grafana", slug: "grafana", name: "Grafana Cloud",
    summary: "Grafana Cloud hosts Grafana's observability stack, including Tempo for traces and Loki for logs, and the open-source components can also be self-hosted.",
    chooseIf: "you want a composable stack you can scale per signal, hosted or self-managed.",
  },
  {
    key: "signoz", slug: "signoz", name: "SigNoz",
    summary: "SigNoz is an OpenTelemetry-native platform offered as SigNoz Cloud, as Enterprise BYOC or self-hosted, and as an open-source Community edition.",
    chooseIf: "you want an OpenTelemetry-native platform with ingest-based pricing, hosted or self-managed.",
  },
  {
    key: "uptrace", slug: "uptrace", name: "Uptrace",
    summary: "Uptrace is an OpenTelemetry-native platform offered as Uptrace Cloud, as AGPL open source to self-host, or as a licensed on-prem install, with an MCP server built in.",
    chooseIf: "you want an OpenTelemetry-native backend with per-GB pricing and a built-in MCP server.",
  },
  {
    key: "hyperdx", slug: "hyperdx", name: "HyperDX",
    summary: "HyperDX, part of ClickHouse's ClickStack, links session replay with logs and traces, and is available as HyperDX Cloud, as MIT open source, or as ClickStack.",
    chooseIf: "you want an open-source, ClickHouse-backed stack with session replay linked to logs and traces.",
  },
];

export const VENDORS: Vendor[] = META.map((m) => ({
  ...m,
  cells: { ...REUSED[m.key], ...ADDED[m.key], ...AUTOSRE[m.key] } as Record<RowKey, Cell>,
}));

export function verdictLabel(v: Verdict): string {
  switch (v) {
    case "yes": return "Yes";
    case "partial": return "Partial";
    case "no": return "No";
    case "not_marketed": return "Not marketed";
    case "not_stated": return "Not stated";
  }
}
