import { FAQS } from "./content/faq";

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://obsunified.com/#software",
      name: "obs-unified",
      alternateName: "obs",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform (Cloudflare Workers, Node.js, Bun, Deno)",
      description:
        "Unified observability platform that connects OpenTelemetry traces, structured logs, LLM/AI call records, frontend usage events, rrweb session replays, alerts, profiles, and analyses through one collector, one identity chain, and one dashboard. The local first-run image includes Postgres, collector, dashboard, blob storage, and seed data.",
      url: "https://obsunified.com/",
      programmingLanguage: ["TypeScript", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Distributed tracing (OTLP)",
        "Structured logging with trace correlation",
        "LLM/AI call tracking (tokens, cost, latency)",
        "Session replay via rrweb",
        "Frontend usage analytics",
        "Alert rules and notifications",
        "User profiles and identity stitching",
        "Self-hosted on your own infrastructure",
        "Unified collector, identity chain, and dashboard",
      ],
    },
    {
      "@type": "Organization",
      "@id": "https://obsunified.com/#org",
      name: "obs-unified",
      url: "https://obsunified.com/",
    },
    {
      "@type": "WebSite",
      "@id": "https://obsunified.com/#website",
      url: "https://obsunified.com/",
      name: "obs-unified",
      publisher: { "@id": "https://obsunified.com/#org" },
    },
    {
      "@type": "FAQPage",
      "@id": "https://obsunified.com/#faq",
      mainEntity: FAQS.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: {
          "@type": "Answer",
          text: a,
        },
      })),
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
