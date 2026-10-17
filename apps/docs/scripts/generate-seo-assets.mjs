#!/usr/bin/env node
/**
 * Deterministically generates:
 * 1. Per-page 1200x630 OpenGraph SVG + 4:4:4 JPEG cards under `public/og/docs/**`
 *    using the exact `title` and `description` from each MDX page's frontmatter.
 * 2. Complete `public/sitemap.xml` covering `/`, all `/docs/**` pages (with
 *    `<image:image>` entries), `/llms.txt`, and `/llms-full.txt`.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsAppRoot = resolve(here, "..");
const contentRoot = join(docsAppRoot, "content", "docs");
const publicRoot = join(docsAppRoot, "public");
const ogDocsRoot = join(publicRoot, "og", "docs");
const brandPkgJson = resolve(docsAppRoot, "..", "..", "packages", "brand", "package.json");

const requireFromBrand = createRequire(brandPkgJson);
const sharp = requireFromBrand("sharp");

const SITE_ORIGIN = "https://docs.obsunified.com";
// Last commit date (YYYY-MM-DD) touching a path, or null when git history is
// unavailable or the file is uncommitted. Sitemap entries omit <lastmod> then.
function gitLastModified(path) {
	try {
		const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", path], {
			cwd: docsAppRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
	} catch {
		return null;
	}
}

function lastmodTag(date) {
	return date ? `\n    <lastmod>${date}</lastmod>` : "";
}

function escapeXml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function parseFrontmatter(raw) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
	if (!match) return { title: "Documentation", description: "" };
	const block = match[1];
	const out = { title: "Documentation", description: "" };
	for (const line of block.split(/\r?\n/)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		const val = line
			.slice(idx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (key === "title" || key === "description") {
			out[key] = val;
		}
	}
	return out;
}

function wrapLines(text, maxChars, maxLines) {
	const words = String(text).trim().split(/\s+/).filter(Boolean);
	const lines = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (candidate.length <= maxChars || !current) {
			current = candidate;
		} else {
			lines.push(current);
			current = word;
			if (lines.length === maxLines - 1) break;
		}
	}
	const consumedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
	const remainingWords = words.slice(consumedWords);
	if (remainingWords.length > 0) {
		let lastLine = remainingWords.join(" ");
		if (lastLine.length > maxChars) {
			lastLine = `${lastLine.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
		}
		lines.push(lastLine);
	}
	return lines.slice(0, maxLines);
}

async function walkMdx(dir, prefix = "") {
	const entries = await readdir(dir, { withFileTypes: true });
	const results = [];
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...(await walkMdx(full, rel)));
		} else if (entry.isFile() && entry.name.endsWith(".mdx")) {
			results.push({ rel, full });
		}
	}
	return results;
}

function renderDocOgSvg({ title, description, routePath, sectionLabel }) {
	const titleLines = wrapLines(title, 24, 2);
	const descLines = wrapLines(description, 54, 4);
	const titleFontSize = titleLines.length === 1 && title.length <= 18 ? 60 : 50;
	const titleLineHeight = titleFontSize === 60 ? 66 : 56;
	const titleStartY = titleLines.length === 1 ? 260 : 230;
	const descStartY = titleStartY + titleLines.length * titleLineHeight + 22;

	const titleSvg = titleLines
		.map(
			(line, idx) =>
				`<text x="72" y="${titleStartY + idx * titleLineHeight}" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${titleFontSize}" font-weight="800" fill="#1A1C1C" letter-spacing="-1.6">${escapeXml(line)}</text>`,
		)
		.join("\n  ");

	const descSvg = descLines
		.map(
			(line, idx) =>
				`<text x="72" y="${descStartY + idx * 32}" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="22" font-weight="400" fill="#3E493B">${escapeXml(line)}</text>`,
		)
		.join("\n  ");

	// ~9px per 13px mono glyph incl. letter-spacing, plus 16px padding each side.
	const badgeWidth = Math.ceil(sectionLabel.length * 9.2 + 32);
	const displayRoute = `${SITE_ORIGIN.replace("https://", "")}${routePath}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="${escapeXml(`${title} — obs-unified documentation`)}">
  <defs>
    <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#E2E4E4" stroke-width="1"/>
    </pattern>
    <linearGradient id="surfaceFade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#F9F9F9" stop-opacity="0.97"/>
      <stop offset="58%" stop-color="#F9F9F9" stop-opacity="0.93"/>
      <stop offset="100%" stop-color="#F9F9F9" stop-opacity="0.45"/>
    </linearGradient>
    <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#006B18"/>
      <stop offset="65%" stop-color="#1E8E3E"/>
      <stop offset="100%" stop-color="#E2E4E4"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="#F9F9F9"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#surfaceFade)"/>

  <!-- Top monolith rule -->
  <rect x="0" y="0" width="1200" height="6" fill="url(#accentBar)"/>

  <!-- Right-hand documentation & MCP reference schematic -->
  <g transform="translate(760, 72)">
    <rect x="0" y="0" width="380" height="466" fill="#F3F3F3" stroke="#BECABC" stroke-width="1.5"/>
    <rect x="0" y="0" width="380" height="34" fill="#E8EBEB" stroke="#BECABC" stroke-width="1"/>
    <rect x="14" y="11" width="10" height="10" fill="#006B18"/>
    <text x="34" y="21" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="700" fill="#1A1C1C" letter-spacing="1.2">REFERENCE · SDK · MCP · OPS</text>
    <text x="366" y="21" text-anchor="end" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="10" font-weight="600" fill="#006B18">LLMS.TXT</text>

    <!-- Stack layer 1: SDK & OTLP Ingest -->
    <rect x="20" y="52" width="340" height="84" fill="#FFFFFF" stroke="#BECABC" stroke-width="1"/>
    <rect x="20" y="52" width="4" height="84" fill="#006B18"/>
    <text x="36" y="74" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="700" fill="#006B18" letter-spacing="0.8">01 · INSTRUMENT &amp; INGEST</text>
    <text x="36" y="96" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="600" fill="#1A1C1C">TypeScript · Python · Go · Rust · Browser</text>
    <text x="36" y="118" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="500" fill="#3E493B">x-obs-interaction → OTLP HTTP/JSON</text>

    <!-- Connector 1 -> 2 -->
    <line x1="190" y1="136" x2="190" y2="156" stroke="#006B18" stroke-width="1.5"/>

    <!-- Stack layer 2: Evidence & CCR -->
    <rect x="20" y="156" width="340" height="92" fill="#FFFFFF" stroke="#006B18" stroke-width="1.5"/>
    <rect x="20" y="156" width="4" height="92" fill="#006B18"/>
    <text x="36" y="178" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="700" fill="#006B18" letter-spacing="0.8">02 · EVIDENCE GRAPH &amp; CCR</text>
    <text x="36" y="200" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="600" fill="#1A1C1C">Traces · Logs · Replay · AI Cost · CPU</text>
    <text x="36" y="220" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="500" fill="#3E493B">get_evidence_bundle · connected_signals</text>
    <rect x="256" y="164" width="92" height="20" fill="#E8F5E9" stroke="#006B18" stroke-width="1"/>
    <text x="302" y="178" text-anchor="middle" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="10" font-weight="700" fill="#006B18">26 MCP TOOLS</text>

    <!-- Connector 2 -> 3 -->
    <line x1="190" y1="248" x2="190" y2="268" stroke="#006B18" stroke-width="1.5"/>

    <!-- Stack layer 3: AutoSRE & Action Graph -->
    <rect x="20" y="268" width="340" height="84" fill="#FFFFFF" stroke="#BECABC" stroke-width="1"/>
    <rect x="20" y="268" width="4" height="84" fill="#1E8E3E"/>
    <text x="36" y="290" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="700" fill="#006B18" letter-spacing="0.8">03 · AUTOSRE &amp; ACTION GRAPH</text>
    <text x="36" y="312" font-family="'Inter', -apple-system, sans-serif" font-size="13" font-weight="600" fill="#1A1C1C">Blast Radius · Counterfactual Proof</text>
    <text x="36" y="334" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="500" fill="#3E493B">chg_* → fnd_* → inc_* → rem_*</text>

    <!-- Stack layer 4: Self-Host & Deploy -->
    <rect x="20" y="370" width="340" height="76" fill="#1A1C1C"/>
    <text x="36" y="394" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="11" font-weight="700" fill="#78DC77" letter-spacing="0.8">04 · SELF-HOST</text>
    <text x="36" y="418" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="12" font-weight="500" fill="#F9F9F9">Docker · Cloudflare D1/R2 · Postgres</text>
    <text x="36" y="436" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="10" font-weight="500" fill="#BECABC">MIT licensed</text>
  </g>

  <!-- Brand Lockup + Section Badge -->
  <g transform="translate(72, 72)">
    <!-- Canonical brand mark (packages/brand/logo/mark.svg) -->
    <g transform="translate(0, 5) scale(1.5)">
      <rect width="32" height="32" fill="#006B18"/>
      <path d="M7 9 L10 14 L7 19" fill="none" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="bevel" stroke-linecap="square"/>
      <rect x="14" y="12.9" width="12" height="2.2" fill="#FFFFFF"/>
      <rect x="14" y="18.9" width="8" height="2.2" fill="#FFFFFF"/>
    </g>
    <text x="64" y="42" font-family="'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="28" font-weight="700" fill="#1A1C1C" letter-spacing="-0.6">obs-unified</text>
    <rect x="244" y="16" width="${badgeWidth}" height="34" fill="#E8F5E9" stroke="#006B18" stroke-width="1"/>
    <text x="260" y="38" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="13" font-weight="700" fill="#006B18" letter-spacing="1.2">${escapeXml(sectionLabel)}</text>
  </g>

  <!-- Page Title -->
  ${titleSvg}

  <!-- Page Description -->
  ${descSvg}

  <!-- Bottom Monolith Metadata Bar -->
  <line x1="72" y1="538" x2="1140" y2="538" stroke="#BECABC" stroke-width="1.5"/>
  <rect x="72" y="562" width="12" height="12" fill="#006B18"/>
  <text x="96" y="573" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="15" font-weight="700" fill="#1A1C1C" letter-spacing="0.4">${escapeXml(displayRoute)}</text>
  <text x="1140" y="573" text-anchor="end" font-family="'JetBrains Mono', 'SFMono-Regular', Menlo, monospace" font-size="13" font-weight="600" fill="#3E493B" letter-spacing="1">LLMS.TXT · LLMS-FULL.TXT · MIT</text>
</svg>
`;
}

function getPriorityForSlug(slug) {
	if (slug === "index") return "1.0";
	if (slug === "getting-started" || slug === "installation") return "0.95";
	if (
		slug === "autosre" ||
		slug === "evidence-retrieval" ||
		slug === "agent-action-graph" ||
		slug === "mcp-server" ||
		slug === "sdks"
	) {
		return "0.9";
	}
	if (
		slug === "evidence-reference" ||
		slug === "sdk-reference" ||
		slug === "examples" ||
		slug === "instrumenting" ||
		slug === "comparison"
	) {
		return "0.85";
	}
	return "0.8";
}

const mdxFiles = await walkMdx(contentRoot);
mdxFiles.sort((a, b) => a.rel.localeCompare(b.rel));

const pages = [];
for (const file of mdxFiles) {
	const raw = await readFile(file.full, "utf8");
	const { title, description } = parseFrontmatter(raw);
	const slug = file.rel.replace(/\.mdx$/, "");
	const routePath = slug === "index" ? "/docs" : `/docs/${slug}`;
	const ogRelPath = `/og/docs/${slug}.jpg`;
	const ogSvgRelPath = `/og/docs/${slug}.svg`;
	const sectionLabel =
		slug === "index"
			? "DOCS · OVERVIEW"
			: slug.startsWith("ops/")
				? `DOCS · OPS · ${slug.replace("ops/", "").toUpperCase()}`
				: `DOCS · ${slug.toUpperCase()}`;

	const svg = renderDocOgSvg({
		title,
		description,
		routePath,
		sectionLabel,
	});

	const jpgOut = join(ogDocsRoot, `${slug}.jpg`);
	const svgOut = join(ogDocsRoot, `${slug}.svg`);
	await mkdir(dirname(jpgOut), { recursive: true });
	await writeFile(svgOut, svg, "utf8");

	const jpgBuf = await sharp(Buffer.from(svg), { density: 384 })
		.resize(1200, 630, { fit: "cover" })
		.flatten({ background: "#F9F9F9" })
		.jpeg({ quality: 92, progressive: true, chromaSubsampling: "4:4:4", mozjpeg: true })
		.toBuffer();
	await writeFile(jpgOut, jpgBuf);

	pages.push({
		slug,
		routePath,
		// Trailing slash: Cloudflare Pages 308-redirects /docs/x to /docs/x/.
		url: `${SITE_ORIGIN}${routePath}/`,
		lastmod: gitLastModified(file.full),
		ogUrl: `${SITE_ORIGIN}${ogRelPath}`,
		ogSvgRelPath,
		title,
		description,
		priority: getPriorityForSlug(slug),
	});
}

// Sort pages so `/docs` is first, followed by priority/alphabetical
pages.sort((a, b) => {
	if (a.slug === "index") return -1;
	if (b.slug === "index") return 1;
	const pDiff = Number(b.priority) - Number(a.priority);
	if (pDiff !== 0) return pDiff;
	return a.routePath.localeCompare(b.routePath);
});

const siteLastmod =
	pages
		.map((page) => page.lastmod)
		.filter(Boolean)
		.sort()
		.at(-1) ?? null;

const sitemapUrls = [
	`  <url>
    <loc>${SITE_ORIGIN}/</loc>${lastmodTag(siteLastmod)}
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
    <image:image>
      <image:loc>${SITE_ORIGIN}/og.jpg</image:loc>
      <image:title>obs-unified documentation</image:title>
      <image:caption>Install, instrument, and read the unified observability stack for humans and AI agents.</image:caption>
    </image:image>
  </url>`,
	...pages.map(
		(page) => `  <url>
    <loc>${escapeXml(page.url)}</loc>${lastmodTag(page.lastmod)}
    <changefreq>weekly</changefreq>
    <priority>${page.priority}</priority>
    <image:image>
      <image:loc>${escapeXml(page.ogUrl)}</image:loc>
      <image:title>${escapeXml(`${page.title} — obs-unified docs`)}</image:title>
      <image:caption>${escapeXml(page.description)}</image:caption>
    </image:image>
  </url>`,
	),
	`  <url>
    <loc>${SITE_ORIGIN}/llms.txt</loc>${lastmodTag(siteLastmod)}
    <changefreq>weekly</changefreq>
    <priority>0.85</priority>
  </url>`,
	`  <url>
    <loc>${SITE_ORIGIN}/llms-full.txt</loc>${lastmodTag(siteLastmod)}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`,
];

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
>
${sitemapUrls.join("\n")}
</urlset>
`;

await writeFile(join(publicRoot, "sitemap.xml"), sitemapXml, "utf8");
console.log(
	`✓ Generated ${pages.length} per-page OG images in public/og/docs/** and updated public/sitemap.xml (${pages.length + 3} URLs)`,
);
