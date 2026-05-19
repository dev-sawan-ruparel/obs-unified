import "./style.css";
import { renderHeader } from "./sections/header";
import { renderHero } from "./sections/hero";
import { renderFeatures } from "./sections/features";
import { renderPreview } from "./sections/preview";
import { renderArchitecture } from "./sections/architecture";
import { renderCompare } from "./sections/compare";
import { renderFaq } from "./sections/faq";
import { renderFooter } from "./sections/footer";
import { ensureJsonLdScript } from "./schema";

const root = document.getElementById("app");
if (!root) throw new Error("#app root missing");

ensureJsonLdScript();

if (!root.innerHTML.trim()) {
  root.innerHTML = [
    renderHeader(),
    `<main id="main">`,
    renderHero(),
    renderFeatures(),
    renderPreview(),
    renderArchitecture(),
    renderCompare(),
    renderFaq(),
    `</main>`,
    renderFooter(),
  ].join("");
}
