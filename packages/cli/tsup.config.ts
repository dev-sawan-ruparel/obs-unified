import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	shims: true,
	// kleur + prompts are runtime deps, not bundled.
	external: ["kleur", "prompts"],
});
