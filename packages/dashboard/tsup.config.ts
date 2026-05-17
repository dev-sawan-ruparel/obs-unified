import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	external: [
		"react",
		"react-dom",
		"@obs-unified/types",
		"@obs-unified/pprof-decoder",
		"@xyflow/react",
		"dagre",
		"rrweb-player",
		"rrweb",
	],
	// Dashboard ships JSX/TSX; rely on tsup's default JSX handling.
	loader: {
		".css": "copy",
	},
});
