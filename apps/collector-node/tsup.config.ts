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
		"@obsunified/collector",
		"@obsunified/telemetry-sdk",
		"@obsunified/types",
		"hono",
		"pg",
	],
});
