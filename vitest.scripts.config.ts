import { defineConfig } from "vitest/config";

// Root-level runner (deliberately NOT named vitest.config.* so that package
// runs without their own config do not inherit it when vitest walks up) for repository scripts that are not workspace packages
// (`pnpm -r run test` never reaches them). Invoked by `pnpm test:scripts`,
// which `pnpm test` runs after the per-package suites.
export default defineConfig({
	test: {
		include: ["scripts/**/*.test.{mjs,ts}"],
		environment: "node",
	},
});
