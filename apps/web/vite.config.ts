import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Override default proxy targets via env — handy when running against a
// separate e2e / staging collector without touching the primary one.
//   DEV_COLLECTOR_URL=http://localhost:28790 pnpm dev:web
const collectorUrl = process.env.DEV_COLLECTOR_URL ?? "http://localhost:8790";
const demoUrl = process.env.DEV_DEMO_URL ?? "http://localhost:8787";

// fflate (transitively pulled by rrweb-snapshot for replay compression)
// does `try { require("worker_threads") } catch {}` to feature-detect the
// Node runtime. In a normal browser bundle that throws and the catch
// silently sets Worker = undefined. Vite's CJS externalizer instead
// returns a warn-on-access stub, so the try/catch never fires and
// fflate's contract is broken. This alias points the import at our
// shim that exports `Worker = undefined` directly — same end state as
// the catch branch, no warning. See src/shims/worker-threads.ts.
const workerThreadsShim = fileURLToPath(
	new URL("./src/shims/worker-threads.ts", import.meta.url),
);

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: [{ find: "worker_threads", replacement: workerThreadsShim }],
	},
	server: {
		port: Number(process.env.DEV_WEB_PORT ?? 5173),
		proxy: {
			// Demo backend — the Playground tab calls these.
			"/api": demoUrl,
			// Collector routes — dashboard queries, session auth, SDK ingest.
			"/internal": collectorUrl,
			"/auth": collectorUrl,
			"/health": collectorUrl,
			"/v1": collectorUrl,
		},
	},
});
