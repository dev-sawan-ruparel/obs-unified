import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/server.ts"],
	format: ["esm"],
	target: "node22",
	outDir: "dist",
	clean: true,
	sourcemap: true,
	external: [
		"@aws-sdk/client-s3",
		"@hono/node-server",
		"@obs-unified/collector",
		"@obs-unified/telemetry-sdk",
		"@obs-unified/types",
		"hono",
		"pg",
	],
});
