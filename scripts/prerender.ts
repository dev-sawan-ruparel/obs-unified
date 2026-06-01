import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { renderHeader } from "../src/sections/header";
import { renderHero } from "../src/sections/hero";
import { renderScreenshots } from "../src/sections/screenshots";
import { renderFeatures } from "../src/sections/features";
import { renderPreview } from "../src/sections/preview";
import { renderArchitecture } from "../src/sections/architecture";
import { renderCompare } from "../src/sections/compare";
import { renderFaq } from "../src/sections/faq";
import { renderFooter } from "../src/sections/footer";
import { renderJsonLdScript } from "../src/schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distHtml = resolve(__dirname, "../dist/index.html");

const body = [
  renderHeader(),
  `<main id="main">`,
  renderHero(),
  renderScreenshots(),
  renderFeatures(),
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

await writeFile(distHtml, next, "utf8");

const before = html.length;
const after = next.length;
console.log(
  `prerendered ${distHtml}\n  body inserted: ${body.length.toLocaleString()} bytes\n  file size: ${before.toLocaleString()} → ${after.toLocaleString()} bytes`,
);
