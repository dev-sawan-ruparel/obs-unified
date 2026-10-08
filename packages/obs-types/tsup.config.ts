import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/constants.ts",
		"src/api-client.ts",
		"src/schema-version.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
});
