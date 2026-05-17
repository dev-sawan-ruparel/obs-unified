import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		auth: "src/auth/ingest-auth.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	external: [
		"hono",
		"@obs-unified/types",
		"@obs-unified/pprof-decoder",
	],
});
