import { siteContent } from "./content/site";
import { messaging } from "./content/messaging.generated";

const { faq, schema, seo } = siteContent;

// Shipped capabilities from the messaging package are the single source for
// jsonld.featureList (see surfacesWhenShipped in messaging.generated.ts).
const featureList = messaging.authored.capabilities
  .filter((c) => c.status === "shipped")
  .map((c) => c.name);

const graph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${seo.siteUrl}#org`,
      name: "Observability Unified",
      url: seo.siteUrl,
      logo: `${seo.siteUrl}icon-512.png`,
      sameAs: [seo.githubUrl, seo.docsUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${seo.siteUrl}#website`,
      url: seo.siteUrl,
      name: "Observability Unified",
      description: seo.description,
      publisher: { "@id": `${seo.siteUrl}#org` },
      inLanguage: "en-US",
      subjectOf: [
        {
          "@type": "TextDigitalDocument",
          name: "Observability Unified LLMs.txt — Machine-readable guide for AI agents",
          url: `${seo.siteUrl}llms.txt`,
          encodingFormat: "text/plain",
        },
        {
          "@type": "TextDigitalDocument",
          name: "Observability Unified Docs LLMs.txt — Machine-readable documentation index",
          url: "https://docs.obsunified.com/llms.txt",
          encodingFormat: "text/plain",
        },
        {
          "@type": "TextDigitalDocument",
          name: "Observability Unified Full Documentation Corpus (llms-full.txt)",
          url: "https://docs.obsunified.com/llms-full.txt",
          encodingFormat: "text/plain",
        },
      ],
    },
    {
      "@type": "WebPage",
      "@id": `${seo.siteUrl}#webpage`,
      url: seo.siteUrl,
      name: seo.title,
      description: seo.description,
      isPartOf: { "@id": `${seo.siteUrl}#website` },
      about: { "@id": `${seo.siteUrl}#software` },
      mainEntity: [
        { "@id": `${seo.siteUrl}#software` },
        { "@id": `${seo.siteUrl}#faq` },
      ],
      primaryImageOfPage: { "@id": `${seo.siteUrl}#og-image` },
      inLanguage: "en-US",
    },
    {
      "@type": "ImageObject",
      "@id": `${seo.siteUrl}#og-image`,
      url: `${seo.siteUrl}og.jpg`,
      contentUrl: `${seo.siteUrl}og.jpg`,
      encodingFormat: "image/jpeg",
      width: 1200,
      height: 630,
      caption: seo.ogCaption,
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${seo.siteUrl}#software`,
      name: "Observability Unified",
      alternateName: "obs-unified",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform (Cloudflare Workers, Node.js, Bun, Deno, Docker, Linux, macOS)",
      description: seo.description,
      url: seo.siteUrl,
      image: `${seo.siteUrl}og.jpg`,
      screenshot: [
        `${seo.siteUrl}screenshots/app/agent-action-graph.png`,
        `${seo.siteUrl}screenshots/app/interaction-id-path.png`,
        `${seo.siteUrl}screenshots/app/service-map-astronomy.png`,
        `${seo.siteUrl}screenshots/app/ai-cost-spans.png`,
        `${seo.siteUrl}screenshots/app/timeline-unified.png`,
        `${seo.siteUrl}screenshots/app/trace-profile-slot.png`,
      ],
      softwareHelp: seo.docsUrl,
      codeRepository: seo.githubUrl,
      downloadUrl: seo.githubUrl,
      programmingLanguage: ["TypeScript", "Python", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      review: {
        "@type": "Review",
        author: { "@type": "Organization", name: "Observability Unified maintainers" },
        reviewBody: schema.reviewBody,
      },
      featureList,
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${seo.siteUrl}#source`,
      name: "Observability Unified source code",
      codeRepository: seo.githubUrl,
      programmingLanguage: ["TypeScript", "Python", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      runtimePlatform: ["Cloudflare Workers", "Node.js", "Browser"],
      about: { "@id": `${seo.siteUrl}#software` },
    },
    {
      "@type": "FAQPage",
      "@id": `${seo.siteUrl}#faq`,
      url: `${seo.siteUrl}#faq`,
      name: "Observability Unified — Frequently Asked Questions",
      isPartOf: { "@id": `${seo.siteUrl}#webpage` },
      inLanguage: "en-US",
      mainEntity: faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.a,
        },
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${seo.siteUrl}#breadcrumbs`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Observability Unified",
          item: seo.siteUrl,
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
