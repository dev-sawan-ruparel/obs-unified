#!/usr/bin/env node
// comparison-check.mjs — keeps the three comparison surfaces in lockstep:
//   apps/website/src/sections/compare.ts   (landing-page table)
//   apps/docs/content/docs/comparison.mdx   (cited vendor sections)
//   docs/comparison-full-audit-<date>.md    (per-cell verdict ledger)
//
// Checks:
//   1. LAST_REVIEWED in compare.ts matches the "Reviewed YYYY-MM-DD" callout
//      in comparison.mdx and the ledger filename referenced by compare.ts.
//   2. The referenced ledger file exists and its verdict counts match the
//      SOURCE_CHECKED/INFERRED/TOTAL constants in compare.ts.
//   2b. Ledger cell indices in section 3 are exactly 1..TOTAL with no
//      duplicates or gaps.
//   2c. The same checks run for the supplementary agent-access ledger
//      (AGENT_ACCESS_* constants, docs/comparison-agent-access-audit-<date>.md),
//      and its row label appears in compare.ts and in every vendor table.
//   3. Every vendor key in the messaging manifest's comparison.agentRows
//      (except "obs") has a matching `<a id="src-<key>" />` anchor in
//      comparison.mdx, so the table's source links never 404.
//   4. The website manifest copy and docs agree on the vendor list.
//
// Plain Node ESM, zero dependencies. Exits 1 with ✗ lines on any failure.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(here, "..");
const repoRoot = resolve(websiteRoot, "..", "..");

const failures = [];
const fail = (m) => failures.push(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const read = (p) => readFileSync(p, "utf8");

const compareTs = read(join(websiteRoot, "src", "sections", "compare.ts"));
const comparisonMdx = read(join(repoRoot, "apps", "docs", "content", "docs", "comparison.mdx"));
const manifest = JSON.parse(read(join(websiteRoot, "public", "messaging.manifest.json")));

const agentRows = () => manifest?.authored?.positioning?.comparison?.agentRows ?? [];

const grab = (re, src, label) => {
	const m = re.exec(src);
	if (!m) fail(`could not find ${label}`);
	return m?.[1];
};

// 1. review date parity
const lastReviewed = grab(/LAST_REVIEWED\s*=\s*"(\d{4}-\d{2}-\d{2})"/, compareTs, "LAST_REVIEWED in compare.ts");
const mdxReviewed = grab(/title="Reviewed (\d{4}-\d{2}-\d{2})/, comparisonMdx, "Reviewed date in comparison.mdx Callout");
if (lastReviewed && mdxReviewed) {
	if (lastReviewed === mdxReviewed) ok(`review date ${lastReviewed} matches between compare.ts and comparison.mdx`);
	else fail(`review date drift: compare.ts=${lastReviewed} comparison.mdx=${mdxReviewed}`);
}

// 2. ledger existence + counts. The main ledger covers the cells reviewed on
// LAST_REVIEWED; a supplementary ledger covers a row added later with its own
// review date (constants prefixed AGENT_ACCESS_). Both are validated the same way.
const constant = (name) => {
	const m = new RegExp(`\\bconst ${name}\\s*=\\s*\\n?\\s*(?:"([^"]+)"|(\\d+))`).exec(compareTs);
	if (!m) {
		fail(`could not find ${name} in compare.ts`);
		return undefined;
	}
	return m[1] ?? Number(m[2]);
};

function checkLedger({ prefix, ledgerUrlName, reviewedName, label }) {
	const reviewed = constant(reviewedName);
	const ledgerUrl = constant(ledgerUrlName);
	if (!ledgerUrl || !reviewed) return;
	const before = failures.length;
	const ledgerName = ledgerUrl.split("/").pop();
	if (!ledgerName.includes(reviewed)) fail(`${label}: ledger ${ledgerName} does not carry ${reviewedName} ${reviewed}`);
	const ledgerPath = join(repoRoot, "docs", ledgerName);
	if (!existsSync(ledgerPath)) {
		fail(`${label}: ledger file missing: docs/${ledgerName}`);
		return;
	}
	ok(`${label}: ledger docs/${ledgerName} exists`);
	const ledger = read(ledgerPath);
	if (!comparisonMdx.includes(ledgerName)) fail(`${label}: comparison.mdx does not link to docs/${ledgerName}`);
	if (!comparisonMdx.includes(reviewed)) fail(`${label}: comparison.mdx does not mention review date ${reviewed}`);
	const sourceChecked = constant(`${prefix}SOURCE_CHECKED_CELLS`);
	const inferred = constant(`${prefix}INFERRED_CELLS`);
	const total = constant(`${prefix}TOTAL_CELLS`);
	const header = /`TRUE` \*\*(\d+)\*\* · `PARTIALLY_TRUE` \*\*(\d+)\*\* · `OUTDATED` \*\*(\d+)\*\* · `FALSE` \*\*(\d+)\*\* · `UNVERIFIABLE` \*\*(\d+)\*\* · Total \*\*(\d+)\*\*/.exec(ledger);
	if (!header) {
		fail(`${label}: ledger verdict-count header not found`);
	} else {
		const [, t, p, o, f, u, tot] = header.map(Number);
		if (tot !== total) fail(`${label}: ${prefix}TOTAL_CELLS ${total} != ledger total ${tot}`);
		if (t + p + o + f + u !== tot) fail(`${label}: ledger verdict counts do not sum to total (${t}+${p}+${o}+${f}+${u} != ${tot})`);
		if (u !== inferred) fail(`${label}: ${prefix}INFERRED_CELLS ${inferred} != ledger UNVERIFIABLE ${u}`);
		if (tot - u !== sourceChecked) fail(`${label}: ${prefix}SOURCE_CHECKED_CELLS ${sourceChecked} != ledger total - UNVERIFIABLE (${tot - u})`);
		if (failures.length === before) ok(`${label}: verdict counts agree: ${sourceChecked} source-checked, ${inferred} inferential, ${total} total`);
	}
	// Every ledger row is marked with exactly one rubric verdict.
	const start = ledger.indexOf("## 3.");
	const end = ledger.indexOf("## 4.", start);
	const section = start >= 0 && end > start ? ledger.slice(start, end) : "";
	if (!section) fail(`${label}: ledger is missing the '## 3.' per-cell section followed by '## 4.'`);
	const rows = section.split("\n").filter((l) => /^\| \d+ \| /.test(l));
	if (rows.length !== total) fail(`${label}: ledger has ${rows.length} numbered cell rows, expected ${total}`);
	else ok(`${label}: ledger has ${rows.length} numbered cell rows`);
	// Indices must be exactly 1..total: no duplicates, no gaps.
	const indices = rows.map((l) => Number(/^\| (\d+) \| /.exec(l)[1]));
	const seen = new Set();
	const dupes = [];
	for (const i of indices) {
		if (seen.has(i)) dupes.push(i);
		seen.add(i);
	}
	const missing = [];
	for (let i = 1; i <= total; i++) if (!seen.has(i)) missing.push(i);
	const outOfRange = indices.filter((i) => i < 1 || i > total);
	if (dupes.length) fail(`${label}: ledger has duplicate cell indices: ${dupes.join(", ")}`);
	if (missing.length) fail(`${label}: ledger is missing cell indices: ${missing.join(", ")}`);
	if (outOfRange.length) fail(`${label}: ledger has out-of-range cell indices: ${outOfRange.join(", ")}`);
	if (!dupes.length && !missing.length && !outOfRange.length) ok(`${label}: ledger cell indices are exactly 1..${total}`);
	// Every row carries exactly one rubric verdict.
	const badVerdict = rows.filter((l) => (l.match(/`(TRUE|PARTIALLY_TRUE|OUTDATED|FALSE|UNVERIFIABLE)`/g) ?? []).length !== 1);
	if (badVerdict.length) fail(`${label}: ${badVerdict.length} ledger rows do not carry exactly one rubric verdict`);
	else ok(`${label}: every ledger row carries exactly one rubric verdict`);
}

if (lastReviewed) checkLedger({ prefix: "", ledgerUrlName: "AUDIT_LEDGER_URL", reviewedName: "LAST_REVIEWED", label: "main" });
checkLedger({ prefix: "AGENT_ACCESS_", ledgerUrlName: "AGENT_ACCESS_LEDGER_URL", reviewedName: "AGENT_ACCESS_REVIEWED", label: "agent-access" });

// 2c. the supplementary row exists in both surfaces under the same label.
const agentAccessLabel = constant("AGENT_ACCESS_ROW_LABEL");
if (agentAccessLabel) {
	if (!/label:\s*AGENT_ACCESS_ROW_LABEL\b/.test(compareTs)) fail(`compare.ts ROWS has no row labelled AGENT_ACCESS_ROW_LABEL`);
	const mdxRows = comparisonMdx.split("\n").filter((l) => l.startsWith(`| ${agentAccessLabel} |`));
	const expected = agentRows().filter(({ key }) => key !== "obs").length;
	if (mdxRows.length !== expected) fail(`comparison.mdx has ${mdxRows.length} "${agentAccessLabel}" vendor rows, expected ${expected}`);
	else ok(`"${agentAccessLabel}" row present in compare.ts and in all ${expected} vendor tables in comparison.mdx`);
}

// 3. vendor anchors
if (agentRows().length === 0) fail("manifest authored.positioning.comparison.agentRows is empty");
for (const { key, name } of agentRows()) {
	if (key === "obs") continue;
	const anchor = `<a id="src-${key}" />`;
	if (comparisonMdx.includes(anchor)) ok(`anchor ${anchor} present for ${name}`);
	else fail(`comparison.mdx missing ${anchor} (linked from the website table header for ${name})`);
}

// 4. the "Not marketed" footnote must exist in both surfaces if any cell is inferential
if (/inferred:\s*true/.test(compareTs)) {
	if (!/†/.test(comparisonMdx)) fail("comparison.mdx has no † inferential-negative footnote");
	else ok("inferential-negative footnote present in comparison.mdx");
}

if (failures.length) {
	for (const f of failures) console.error(`✗ ${f}`);
	process.exit(1);
}
console.log("comparison surfaces in sync");
