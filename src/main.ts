import "./style.css";
import { renderHeader } from "./sections/header";
import { renderHero } from "./sections/hero";
import { renderScreenshots } from "./sections/screenshots";
import { renderFeatures } from "./sections/features";
import { renderCcr } from "./sections/ccr";
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
}

document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-copy]");
  if (!button) return;

  const value = button.dataset.copy;
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    button.dataset.copied = "true";
    button.textContent = "Copied";
    window.setTimeout(() => {
      button.dataset.copied = "false";
      button.textContent = "Copy";
    }, 1600);
  } catch {
    button.textContent = "Select";
  }
});
