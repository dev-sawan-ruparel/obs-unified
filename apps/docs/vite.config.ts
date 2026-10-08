import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
	envPrefix: ["VITE_", "GITHUB_REPO_LINK"],
	plugins: [mdx(), tailwindcss(), reactRouter()],
	server: {
		port: 3000,
	},
	resolve: {
		tsconfigPaths: true,
	},
});
