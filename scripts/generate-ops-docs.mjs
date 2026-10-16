#!/usr/bin/env node

/**
 * Deterministic generator and drift/link validator for operational documentation.
 *
 * Canonical MDX sources in `apps/docs/content/docs/ops/*.mdx` generate the
 * repository-readable Markdown guides in `docs/ops/*.md`.
 *
 * Usage:
 *   node scripts/generate-ops-docs.mjs          # write generated Markdown files
 *   node scripts/generate-ops-docs.mjs --check  # verify generated files & links without writing
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");

export const GITHUB_REPO_BLOB_PREFIX =
	"https://github.com/dev-sawan-ruparel/obs-unified/blob/main/";
export const GITHUB_REPO_TREE_PREFIX =
	"https://github.com/dev-sawan-ruparel/obs-unified/tree/main/";
export const PUBLISHED_DOCS_ORIGIN = "https://docs.obsunified.com";

export const OPS_DOC_TARGETS = [
	{
		source: "apps/docs/content/docs/ops/production.mdx",
		destination: "docs/ops/production.md",
		docsRoute: "/docs/ops/production",
		shortSlug: "production",
	},
	{
		source: "apps/docs/content/docs/ops/identity-access.mdx",
		destination: "docs/ops/identity-access-recipes.md",
		docsRoute: "/docs/ops/identity-access",
		shortSlug: "identity-access",
	},
];

export const INCOMING_REPO_LINK_CHECKS = [
	"apps/collector-node/README.md",
	"docs/ops/docker-release.md",
	"docs/release.md",
	"docs/getting-started.md",
	"README.md",
];

const CALLOUT_TYPE_MAP = {
	info: "NOTE",
	note: "NOTE",
	warn: "WARNING",
	warning: "WARNING",
	error: "CAUTION",
	danger: "CAUTION",
	tip: "TIP",
	important: "IMPORTANT",
};

/**
 * Parse YAML frontmatter at the top of an MDX document.
 */
export function parseFrontmatter(content, sourcePath = "<mdx>") {
	const normalized = content.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		throw new Error(
			`${sourcePath}: Missing required YAML frontmatter opening delimiter (---)`,
		);
	}
	const closingIdx = normalized.indexOf("\n---\n", 4);
	if (closingIdx === -1) {
		throw new Error(
			`${sourcePath}: Missing required YAML frontmatter closing delimiter (---)`,
		);
	}

	const rawFrontmatter = normalized.slice(4, closingIdx);
	const frontmatter = {};
	for (const line of rawFrontmatter.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) {
			throw new Error(`${sourcePath}: Invalid frontmatter line "${line}"`);
		}
		const key = trimmed.slice(0, colonIdx).trim();
		let value = trimmed.slice(colonIdx + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		frontmatter[key] = value;
	}

	if (!frontmatter.title) {
		throw new Error(`${sourcePath}: Frontmatter is missing required "title"`);
	}

	const body = normalized.slice(closingIdx + 5).replace(/^\n+/, "");
	const bodyStartLine = normalized.slice(0, closingIdx + 5).split("\n").length;

	return { frontmatter, body, bodyStartLine };
}

/**
 * Compute GitHub-compatible heading slug (github-slugger rules).
 */
export function slugifyHeading(headingText) {
	return headingText
		.trim()
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/[*_~]/g, "")
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/ /g, "-");
}

/**
 * Extract all heading slugs from a Markdown or MDX document (ignoring code fences).
 */
export function extractHeadingSlugs(content) {
	const normalized = content.replace(/\r\n/g, "\n");
	const slugs = new Set();
	let body = normalized;

	const addHeadingSlugs = (text) => {
		const ghSlug = slugifyHeading(text);
		slugs.add(ghSlug);
		slugs.add(ghSlug.replace(/-+/g, "-"));
	};

	if (normalized.startsWith("---\n")) {
		const closingIdx = normalized.indexOf("\n---\n", 4);
		if (closingIdx !== -1) {
			const rawFrontmatter = normalized.slice(4, closingIdx);
			for (const line of rawFrontmatter.split("\n")) {
				const match = /^title:\s*(.+)$/.exec(line.trim());
				if (match) {
					const title = match[1].trim().replace(/^['"]|['"]$/g, "");
					addHeadingSlugs(title);
				}
			}
			body = normalized.slice(closingIdx + 5);
		}
	}

	let activeFence = null;
	for (const line of body.split("\n")) {
		const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[2];
			if (!activeFence) {
				activeFence = marker[0].repeat(marker.length);
			} else if (
				marker[0] === activeFence[0] &&
				marker.length >= activeFence.length &&
				line.trim() === marker
			) {
				activeFence = null;
			}
			continue;
		}
		if (activeFence) continue;

		const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (headingMatch) {
			addHeadingSlugs(headingMatch[2]);
		}
	}

	return slugs;
}

/**
 * Split a single line into alternating [nonCode, inlineCode, nonCode, ...] segments.
 */
function splitInlineCodeSegments(line) {
	const segments = [];
	let current = 0;
	const regex = /(`+)(?:[\s\S]*?)\1/g;
	for (let match = regex.exec(line); match !== null; match = regex.exec(line)) {
		if (match.index > current) {
			segments.push({
				isCode: false,
				text: line.slice(current, match.index),
			});
		}
		segments.push({
			isCode: true,
			text: match[0],
		});
		current = match.index + match[0].length;
	}
	if (current < line.length) {
		segments.push({
			isCode: false,
			text: line.slice(current),
		});
	}
	return segments;
}

/**
 * Rewrite an individual link target from canonical MDX to destination Markdown in docs/ops/.
 */
export function rewriteOpsLink(
	href,
	{
		destinationRelPath = "docs/ops/production.md",
		targets = OPS_DOC_TARGETS,
		repoRoot = DEFAULT_REPO_ROOT,
	} = {},
) {
	const hashIdx = href.indexOf("#");
	const rawPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
	const anchor = hashIdx === -1 ? "" : href.slice(hashIdx);

	if (!rawPath) {
		return href;
	}

	const destDir = path.posix.dirname(
		destinationRelPath.split(path.sep).join(path.posix.sep),
	);

	// 1. Check if link points to one of the mapped ops docs
	for (const target of targets) {
		const matchesShortRelative =
			rawPath === `./${target.shortSlug}` ||
			rawPath === `${target.shortSlug}` ||
			rawPath === `./${target.shortSlug}.mdx` ||
			rawPath === `${target.shortSlug}.mdx`;
		const matchesDocsRoute =
			rawPath === target.docsRoute ||
			rawPath === `${target.docsRoute}/` ||
			rawPath === `${PUBLISHED_DOCS_ORIGIN}${target.docsRoute}`;

		if (matchesShortRelative || matchesDocsRoute) {
			const relToTarget = path.posix.relative(destDir, target.destination);
			const formattedRel = relToTarget.startsWith(".")
				? relToTarget
				: `./${relToTarget}`;
			return `${formattedRel}${anchor}`;
		}
	}

	// 2. Check if link is an internal /docs/... route to another docs page
	if (rawPath.startsWith("/docs/")) {
		return `${PUBLISHED_DOCS_ORIGIN}${rawPath}${anchor}`;
	}

	// 3. Check if link is a GitHub main-branch file or tree URL in this repo
	for (const prefix of [GITHUB_REPO_BLOB_PREFIX, GITHUB_REPO_TREE_PREFIX]) {
		if (rawPath.startsWith(prefix)) {
			const repoRelTarget = rawPath.slice(prefix.length).replace(/\/+$/, "");
			if (!repoRelTarget) break;
			const absTarget = path.join(repoRoot, repoRelTarget);
			const isDir =
				rawPath.startsWith(GITHUB_REPO_TREE_PREFIX) ||
				(existsSync(absTarget) && statSync(absTarget).isDirectory());
			const relPath = path.posix.relative(destDir, repoRelTarget);
			const formattedRel = relPath.startsWith(".") ? relPath : `./${relPath}`;
			const trailingSlash = isDir && !formattedRel.endsWith("/") ? "/" : "";
			return `${formattedRel}${trailingSlash}${anchor}`;
		}
	}

	return href;
}

/**
 * Transform supported MDX <Callout> blocks outside code fences into GitHub alerts.
 */
function transformCalloutsOutsideFences(body, sourcePath, bodyStartLine) {
	const lines = body.split("\n");
	const out = [];
	let activeFence = null;
	let inCallout = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = bodyStartLine + i;

		const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[2];
			if (!activeFence) {
				activeFence = marker[0].repeat(marker.length);
			} else if (
				marker[0] === activeFence[0] &&
				marker.length >= activeFence.length &&
				line.trim() === marker
			) {
				activeFence = null;
			}
			if (inCallout) {
				out.push(`> ${line}`);
			} else {
				out.push(line);
			}
			continue;
		}

		if (activeFence) {
			out.push(line);
			continue;
		}

		// Strip supported Fumadocs Callout import
		if (
			/^\s*import\s+\{\s*Callout\s*\}\s+from\s+['"]fumadocs-ui\/components\/callout['"];?\s*$/.test(
				line,
			)
		) {
			continue;
		}

		if (!inCallout) {
			const openMatch = /^\s*<Callout(\s+[^>]*)?>\s*$/.exec(line);
			if (openMatch) {
				const attrs = openMatch[1] || "";
				const typeMatch = /\btype=["']([^"']+)["']/.exec(attrs);
				const titleMatch = /\btitle=["']([^"']+)["']/.exec(attrs);
				const rawType = typeMatch ? typeMatch[1].toLowerCase() : "info";
				const alertKind = CALLOUT_TYPE_MAP[rawType];
				if (!alertKind) {
					throw new Error(
						`${sourcePath}:${lineNo}: Unsupported <Callout> type "${rawType}"`,
					);
				}
				inCallout = { alertKind, title: titleMatch ? titleMatch[1] : null };
				out.push(`> [!${alertKind}]`);
				if (inCallout.title) {
					out.push(`> **${inCallout.title}**`);
				}
				continue;
			}
		} else {
			if (/^\s*<\/Callout>\s*$/.test(line)) {
				inCallout = null;
				continue;
			}
			out.push(line.trim() === "" ? ">" : `> ${line}`);
			continue;
		}

		out.push(line);
	}

	if (inCallout) {
		throw new Error(`${sourcePath}: Unclosed <Callout> block at end of file`);
	}

	return out.join("\n");
}

/**
 * Compile canonical operational MDX into repository Markdown.
 */
export function compileOpsMdxToMarkdown(
	mdxContent,
	{
		sourceRelPath = "apps/docs/content/docs/ops/production.mdx",
		destinationRelPath = "docs/ops/production.md",
		targets = OPS_DOC_TARGETS,
		repoRoot = DEFAULT_REPO_ROOT,
	} = {},
) {
	const { frontmatter, body, bodyStartLine } = parseFrontmatter(
		mdxContent,
		sourceRelPath,
	);

	const afterCallouts = transformCalloutsOutsideFences(
		body,
		sourceRelPath,
		bodyStartLine,
	);

	const lines = afterCallouts.split("\n");
	const transformedLines = [];
	let activeFence = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = bodyStartLine + i;

		const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[2];
			if (!activeFence) {
				activeFence = marker[0].repeat(marker.length);
			} else if (
				marker[0] === activeFence[0] &&
				marker.length >= activeFence.length &&
				line.trim() === marker
			) {
				activeFence = null;
			}
			transformedLines.push(line);
			continue;
		}

		if (activeFence) {
			transformedLines.push(line);
			continue;
		}

		// Reject top-level MDX import/export statements outside code fences
		if (/^\s*(import|export)\s+/.test(line)) {
			throw new Error(
				`${sourceRelPath}:${lineNo}: Unsupported MDX ${RegExp.$1} statement outside code fence: "${line.trim()}"`,
			);
		}

		const segments = splitInlineCodeSegments(line);
		const sanitizedSegments = segments.map((seg) => {
			if (seg.isCode) return seg.text;

			// Strip inline MDX comments {/* ... */}
			const withoutComments = seg.text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

			// Reject any JSX/HTML component tags outside code spans (allow <https://...> autolinks)
			const jsxTagRegex = /<\/?([A-Za-z][A-Za-z0-9._-]*)(\s[^>]*)?\/?>/g;
			for (
				let match = jsxTagRegex.exec(withoutComments);
				match !== null;
				match = jsxTagRegex.exec(withoutComments)
			) {
				const fullMatch = match[0];
				if (/^<https?:\/\/[^>\s]+>$/i.test(fullMatch)) {
					continue;
				}
				throw new Error(
					`${sourceRelPath}:${lineNo}: Unsupported MDX/JSX tag "${fullMatch}" outside code fence`,
				);
			}

			return withoutComments;
		});

		// Rewrite Markdown links [text](href), preserving inline code spans that wrap a whole link
		const sanitizedLine = sanitizedSegments.join("");
		const rewrittenLine = sanitizedLine.replace(
			/((`+)[\s\S]*?\2)|(\[(?:`[^`]*`|[^\]])+\]\()([^)\s]+)(\))/g,
			(_full, codeSpan, _ticks, prefix, href, suffix) => {
				if (codeSpan) return codeSpan;
				const rewritten = rewriteOpsLink(href, {
					destinationRelPath,
					targets,
					repoRoot,
				});
				return `${prefix}${rewritten}${suffix}`;
			},
		);

		transformedLines.push(rewrittenLine);
	}

	const headerNotice = `<!-- GENERATED FROM ${sourceRelPath} — DO NOT EDIT DIRECTLY. Run: node scripts/generate-ops-docs.mjs -->`;
	const compiledBody = transformedLines.join("\n").trim();

	return `${headerNotice}\n\n# ${frontmatter.title}\n\n${compiledBody}\n`;
}

/**
 * Extract Markdown links [label](href) outside fenced code blocks and inline code.
 */
export function extractMarkdownLinks(content) {
	const normalized = content.replace(/\r\n/g, "\n");
	let body = normalized;
	let startLineOffset = 1;

	if (normalized.startsWith("---\n")) {
		const closingIdx = normalized.indexOf("\n---\n", 4);
		if (closingIdx !== -1) {
			startLineOffset = normalized.slice(0, closingIdx + 5).split("\n").length;
			body = normalized.slice(closingIdx + 5);
		}
	}

	const links = [];
	let activeFence = null;
	const lines = body.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineNo = startLineOffset + i;

		const fenceMatch = /^(\s*)(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[2];
			if (!activeFence) {
				activeFence = marker[0].repeat(marker.length);
			} else if (
				marker[0] === activeFence[0] &&
				marker.length >= activeFence.length &&
				line.trim() === marker
			) {
				activeFence = null;
			}
			continue;
		}
		if (activeFence) continue;

		const tokenRe = /((`+)[\s\S]*?\2)|\[((?:`[^`]*`|[^\]])+)\]\(([^)\s]+)\)/g;
		for (
			let match = tokenRe.exec(line);
			match !== null;
			match = tokenRe.exec(line)
		) {
			if (match[1]) continue;
			links.push({
				label: match[3],
				href: match[4],
				line: lineNo,
			});
		}
	}

	return links;
}

/**
 * Validate all links and #anchors in an MDX or Markdown document.
 */
export function validateOpsDocLinks(
	content,
	fileRelPath,
	{ repoRoot = DEFAULT_REPO_ROOT, virtualFileMap = new Map() } = {},
) {
	const errors = [];
	const fileAbsPath = path.join(repoRoot, fileRelPath);
	const fileDir = path.dirname(fileAbsPath);
	const isMdxInDocsTree = fileRelPath.startsWith("apps/docs/content/docs/");

	const readDocContent = (absPath) => {
		const rel = path
			.relative(repoRoot, absPath)
			.split(path.sep)
			.join(path.posix.sep);
		if (virtualFileMap.has(rel)) {
			return virtualFileMap.get(rel);
		}
		return readFileSync(absPath, "utf-8");
	};

	const targetExists = (absPath) => {
		const rel = path
			.relative(repoRoot, absPath)
			.split(path.sep)
			.join(path.posix.sep);
		return virtualFileMap.has(rel) || existsSync(absPath);
	};

	const ownSlugs = extractHeadingSlugs(content);
	const links = extractMarkdownLinks(content);

	for (const { href, line } of links) {
		if (href.startsWith("mailto:")) continue;

		// 1. Same-document anchor link
		if (href.startsWith("#")) {
			const slug = href.slice(1);
			if (!ownSlugs.has(slug)) {
				errors.push(
					`${fileRelPath}:${line}: Broken same-file anchor "${href}"`,
				);
			}
			continue;
		}

		const hashIdx = href.indexOf("#");
		const rawPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
		const anchorSlug = hashIdx === -1 ? null : href.slice(hashIdx + 1);

		let resolvedTargetAbs = null;

		// 2. External HTTP(S) URLs
		if (/^https?:\/\//i.test(rawPath)) {
			// Validate GitHub links to this repository against the working tree
			let repoSubpath = null;
			if (rawPath.startsWith(GITHUB_REPO_BLOB_PREFIX)) {
				repoSubpath = rawPath.slice(GITHUB_REPO_BLOB_PREFIX.length);
			} else if (rawPath.startsWith(GITHUB_REPO_TREE_PREFIX)) {
				repoSubpath = rawPath.slice(GITHUB_REPO_TREE_PREFIX.length);
			}

			if (repoSubpath !== null) {
				resolvedTargetAbs = path.join(repoRoot, repoSubpath);
				if (!targetExists(resolvedTargetAbs)) {
					errors.push(
						`${fileRelPath}:${line}: Broken repository GitHub link "${href}" (missing ${repoSubpath})`,
					);
					continue;
				}
			} else if (rawPath.startsWith(`${PUBLISHED_DOCS_ORIGIN}/docs/`)) {
				const docsSlug = rawPath
					.slice(`${PUBLISHED_DOCS_ORIGIN}/docs/`.length)
					.replace(/\/+$/, "");
				const candidateMdx = path.join(
					repoRoot,
					"apps/docs/content/docs",
					`${docsSlug || "index"}.mdx`,
				);
				if (!targetExists(candidateMdx)) {
					errors.push(
						`${fileRelPath}:${line}: Broken published docs link "${href}" (missing ${path.relative(repoRoot, candidateMdx)})`,
					);
					continue;
				}
				resolvedTargetAbs = candidateMdx;
			} else {
				continue;
			}
		} else if (rawPath.startsWith("/docs/")) {
			// 3. Root-relative /docs/... links
			const docsSlug = rawPath.slice("/docs/".length).replace(/\/+$/, "");
			const candidateMdx = path.join(
				repoRoot,
				"apps/docs/content/docs",
				`${docsSlug || "index"}.mdx`,
			);
			if (!targetExists(candidateMdx)) {
				errors.push(
					`${fileRelPath}:${line}: Broken docs route link "${href}" (missing ${path.relative(repoRoot, candidateMdx)})`,
				);
				continue;
			}
			resolvedTargetAbs = candidateMdx;
		} else {
			// 4. Relative file/page links
			const candidateAbs = path.resolve(fileDir, rawPath);
			if (targetExists(candidateAbs)) {
				resolvedTargetAbs = candidateAbs;
			} else if (isMdxInDocsTree && targetExists(`${candidateAbs}.mdx`)) {
				resolvedTargetAbs = `${candidateAbs}.mdx`;
			} else {
				errors.push(`${fileRelPath}:${line}: Broken relative link "${href}"`);
				continue;
			}
		}

		// Validate #anchor on resolved Markdown/MDX target
		if (
			anchorSlug &&
			resolvedTargetAbs &&
			/\.(md|mdx)$/i.test(resolvedTargetAbs)
		) {
			const targetContent = readDocContent(resolvedTargetAbs);
			const targetSlugs = extractHeadingSlugs(targetContent);
			if (!targetSlugs.has(anchorSlug)) {
				errors.push(
					`${fileRelPath}:${line}: Broken section anchor "#${anchorSlug}" in link "${href}" (target: ${path.relative(repoRoot, resolvedTargetAbs)})`,
				);
			}
		}
	}

	return errors;
}

/**
 * Generate (or check) all operational Markdown docs and validate links/anchors.
 */
export function generateOpsDocs({
	repoRoot = DEFAULT_REPO_ROOT,
	checkOnly = false,
	targets = OPS_DOC_TARGETS,
	validateIncomingRepoLinks = true,
} = {}) {
	const results = [];
	const errors = [];
	const virtualFileMap = new Map();

	for (const target of targets) {
		const sourceAbs = path.join(repoRoot, target.source);
		const destAbs = path.join(repoRoot, target.destination);

		if (!existsSync(sourceAbs)) {
			errors.push(`Missing canonical MDX source: ${target.source}`);
			continue;
		}

		const sourceContent = readFileSync(sourceAbs, "utf-8");
		let generatedMarkdown;
		try {
			generatedMarkdown = compileOpsMdxToMarkdown(sourceContent, {
				sourceRelPath: target.source,
				destinationRelPath: target.destination,
				targets,
				repoRoot,
			});
		} catch (err) {
			errors.push(err instanceof Error ? err.message : String(err));
			continue;
		}

		virtualFileMap.set(target.source, sourceContent);
		virtualFileMap.set(target.destination, generatedMarkdown);

		const existingDest = existsSync(destAbs)
			? readFileSync(destAbs, "utf-8")
			: null;
		const inSync = existingDest === generatedMarkdown;

		if (checkOnly) {
			if (existingDest === null) {
				errors.push(
					`Generated file is missing: ${target.destination} (run: node scripts/generate-ops-docs.mjs)`,
				);
			} else if (!inSync) {
				errors.push(
					`Generated file is out of sync with ${target.source}: ${target.destination} (run: node scripts/generate-ops-docs.mjs)`,
				);
			}
		} else if (!inSync) {
			writeFileSync(destAbs, generatedMarkdown, "utf-8");
		}

		results.push({
			source: target.source,
			destination: target.destination,
			inSync,
			updated: !checkOnly && !inSync,
			generatedMarkdown,
		});
	}

	// Validate links and anchors in both canonical MDX and generated Markdown
	for (const target of targets) {
		if (virtualFileMap.has(target.source)) {
			errors.push(
				...validateOpsDocLinks(
					virtualFileMap.get(target.source),
					target.source,
					{
						repoRoot,
						virtualFileMap,
					},
				),
			);
		}
		if (virtualFileMap.has(target.destination)) {
			errors.push(
				...validateOpsDocLinks(
					virtualFileMap.get(target.destination),
					target.destination,
					{
						repoRoot,
						virtualFileMap,
					},
				),
			);
		}
	}

	// Validate incoming repo links to docs/ops/*.md
	if (validateIncomingRepoLinks) {
		for (const incomingRelPath of INCOMING_REPO_LINK_CHECKS) {
			const incomingAbsPath = path.join(repoRoot, incomingRelPath);
			if (!existsSync(incomingAbsPath)) continue;
			const content = readFileSync(incomingAbsPath, "utf-8");
			const links = extractMarkdownLinks(content).filter(
				({ href }) =>
					href.includes("production.md") ||
					href.includes("identity-access-recipes.md"),
			);
			for (const { href, line } of links) {
				const hashIdx = href.indexOf("#");
				const rawPath = hashIdx === -1 ? href : href.slice(0, hashIdx);
				const anchorSlug = hashIdx === -1 ? null : href.slice(hashIdx + 1);
				const resolvedTargetAbs = path.resolve(
					path.dirname(incomingAbsPath),
					rawPath,
				);
				const resolvedRel = path
					.relative(repoRoot, resolvedTargetAbs)
					.split(path.sep)
					.join(path.posix.sep);

				const targetContent = virtualFileMap.has(resolvedRel)
					? virtualFileMap.get(resolvedRel)
					: existsSync(resolvedTargetAbs)
						? readFileSync(resolvedTargetAbs, "utf-8")
						: null;

				if (targetContent === null) {
					errors.push(
						`${incomingRelPath}:${line}: Broken incoming link "${href}"`,
					);
					continue;
				}
				if (anchorSlug) {
					const slugs = extractHeadingSlugs(targetContent);
					if (!slugs.has(anchorSlug)) {
						errors.push(
							`${incomingRelPath}:${line}: Broken incoming section anchor "#${anchorSlug}" in link "${href}" (target: ${resolvedRel})`,
						);
					}
				}
			}
		}
	}

	return { results, errors };
}

function runCli() {
	const args = process.argv.slice(2);
	const checkOnly = args.includes("--check");

	const { results, errors } = generateOpsDocs({
		repoRoot: DEFAULT_REPO_ROOT,
		checkOnly,
	});

	if (errors.length > 0) {
		for (const err of errors) {
			console.error(`✗ ${err}`);
		}
		process.exit(1);
	}

	for (const r of results) {
		if (checkOnly) {
			console.log(`✓ ${r.destination} is in sync with ${r.source}`);
		} else if (r.updated) {
			console.log(`✓ Generated ${r.destination} from ${r.source}`);
		} else {
			console.log(`✓ ${r.destination} is already up to date`);
		}
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	runCli();
}
