import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			// Demo backend — the Playground tab calls these.
			"/api": "http://localhost:8787",
			// Collector routes — dashboard queries, session auth, SDK ingest.
			"/internal": "http://localhost:8790",
			"/auth": "http://localhost:8790",
			"/v1": "http://localhost:8790",
		},
	},
});
