import { siteContent } from "./content/site";
import { messaging } from "./content/messaging.generated";

const { schema, seo } = siteContent;

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
      sameAs: [seo.githubUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${seo.siteUrl}#website`,
      url: seo.siteUrl,
      name: "Observability Unified",
      description: seo.description,
      publisher: { "@id": `${seo.siteUrl}#org` },
      inLanguage: "en-US",
    },
    {
      "@type": "WebPage",
      "@id": `${seo.siteUrl}#webpage`,
      url: seo.siteUrl,
      name: seo.title,
      description: seo.description,
      isPartOf: { "@id": `${seo.siteUrl}#website` },
      about: { "@id": `${seo.siteUrl}#software` },
      primaryImageOfPage: { "@id": `${seo.siteUrl}#og-image` },
      inLanguage: "en-US",
    },
    {
      "@type": "ImageObject",
      "@id": `${seo.siteUrl}#og-image`,
      url: `${seo.siteUrl}og.jpg`,
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
      operatingSystem: "Cross-platform (Cloudflare Workers, Node.js, Bun, Deno)",
      description: seo.description,
      url: seo.siteUrl,
      image: `${seo.siteUrl}og.jpg`,
      screenshot: `${seo.siteUrl}screenshots/app/agent-action-graph.png`,
      softwareHelp: seo.docsUrl,
      codeRepository: seo.githubUrl,
      downloadUrl: seo.githubUrl,
      programmingLanguage: ["TypeScript", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
      review: {
        "@type": "Review",
        author: { "@type": "Organization", name: "Observability Unified maintainers" },
        reviewBody: schema.reviewBody,
      },
      featureList: featureList,
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${seo.siteUrl}#source`,
      name: "Observability Unified source code",
      codeRepository: seo.githubUrl,
      programmingLanguage: ["TypeScript", "Go", "Rust"],
      license: "https://opensource.org/license/mit",
      runtimePlatform: ["Cloudflare Workers", "Node.js", "Browser"],
      about: { "@id": `${seo.siteUrl}#software` },
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
