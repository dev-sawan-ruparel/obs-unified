import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	compileOpsMdxToMarkdown,
	DEFAULT_REPO_ROOT,
	extractHeadingSlugs,
	generateOpsDocs,
	parseFrontmatter,
	rewriteOpsLink,
	validateOpsDocLinks,
} from "./generate-ops-docs.mjs";

describe("generate-ops-docs", () => {
	it("parses frontmatter and converts title to top-level heading with generated notice", () => {
		const mdx = [
			"---",
			"title: Production operations",
			"description: Reverse proxy and Kubernetes.",
			"---",
			"",
			"Intro paragraph.",
		].join("\n");

		const parsed = parseFrontmatter(
			mdx,
			"apps/docs/content/docs/ops/production.mdx",
		);
		expect(parsed.frontmatter.title).toBe("Production operations");
		expect(parsed.frontmatter.description).toBe(
			"Reverse proxy and Kubernetes.",
		);

		const markdown = compileOpsMdxToMarkdown(mdx, {
			sourceRelPath: "apps/docs/content/docs/ops/production.mdx",
			destinationRelPath: "docs/ops/production.md",
		});

		expect(markdown).toBe(
			[
				"<!-- GENERATED FROM apps/docs/content/docs/ops/production.mdx — DO NOT EDIT DIRECTLY. Run: node scripts/generate-ops-docs.mjs -->",
				"",
				"# Production operations",
				"",
				"Intro paragraph.",
				"",
			].join("\n"),
		);
	});

	it("rewrites relative ops links, docs routes, and repo GitHub links while preserving anchors", () => {
		expect(
			rewriteOpsLink("./identity-access", {
				destinationRelPath: "docs/ops/production.md",
			}),
		).toBe("./identity-access-recipes.md");

		expect(
			rewriteOpsLink(
				"./identity-access#recipe-1-cloudflare-access-zero-trust",
				{
					destinationRelPath: "docs/ops/production.md",
				},
			),
		).toBe(
			"./identity-access-recipes.md#recipe-1-cloudflare-access-zero-trust",
		);

		expect(
			rewriteOpsLink(
				"/docs/ops/production#4-kubernetes-orchestration-manifests",
				{
					destinationRelPath: "docs/ops/identity-access-recipes.md",
				},
			),
		).toBe("./production.md#4-kubernetes-orchestration-manifests");

		expect(
			rewriteOpsLink("/docs/installation#docker", {
				destinationRelPath: "docs/ops/production.md",
			}),
		).toBe("https://docs.obsunified.com/docs/installation#docker");

		expect(
			rewriteOpsLink(
				"https://github.com/dev-sawan-ruparel/obs-unified/blob/main/apps/collector-node/README.md#background-maintenance",
				{
					destinationRelPath: "docs/ops/production.md",
					repoRoot: DEFAULT_REPO_ROOT,
				},
			),
		).toBe("../../apps/collector-node/README.md#background-maintenance");

		expect(
			rewriteOpsLink(
				"https://github.com/dev-sawan-ruparel/obs-unified/tree/main/examples/external-access",
				{
					destinationRelPath: "docs/ops/identity-access-recipes.md",
					repoRoot: DEFAULT_REPO_ROOT,
				},
			),
		).toBe("../../examples/external-access/");
	});

	it("preserves code fences, Mermaid diagrams, and inline code spans verbatim", () => {
		const mdx = [
			"---",
			"title: Identity and external access",
			"---",
			"",
			"Use `Authorization: Bearer <DASHBOARD_TOKEN>` and `[literal](./identity-access)`.",
			"See [`examples/external-access/`](https://github.com/dev-sawan-ruparel/obs-unified/tree/main/examples/external-access) and [Production](./production#4-kubernetes-orchestration-manifests).",
			"",
			"```mermaid",
			"flowchart TD",
			'  A["<Browser>"] --> B["./identity-access"]',
			"```",
			"",
			"```yaml",
			"tunnel: <TUNNEL_UUID>",
			"```",
		].join("\n");

		const out = compileOpsMdxToMarkdown(mdx, {
			sourceRelPath: "apps/docs/content/docs/ops/identity-access.mdx",
			destinationRelPath: "docs/ops/identity-access-recipes.md",
			repoRoot: DEFAULT_REPO_ROOT,
		});

		expect(out).toContain(
			"Use `Authorization: Bearer <DASHBOARD_TOKEN>` and `[literal](./identity-access)`.",
		);
		expect(out).toContain(
			"See [`examples/external-access/`](../../examples/external-access/) and [Production](./production.md#4-kubernetes-orchestration-manifests).",
		);
		expect(out).toContain('  A["<Browser>"] --> B["./identity-access"]');
		expect(out).toContain("tunnel: <TUNNEL_UUID>");
	});

	it("converts supported <Callout> blocks and rejects unsupported MDX/JSX tags or imports", () => {
		const supportedMdx = [
			"---",
			"title: Test Guide",
			"---",
			"",
			"import { Callout } from 'fumadocs-ui/components/callout';",
			"",
			"{/* Internal MDX comment */}",
			'<Callout type="warn" title="Proxy trust">',
			"Set `TRUST_PROXY=true`.",
			"</Callout>",
		].join("\n");

		const compiled = compileOpsMdxToMarkdown(supportedMdx, {
			sourceRelPath: "apps/docs/content/docs/ops/production.mdx",
			destinationRelPath: "docs/ops/production.md",
		});
		expect(compiled).toContain(
			"> [!WARNING]\n> **Proxy trust**\n> Set `TRUST_PROXY=true`.",
		);
		expect(compiled).not.toContain("Internal MDX comment");

		const unsupportedJsx = [
			"---",
			"title: Bad Guide",
			"---",
			"",
			"<Tabs items={['a', 'b']}>",
			"</Tabs>",
		].join("\n");
		expect(() =>
			compileOpsMdxToMarkdown(unsupportedJsx, {
				sourceRelPath: "apps/docs/content/docs/ops/production.mdx",
				destinationRelPath: "docs/ops/production.md",
			}),
		).toThrow(/Unsupported MDX\/JSX tag "<Tabs items=\{\['a', 'b'\]\}>"/);

		const unsupportedImport = [
			"---",
			"title: Bad Import",
			"---",
			"",
			"import { Custom } from './custom';",
		].join("\n");
		expect(() =>
			compileOpsMdxToMarkdown(unsupportedImport, {
				sourceRelPath: "apps/docs/content/docs/ops/production.mdx",
				destinationRelPath: "docs/ops/production.md",
			}),
		).toThrow(/Unsupported MDX import statement/);
	});

	it("validates relative file links and #anchor slugs and detects drift in --check mode", () => {
		const tmpDir = mkdtempSync(path.join(os.tmpdir(), "ops-docs-test-"));
		try {
			const mdxDir = path.join(tmpDir, "apps/docs/content/docs/ops");
			const outDir = path.join(tmpDir, "docs/ops");
			mkdirSync(mdxDir, { recursive: true });
			mkdirSync(outDir, { recursive: true });

			const prodMdx = [
				"---",
				"title: Production operations",
				"---",
				"",
				"## 4. Kubernetes orchestration manifests",
				"",
				"See [Identity](./identity-access#architectural-realities--boundaries).",
			].join("\n");

			const accessMdx = [
				"---",
				"title: Identity and external access",
				"---",
				"",
				"## Architectural realities & boundaries",
				"",
				"See [Kubernetes](./production#4-kubernetes-orchestration-manifests).",
			].join("\n");

			writeFileSync(path.join(mdxDir, "production.mdx"), prodMdx, "utf-8");
			writeFileSync(
				path.join(mdxDir, "identity-access.mdx"),
				accessMdx,
				"utf-8",
			);

			// 1. Check mode fails when generated files are missing
			const missingCheck = generateOpsDocs({
				repoRoot: tmpDir,
				checkOnly: true,
				validateIncomingRepoLinks: false,
			});
			expect(missingCheck.errors.length).toBeGreaterThan(0);

			// 2. Write mode generates both files cleanly
			const writeRun = generateOpsDocs({
				repoRoot: tmpDir,
				checkOnly: false,
				validateIncomingRepoLinks: false,
			});
			expect(writeRun.errors).toEqual([]);
			expect(writeRun.results.every((r) => r.updated)).toBe(true);

			// 3. Second write run is idempotent (no updates needed)
			const secondRun = generateOpsDocs({
				repoRoot: tmpDir,
				checkOnly: false,
				validateIncomingRepoLinks: false,
			});
			expect(secondRun.errors).toEqual([]);
			expect(secondRun.results.every((r) => !r.updated && r.inSync)).toBe(true);

			// 4. Check mode passes when files are in sync
			const syncCheck = generateOpsDocs({
				repoRoot: tmpDir,
				checkOnly: true,
				validateIncomingRepoLinks: false,
			});
			expect(syncCheck.errors).toEqual([]);

			// 5. Check mode fails if a generated file is manually edited (drift)
			writeFileSync(
				path.join(outDir, "production.md"),
				"# Manually edited\n",
				"utf-8",
			);
			const driftCheck = generateOpsDocs({
				repoRoot: tmpDir,
				checkOnly: true,
				validateIncomingRepoLinks: false,
			});
			expect(driftCheck.errors).toEqual([
				"Generated file is out of sync with apps/docs/content/docs/ops/production.mdx: docs/ops/production.md (run: node scripts/generate-ops-docs.mjs)",
			]);

			// 6. Broken anchor detection
			const brokenAnchorErrors = validateOpsDocLinks(
				"See [Broken](./production.md#non-existent-heading).",
				"docs/ops/identity-access-recipes.md",
				{
					repoRoot: tmpDir,
					virtualFileMap: new Map([
						["docs/ops/production.md", writeRun.results[0].generatedMarkdown],
					]),
				},
			);
			expect(brokenAnchorErrors.length).toBe(1);
			expect(brokenAnchorErrors[0]).toContain(
				'Broken section anchor "#non-existent-heading"',
			);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("verifies repository canonical MDX and generated Markdown are in sync", () => {
		const checkResult = generateOpsDocs({
			repoRoot: DEFAULT_REPO_ROOT,
			checkOnly: true,
		});
		expect(checkResult.errors).toEqual([]);
		expect(
			extractHeadingSlugs(checkResult.results[0].generatedMarkdown).has(
				"4-kubernetes-orchestration-manifests",
			),
		).toBe(true);
	});
});
