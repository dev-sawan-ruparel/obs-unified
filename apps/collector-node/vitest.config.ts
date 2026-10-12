import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirror the `paths` in tsconfig.json so tests import workspace packages from
// source rather than requiring a prior `pnpm -r build`.
const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const src = (rel: string) => path.join(root, rel);

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@obsunified\/types\/constants$/,
				replacement: src("packages/obs-types/src/constants.ts"),
			},
			{
				find: /^@obsunified\/types$/,
				replacement: src("packages/obs-types/src/index.ts"),
			},
			{
				find: /^@obsunified\/collector$/,
				replacement: src("packages/obs-collector/src/index.ts"),
			},
			{
				find: /^@obsunified\/telemetry-sdk$/,
				replacement: src("packages/telemetry-sdk/src/index.ts"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
