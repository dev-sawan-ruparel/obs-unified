const SITE_URL = "https://obsunified.com/";
const DOCS_URL = "https://docs.obsunified.com/docs";
const GITHUB_URL = "https://github.com/obs-unified/obs-unified";

const description =
  "Self-hosted unified observability for agentic debugging across traces, logs, replay, AI cost, action graphs, MCP tools, and CPU profiles.";

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}#org`,
      name: "Observability Unified",
      url: SITE_URL,
      logo: `${SITE_URL}icon-512.png`,
      sameAs: [GITHUB_URL],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}#website`,
      url: SITE_URL,
      name: "Observability Unified",
      description,
      publisher: { "@id": `${SITE_URL}#org` },
      inLanguage: "en-US",
    },
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}#webpage`,
      url: SITE_URL,
      name: "Observability Unified — agentic debugging on one telemetry graph",
      description,
      isPartOf: { "@id": `${SITE_URL}#website` },
      about: { "@id": `${SITE_URL}#software` },
      primaryImageOfPage: { "@id": `${SITE_URL}#og-image` },
      inLanguage: "en-US",
    },
    {
      "@type": "ImageObject",
      "@id": `${SITE_URL}#og-image`,
      url: `${SITE_URL}og.jpg`,
      width: 1200,
      height: 630,
      caption: "Observability Unified telemetry graph for agentic debugging",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}#software`,
      name: "Observability Unified",
      alternateName: "obs-unified",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform (Cloudflare Workers, Node.js, Bun, Deno)",
      description,
      url: SITE_URL,
      image: `${SITE_URL}og.jpg`,
      screenshot: `${SITE_URL}screenshots/app/agent-action-graph.png`,
      softwareHelp: DOCS_URL,
      codeRepository: GITHUB_URL,
      downloadUrl: GITHUB_URL,
      programmingLanguage: ["TypeScript", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      review: {
        "@type": "Review",
        author: { "@type": "Organization", name: "Observability Unified maintainers" },
        reviewBody:
          "Designed as one self-hosted telemetry graph for agentic debugging, connecting frontend interactions to action graphs, backend traces, logs, replay, AI cost, MCP context, and CPU profiling evidence.",
      },
      featureList: [
        "Agentic debugging graph from user action to backend trace, action graph, MCP context, and CPU profile",
        "MCP server for AI agents to inspect traces, logs, replays, connected signals, agent runs, actions, and tool calls",
        "OpenTelemetry trace ingest over OTLP HTTP",
        "Structured logging with trace correlation",
        "Agent Action Graph for LLM calls, retrievals, tool calls, guardrails, and eval cases",
        "LLM and AI call tracking for tokens, cost, latency, and errors",
        "Session replay via rrweb",
        "Frontend product analytics and usage events",
        "Alert rules and notifications",
        "User profiles and identity stitching",
        "Self-hosted on Cloudflare Workers with D1 and R2",
        "Node collector with Postgres and S3-compatible storage",
      ],
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${SITE_URL}#source`,
      name: "Observability Unified source code",
      codeRepository: GITHUB_URL,
      programmingLanguage: ["TypeScript", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      runtimePlatform: ["Cloudflare Workers", "Node.js", "Browser"],
      about: { "@id": `${SITE_URL}#software` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${SITE_URL}#breadcrumbs`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Observability Unified",
          item: SITE_URL,
        },
      ],
    },
  ],
};

export function renderJsonLdScript(): string {
  return `<script id="schema-jsonld" type="application/ld+json">${JSON.stringify(graph, null, 2)}</script>`;
}

export function ensureJsonLdScript(): void {
  if (document.getElementById("schema-jsonld")) return;
  document.head.insertAdjacentHTML("beforeend", renderJsonLdScript());
}
