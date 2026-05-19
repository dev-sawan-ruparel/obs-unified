#!/usr/bin/env node
/*
 * Guard against drift between tokens/tokens.css (vanilla :root) and
 * tokens/theme.css (Tailwind @theme).
 *
 * The two files declare the same palette in two syntaxes — if someone
 * edits one without the other, vanilla and Tailwind consumers fall out
 * of sync. This script normalizes both files into {name → value} maps
 * and asserts every shared key matches.
 *
 * Run: node scripts/verify-tokens.mjs (or `pnpm test` in this package)
 * Exits non-zero on mismatch.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const TOKENS = resolve(ROOT, "tokens/tokens.css");
const THEME = resolve(ROOT, "tokens/theme.css");

/*
 * Token keys that are intentional only in tokens.css — brand-mark
 * typography metadata and the radius constant. They don't need
 * Tailwind utility generation so they're not declared in @theme.
 * The guard ignores them.
 */
const TOKENS_ONLY = new Set([
	"--brand-mark-size",
	"--brand-mark-weight",
	"--brand-mark-tracking",
	"--radius",
]);

/*
 * Extract every `--name: value;` declaration from a CSS file, scoped
 * by the nearest selector or at-rule that contains it. Returns:
 *   { light: { [name]: value }, dark: { [name]: value } }
 *
 * We do a brace-balanced walk so nested blocks (e.g.
 *   @layer base { html[data-theme="dark"] { … } }
 * ) resolve to the inner selector, not the outer @layer.
 */
function parseTokens(css) {
	const out = { light: {}, dark: {} };
	// Strip /* … */ comments so they don't bleed into the "selector"
	// slice that precedes each `{`.
	const src = css.replace(/\/\*[\s\S]*?\*\//g, "");

	function classify(selector) {
		if (selector.includes('data-theme="dark"')) return "dark";
		if (selector === ":root" || selector === "@theme") return "light";
		// Anything else (e.g. .brand-mark, *, body) is not a token scope.
		return null;
	}

	function walk(source) {
		let i = 0;
		while (i < source.length) {
			const open = source.indexOf("{", i);
			if (open === -1) return;
			const selector = source.slice(i, open).trim().replace(/^.*[;}]/s, "").trim();
			// Find matching close brace
			let depth = 1;
			let j = open + 1;
			while (j < source.length && depth > 0) {
				if (source[j] === "{") depth++;
				else if (source[j] === "}") depth--;
				j++;
			}
			const body = source.slice(open + 1, j - 1);
			const bucket = classify(selector);
			if (bucket) {
				const declRe = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
				let d;
				while ((d = declRe.exec(body))) {
					out[bucket][d[1]] = d[2]
						.trim()
						.toLowerCase()
						.replace(/\s+/g, " ");
				}
			}
			// Recurse so nested rules inside @layer / @media still get walked.
			if (body.includes("{")) walk(body);
			i = j;
		}
	}

	walk(src);
	return out;
}

function diff(a, b, scope) {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	const mismatches = [];
	for (const k of keys) {
		if (TOKENS_ONLY.has(k)) continue;
		if (a[k] !== b[k]) {
			mismatches.push({ scope, key: k, tokens: a[k], theme: b[k] });
		}
	}
	return mismatches;
}

async function main() {
	const [tokensCss, themeCss] = await Promise.all([
		readFile(TOKENS, "utf8"),
		readFile(THEME, "utf8"),
	]);
	const tokens = parseTokens(tokensCss);
	const theme = parseTokens(themeCss);

	const mismatches = [
		...diff(tokens.light ?? {}, theme.light ?? {}, "light"),
		...diff(tokens.dark ?? {}, theme.dark ?? {}, "dark"),
	];

	if (mismatches.length === 0) {
		const lightCount = Object.keys(tokens.light ?? {}).length;
		const darkCount = Object.keys(tokens.dark ?? {}).length;
		console.log(
			`[brand] tokens.css ↔ theme.css in sync — ${lightCount} light + ${darkCount} dark tokens.`,
		);
		return;
	}

	console.error("\n[brand] token drift detected between tokens.css and theme.css:\n");
	for (const m of mismatches) {
		console.error(`  [${m.scope}] ${m.key}`);
		console.error(`    tokens.css: ${m.tokens ?? "(missing)"}`);
		console.error(`    theme.css : ${m.theme ?? "(missing)"}`);
	}
	console.error(
		"\nFix: edit both files so the values match. See tokens/README in packages/brand.\n",
	);
	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
