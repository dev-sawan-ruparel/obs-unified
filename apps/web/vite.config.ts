import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Override default proxy targets via env — handy when running against a
// separate e2e / staging collector without touching the primary one.
//   DEV_COLLECTOR_URL=http://localhost:28790 pnpm dev:web
const collectorUrl = process.env.DEV_COLLECTOR_URL ?? "http://localhost:8790";
const demoUrl = process.env.DEV_DEMO_URL ?? "http://localhost:8787";

export default defineConfig({
	plugins: [react(), tailwindcss()],
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
