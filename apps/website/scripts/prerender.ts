import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { renderHeader } from "../src/sections/header";
import { renderHero } from "../src/sections/hero";
import { renderScreenshots } from "../src/sections/screenshots";
import { renderFeatures } from "../src/sections/features";
import { renderCcr } from "../src/sections/ccr";
import { renderPreview } from "../src/sections/preview";
import { renderArchitecture } from "../src/sections/architecture";
import { renderCompare } from "../src/sections/compare";
import { renderFaq } from "../src/sections/faq";
import { renderFooter } from "../src/sections/footer";
import { renderJsonLdScript } from "../src/schema";
import { siteContent } from "../src/content/site";
import { VENDORS } from "../src/content/vendor-compare";
import {
  SITE_ORIGIN,
  comparePath,
  renderCompareIndex,
  renderVendorPage,
  vendorPageDescription,
  vendorPageTitle,
} from "../src/pages/compare-pages";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");
const distHtml = resolve(distDir, "index.html");

const template = await readFile(distHtml, "utf8");

const APP_DIV = /<div id="app"><\/div>/;
if (!APP_DIV.test(template)) {
  throw new Error(`prerender: could not find <div id="app"></div> in ${distHtml}`);
}

type Page = {
  /** Output path relative to dist/, e.g. "index.html" or "compare/datadog/index.html". */
  out: string;
  /** Absolute canonical URL. */
  url: string;
  title: string;
  description: string;
  body: string;
  jsonLd: string;
  /** The homepage preloads its hero image; other pages do not need it. */
  keepHeroPreload: boolean;
};

function replaceOrFail(html: string, re: RegExp, value: string, what: string, out: string): string {
  if (!re.test(html)) throw new Error(`prerender: ${what} not found in template (${out})`);
  return html.replace(re, value);
}

function renderPage(page: Page): string {
  const title = escapeHtml(page.title);
  const desc = escapeHtml(page.description);
  const url = escapeHtml(page.url);
  let html = template.replace(APP_DIV, `<div id="app">${page.body}</div>`);
  html = html.replace("</head>", `    ${page.jsonLd}\n  </head>`);
  html = replaceOrFail(html, /<title>[^]*?<\/title>/i, `<title>${title}</title>`, "<title>", page.out);
  html = replaceOrFail(html, /<meta\s+name="description"\s+content="[^]*?"\s*\/?>/i, `<meta name="description" content="${desc}" />`, "meta description", page.out);
  html = replaceOrFail(html, /<meta\s+property="og:title"\s+content="[^]*?"\s*\/?>/i, `<meta property="og:title" content="${title}" />`, "og:title", page.out);
  html = replaceOrFail(html, /<meta\s+property="og:description"\s+content="[^]*?"\s*\/?>/i, `<meta property="og:description" content="${desc}" />`, "og:description", page.out);
  html = replaceOrFail(html, /<meta\s+name="twitter:title"\s+content="[^]*?"\s*\/?>/i, `<meta name="twitter:title" content="${title}" />`, "twitter:title", page.out);
  html = replaceOrFail(html, /<meta\s+name="twitter:description"\s+content="[^]*?"\s*\/?>/i, `<meta name="twitter:description" content="${desc}" />`, "twitter:description", page.out);
  html = replaceOrFail(html, /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i, `<link rel="canonical" href="${url}" />`, "canonical", page.out);
  html = replaceOrFail(html, /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i, `<meta property="og:url" content="${url}" />`, "og:url", page.out);
  if (!page.keepHeroPreload) {
    html = html.replace(/\s*<link rel="preload" as="image" href="\/evidence-graph.svg"[^>]*>/, "");
  }
  return html;
}

// Sub-pages get a breadcrumb graph under the same element id the client
// checks, so main.ts does not inject the homepage graph (which includes the
// homepage FAQ) into them.
function breadcrumbJsonLd(items: { name: string; url: string }[]): string {
  const graph = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
  return `<script id="schema-jsonld" type="application/ld+json">${JSON.stringify(graph)}</script>`;
}

function shell(main: string): string {
  return [renderHeader(), `<main id="main">`, main, `</main>`, renderFooter()].join("");
}

const pages: Page[] = [
  {
    out: "index.html",
    url: `${SITE_ORIGIN}/`,
    title: siteContent.seo.title,
    description: siteContent.seo.description,
    body: shell(
      [renderHero(), renderCcr(), renderScreenshots(), renderFeatures(), renderPreview(), renderArchitecture(), renderCompare(), renderFaq()].join(""),
    ),
    jsonLd: renderJsonLdScript(),
    keepHeroPreload: true,
  },
  {
    out: "compare/index.html",
    url: `${SITE_ORIGIN}/compare/`,
    title: "Compare Observability Unified with other observability tools",
    description:
      "One page per vendor comparing Observability Unified with Datadog, Sentry, PostHog, Honeycomb, New Relic, Grafana Cloud, SigNoz, Uptrace, and HyperDX, with a source for every cell.",
    body: shell(renderCompareIndex()),
    jsonLd: breadcrumbJsonLd([
      { name: "Home", url: `${SITE_ORIGIN}/` },
      { name: "Compare", url: `${SITE_ORIGIN}/compare/` },
    ]),
    keepHeroPreload: false,
  },
  ...VENDORS.map((v) => ({
    out: `compare/${v.slug}/index.html`,
    url: `${SITE_ORIGIN}${comparePath(v)}`,
    title: vendorPageTitle(v),
    description: vendorPageDescription(v),
    body: shell(renderVendorPage(v)),
    jsonLd: breadcrumbJsonLd([
      { name: "Home", url: `${SITE_ORIGIN}/` },
      { name: "Compare", url: `${SITE_ORIGIN}/compare/` },
      { name: `vs ${v.name}`, url: `${SITE_ORIGIN}${comparePath(v)}` },
    ]),
    keepHeroPreload: false,
  })),
];

for (const page of pages) {
  const target = resolve(distDir, page.out);
  await mkdir(dirname(target), { recursive: true });
  const html = renderPage(page);
  await writeFile(target, html, "utf8");
  console.log(`prerendered ${page.out} (${html.length.toLocaleString()} bytes)`);
}
