import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		cloudflare: "src/cloudflare.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	external: [
		"@hono/otel",
		"@microlabs/otel-cf-workers",
		"@opentelemetry/api",
		"hono",
		"@obs-unified/types",
	],
});
