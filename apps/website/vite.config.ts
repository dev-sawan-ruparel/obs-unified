import { defineConfig } from "vite";

export default defineConfig({
  envPrefix: ["VITE_", "GITHUB_REPO_LINK"],
  server: { port: 4173 },
  preview: { port: 4173 },
  build: {
    target: "es2022",
    cssMinify: true,
  },
});
