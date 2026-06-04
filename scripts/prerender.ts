import { readFile, writeFile } from "node:fs/promises";
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const distHtml = resolve(__dirname, "../dist/index.html");

const body = [
  renderHeader(),
  `<main id="main">`,
  renderHero(),
  renderScreenshots(),
  renderFeatures(),
  renderCcr(),
  renderPreview(),
  renderArchitecture(),
  renderCompare(),
  renderFaq(),
  `</main>`,
  renderFooter(),
].join("");

const html = await readFile(distHtml, "utf8");

const APP_DIV = /<div id="app"><\/div>/;
if (!APP_DIV.test(html)) {
  throw new Error(`prerender: could not find <div id="app"></div> in ${distHtml}`);
}

let next = html.replace(APP_DIV, `<div id="app">${body}</div>`);
next = next.replace("</head>", `    ${renderJsonLdScript()}\n  </head>`);

const titleEscaped = escapeHtml(siteContent.seo.title);
const descEscaped = escapeHtml(siteContent.seo.description);

next = next.replace(/<title>[^]*?<\/title>/i, `<title>${titleEscaped}</title>`);
next = next.replace(/<meta\s+name="description"\s+content="[^]*?"\s*\/?>/i, `<meta name="description" content="${descEscaped}" />`);
next = next.replace(/<meta\s+property="og:title"\s+content="[^]*?"\s*\/?>/i, `<meta property="og:title" content="${titleEscaped}" />`);
next = next.replace(/<meta\s+property="og:description"\s+content="[^]*?"\s*\/?>/i, `<meta property="og:description" content="${descEscaped}" />`);
next = next.replace(/<meta\s+name="twitter:title"\s+content="[^]*?"\s*\/?>/i, `<meta name="twitter:title" content="${titleEscaped}" />`);
next = next.replace(/<meta\s+name="twitter:description"\s+content="[^]*?"\s*\/?>/i, `<meta name="twitter:description" content="${descEscaped}" />`);

await writeFile(distHtml, next, "utf8");

const before = html.length;
const after = next.length;
console.log(
  `prerendered ${distHtml}\n  body inserted: ${body.length.toLocaleString()} bytes\n  file size: ${before.toLocaleString()} → ${after.toLocaleString()} bytes`,
);
