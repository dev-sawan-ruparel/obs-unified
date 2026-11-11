// vendor-pages-check.ts — keeps /compare/<vendor>/ pages honest.
//
// Checks (any failure exits 1):
//   1. One page per vendor in the messaging manifest's comparison rows, with
//      unique slugs, and every page is in public/sitemap.xml.
//   2. Every vendor and the Observability Unified column have a cell for every
//      row, with a known verdict, non-empty text, and an https source.
//   3. Observability Unified cells cite docs.obsunified.com; vendor cells
//      never cite obsunified.com.
//   4. Every cell in a row marked `added` matches a row in the vendor-pages
//      ledger (vendor, row, verdict, URL), and the ledger's counts match.
//   5. Vendor cell text stays neutral (no disparaging wording).
//
// Run with tsx; it imports the same modules the pages render from.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GROUPS,
  OBS,
  VENDOR_PAGES_LEDGER_URL,
  VENDOR_PAGES_REVIEWED,
  VENDORS,
  type Verdict,
} from "../src/content/vendor-compare";

const here = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(here, "..");
const repoRoot = resolve(websiteRoot, "..", "..");

const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const ok = (m: string) => console.log(`  ✓ ${m}`);

const VERDICTS: Verdict[] = ["yes", "partial", "no", "not_marketed", "not_stated"];
const ROWS = GROUPS.flatMap((g) => g.rows);
const ADDED = ROWS.filter((r) => r.added);
const DISPARAGING = /\b(lacks?|lacking|missing|poor|bad|worse|inferior|expensive|insane|clunky|outdated|legacy)\b/i;

// 1. vendor coverage, slugs, sitemap
const manifest = JSON.parse(readFileSync(join(websiteRoot, "public", "messaging.manifest.json"), "utf8"));
const manifestKeys: string[] = (manifest?.authored?.positioning?.comparison?.agentRows ?? [])
  .map((r: { key: string }) => r.key)
  .filter((k: string) => k !== "obs");
const vendorKeys = VENDORS.map((v) => v.key);
const missing = manifestKeys.filter((k) => !vendorKeys.includes(k));
const extra = vendorKeys.filter((k) => !manifestKeys.includes(k));
if (missing.length || extra.length) fail(`vendor pages vs manifest: missing [${missing.join(", ")}] extra [${extra.join(", ")}]`);
else ok(`${VENDORS.length} vendor pages match the manifest's comparison vendors`);
const slugs = VENDORS.map((v) => v.slug);
if (new Set(slugs).size !== slugs.length) fail(`duplicate slugs: ${slugs.join(", ")}`);
const sitemap = readFileSync(join(websiteRoot, "public", "sitemap.xml"), "utf8");
for (const loc of ["/compare/", ...slugs.map((s) => `/compare/${s}/`)]) {
  if (!sitemap.includes(`<loc>https://obsunified.com${loc}</loc>`)) fail(`sitemap.xml is missing ${loc}`);
}

// 2 + 3 + 5. cells
const isHttps = (u: string) => /^https:\/\/[^\s]+$/.test(u);
let cellCount = 0;
for (const r of ROWS) {
  const c = OBS[r.key];
  if (!c) { fail(`Observability Unified has no cell for ${r.key}`); continue; }
  if (!VERDICTS.includes(c.verdict)) fail(`obs.${r.key}: unknown verdict ${c.verdict}`);
  if (!c.text.trim()) fail(`obs.${r.key}: empty text`);
  if (!c.source.startsWith("https://docs.obsunified.com/")) fail(`obs.${r.key}: source must be docs.obsunified.com, got ${c.source}`);
}
for (const v of VENDORS) {
  if (!v.summary.trim() || !v.chooseIf.trim()) fail(`${v.key}: summary and chooseIf are required`);
  for (const r of ROWS) {
    const c = v.cells[r.key];
    if (!c) { fail(`${v.key} has no cell for ${r.key}`); continue; }
    cellCount++;
    if (!VERDICTS.includes(c.verdict)) fail(`${v.key}.${r.key}: unknown verdict ${c.verdict}`);
    if (!c.text.trim()) fail(`${v.key}.${r.key}: empty text`);
    if (!isHttps(c.source)) fail(`${v.key}.${r.key}: source is not an https URL: ${c.source}`);
    else if (/(^|\.)obsunified\.com$/.test(new URL(c.source).hostname) && c.verdict !== "not_marketed")
      fail(`${v.key}.${r.key}: a vendor cell cannot cite obsunified.com`);
    if (DISPARAGING.test(c.text)) fail(`${v.key}.${r.key}: wording "${c.text}" reads as disparaging`);
  }
}
ok(`${cellCount} vendor cells and ${ROWS.length} Observability Unified cells have verdicts, text, and sources`);

// 4. ledger for the rows added for these pages
const ledgerName = VENDOR_PAGES_LEDGER_URL.split("/").pop() ?? "";
const ledgerPath = join(repoRoot, "docs", ledgerName);
if (!ledgerName.includes(VENDOR_PAGES_REVIEWED)) fail(`ledger ${ledgerName} does not carry the review date ${VENDOR_PAGES_REVIEWED}`);
if (!existsSync(ledgerPath)) {
  fail(`ledger not found: docs/${ledgerName}`);
} else {
  const ledger = readFileSync(ledgerPath, "utf8");
  // Ledger rows: | <vendor> | <row> | <verdict> | <cell> | <url> | <excerpt> |
  const entries = new Map<string, { verdict: string; url: string }>();
  for (const line of ledger.split("\n")) {
    const m = /^\|\s*([a-z]+)\s*\|\s*([a-z_]+)\s*\|\s*`?([a-z_]+)`?\s*\|[^|]*\|\s*<?(https:\/\/[^\s|>]+)>?\s*\|/.exec(line);
    if (m) entries.set(`${m[1]}.${m[2]}`, { verdict: m[3], url: m[4] });
  }
  let matched = 0;
  for (const v of VENDORS) {
    for (const r of ADDED) {
      const c = v.cells[r.key];
      const e = entries.get(`${v.key}.${r.key}`);
      if (!e) { fail(`ledger has no entry for ${v.key}.${r.key}`); continue; }
      if (e.verdict !== c.verdict) fail(`${v.key}.${r.key}: page says ${c.verdict}, ledger says ${e.verdict}`);
      if (e.url !== c.source) fail(`${v.key}.${r.key}: page cites ${c.source}, ledger cites ${e.url}`);
      matched++;
    }
  }
  const expected = VENDORS.length * ADDED.length;
  const declared = /Cells:\s*\*\*(\d+)\*\*/.exec(ledger)?.[1];
  if (declared !== String(expected)) fail(`ledger declares ${declared ?? "no"} cells, pages have ${expected}`);
  if (matched === expected) ok(`all ${expected} researched cells match the ${VENDOR_PAGES_REVIEWED} ledger`);
}

if (failures.length) {
  console.error(`\nvendor-pages-check: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("vendor-pages-check: ok");
