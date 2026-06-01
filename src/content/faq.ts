export type QA = { q: string; a: string };

export const FAQS: QA[] = [
  {
    q: "What is obs-unified?",
    a: "obs-unified is an open-source unified observability platform built for agentic debugging. A single collector ingests OpenTelemetry traces, structured logs, LLM/AI call records, frontend usage events, rrweb session replays, alerts, profiles, analyses, and Agent Action Graph records, then connects them through one identity chain and one telemetry graph agents can traverse from user action to backend trace, logs, replay, AI cost, MCP tool context, and CPU profile. The fastest first run is one local Docker image with Postgres, the collector, dashboard, blob storage, and seed data.",
  },
  {
    q: "What is the Agent Action Graph?",
    a: "The Agent Action Graph is obs-unified's causal view of agent work. It links browser actions, cron jobs, agent runs, LLM calls, retrievals, tool calls, guardrails, backend traces, logs, profiles, and eval cases through stable action IDs, so engineers and AI agents can see which step caused which downstream effect.",
  },
  {
    q: "Can AI agents inspect obs-unified through MCP?",
    a: "Yes. The obs-unified MCP server exposes investigation tools for status, recent traces, trace detail, service maps, logs, AI sessions, users, replays, connected signals, agent runs, actions, and tool calls. Agents can use those tools to traverse the same graph a human sees in the dashboard without needing write access to telemetry ingest.",
  },
  {
    q: "How is it different from Datadog, Sentry, or PostHog?",
    a: "Its primary difference is unification. APM traces, logs, product analytics, session replay, AI observability, alerting, profiles, agent action graphs, and analyses live in one collector and one dashboard, correlated through a single identity chain and exposed to agents through MCP. It also runs on your own infrastructure, so no external telemetry vendor sits in the data path.",
  },
  {
    q: "What's the data retention model?",
    a: "Retention is controlled by the RETENTION_HOURS environment variable on the collector and defaults to 72 hours. Profile blobs have a separate PROFILE_RETENTION_HOURS override because they're larger per record. Because everything lives in your storage account, you set the policy and pay the storage directly; there's no per-event retention tier to negotiate.",
  },
  {
    q: "When do I outgrow D1, and what's the upgrade path?",
    a: "D1 is the default low-ops hosted path for small and medium deployments. The practical ceiling depends on event volume, cardinality, and retention, so heavy installs should move to the Node collector with Postgres plus S3-compatible blob storage before D1 becomes the bottleneck.",
  },
  {
    q: "How does it handle PII and GDPR?",
    a: "Self-hosting is the headline answer: data never leaves your infrastructure, so residency and processor questions reduce to where you deploy. On top of that, the usage-event pipeline applies default-redact scrubbing on ingest; fields named like email, token, password, authorization, or cookie are stripped from context and properties JSON before storage. Session replays use rrweb, which masks input fields by default and supports per-element block/mask attributes.",
  },
  {
    q: "Does it support SSO or multi-user dashboards?",
    a: "Not today. Two auth boundaries ship: a write-only ingest API key for SDKs and a single password for the dashboard. Multi-user, RBAC, and SSO are out of scope and tracked separately. Most teams put the dashboard behind their existing identity proxy, such as Cloudflare Access or Tailscale, in the meantime.",
  },
  {
    q: "Can I migrate from Datadog, Sentry, or PostHog?",
    a: "Sentry, PostHog, Honeycomb, and older @obs/* package migrations are covered in the docs. For Datadog, OTLP-native ingest accepts the standard OpenTelemetry SDK over OTLP HTTP, so traces and logs are usually a configuration change; a dedicated walkthrough is tracked separately.",
  },
  {
    q: "Does it work with my existing OpenTelemetry SDK?",
    a: "Yes. The collector accepts OTLP over HTTP using JSON or protobuf, with gzip. gRPC is intentionally not supported because Cloudflare Workers cannot host it, and OTLP HTTP covers every official SDK. The first-party SDKs are thin wrappers that point the standard OpenTelemetry SDK at the collector and add OpenInference helpers for LLM and tool spans.",
  },
  {
    q: "Is it free and open source?",
    a: "Yes. obs-unified is MIT-licensed. You pay only for the infrastructure you run it on: Cloudflare Workers plus D1 and R2, or the Node collector with Postgres plus S3-compatible storage.",
  },
];
