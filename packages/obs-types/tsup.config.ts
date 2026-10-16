import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/constants.ts",
		"src/api-client.ts",
		"src/lineage.ts",
		"src/schema-version.ts",
		"src/routes.ts",
		"src/internal-contracts.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
});
