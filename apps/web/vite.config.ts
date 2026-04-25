import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Override default proxy targets via env — handy when running against a
// separate e2e / staging collector without touching the primary one.
//   DEV_COLLECTOR_URL=http://localhost:28790 pnpm dev:web
const collectorUrl = process.env.DEV_COLLECTOR_URL ?? "http://localhost:8790";
const demoUrl = process.env.DEV_DEMO_URL ?? "http://localhost:8787";

const workerThreadsShim = fileURLToPath(
	new URL("./src/shims/worker-threads.ts", import.meta.url),
);

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [
			// rrweb/rrweb-player conditionally `require("worker_threads")` for
			// SSR setups; in the browser that import resolves to a Vite
			// "externalized" stub that throws on access. Replace it with a
			// proper noop so the console isn't full of warnings.
			{ find: "worker_threads", replacement: workerThreadsShim },
		],
	},
	server: {
		port: Number(process.env.DEV_WEB_PORT ?? 5173),
		proxy: {
			// Demo backend — the Playground tab calls these.
			"/api": demoUrl,
			// Collector routes — dashboard queries, session auth, SDK ingest.
			"/internal": collectorUrl,
			"/auth": collectorUrl,
			"/v1": collectorUrl,
		},
	},
});
