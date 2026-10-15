import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCreateArgs, SCAFFOLD_SDK_RANGES } from "./scaffold-versions";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(here, "../templates");
const packagesDir = path.resolve(here, "../..");

/** `@obsunified/foo` → its workspace package.json version. */
const workspaceVersion = (name: string): string => {
	const dir = name.replace("@obsunified/", "");
	const pkg = JSON.parse(
		readFileSync(path.join(packagesDir, dir, "package.json"), "utf8"),
	) as { name: string; version: string };
	expect(pkg.name).toBe(name);
	return pkg.version;
};

/** Every @obsunified range must pin ^<exact workspace version>, not major-only. */
const expectCurrentMajor = (label: string, deps: Record<string, string>) => {
	const obs = Object.entries(deps).filter(([n]) =>
		n.startsWith("@obsunified/"),
	);
	expect(obs.length, `${label} has no @obsunified deps`).toBeGreaterThan(0);
	for (const [name, range] of obs) {
		expect(range, `${label}: ${name}`).toBe(`^${workspaceVersion(name)}`);
	}
};

describe("scaffold SDK versions", () => {
	it("templates depend on the currently published SDK major", () => {
		const templates = readdirSync(templatesDir);
		expect(templates.length).toBeGreaterThan(0);
		for (const template of templates) {
			const pkg = JSON.parse(
				readFileSync(path.join(templatesDir, template, "package.json"), "utf8"),
			) as { dependencies?: Record<string, string> };
			expectCurrentMajor(template, pkg.dependencies ?? {});
		}
	});

	it("the inline fallback scaffold uses the same ranges", () => {
		expectCurrentMajor("inline fallback", SCAFFOLD_SDK_RANGES);
	});

	it("frontend templates ship index.html, @hono/node-server, and avoid port 5173 dashboard collision", () => {
		const reactIndex = readFileSync(
			path.join(templatesDir, "react-vite", "index.html"),
			"utf8",
		);
		expect(reactIndex).toContain('/src/main.tsx"');

		const reactPkg = JSON.parse(
			readFileSync(
				path.join(templatesDir, "react-vite", "package.json"),
				"utf8",
			),
		) as { dependencies: Record<string, string> };
		expect(reactPkg.dependencies["@hono/node-server"]).toBeDefined();

		const reactServer = readFileSync(
			path.join(templatesDir, "react-vite", "src", "server.ts"),
			"utf8",
		);
		expect(reactServer).toContain('from "@hono/node-server"');
		expect(reactServer).toContain("serve(");

		const reactVite = readFileSync(
			path.join(templatesDir, "react-vite", "vite.config.ts"),
			"utf8",
		);
		expect(reactVite).toContain("port: 5174");
	});

	it("parses non-interactive create flags (--template, --collector-url, --yes) for AI agents", () => {
		expect(
			parseCreateArgs([
				"my-app",
				"--template",
				"hono-workers",
				"--collector-url",
				"http://localhost:8790",
				"--yes",
			]),
		).toEqual({
			appName: "my-app",
			template: "hono-workers",
			collectorUrl: "http://localhost:8790",
			yes: true,
		});

		expect(
			parseCreateArgs([
				"--template=vanilla-ts",
				"--url=https://obs.example.com",
				"demo",
			]),
		).toEqual({
			appName: "demo",
			template: "vanilla-ts",
			collectorUrl: "https://obs.example.com",
			yes: false,
		});

		expect(
			parseCreateArgs(["my-app", "--template", "invalid"]).error,
		).toContain('invalid template "invalid"');
	});
});
