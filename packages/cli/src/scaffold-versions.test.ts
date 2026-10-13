import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCAFFOLD_SDK_RANGES } from "./scaffold-versions";

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

const major = (v: string): string => v.replace(/^[\^~]/, "").split(".")[0];

/** Every @obsunified range must sit on the major the workspace publishes. */
const expectCurrentMajor = (label: string, deps: Record<string, string>) => {
	const obs = Object.entries(deps).filter(([n]) =>
		n.startsWith("@obsunified/"),
	);
	expect(obs.length, `${label} has no @obsunified deps`).toBeGreaterThan(0);
	for (const [name, range] of obs) {
		expect(range, `${label}: ${name}`).toMatch(/^\^\d+\.\d+\.\d+$/);
		expect(major(range), `${label}: ${name} ${range}`).toBe(
			major(workspaceVersion(name)),
		);
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
});
