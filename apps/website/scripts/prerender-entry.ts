import { loadEnv } from "vite";

// Vite and the Node prerender must use the same public repository config.
const repositoryLink = loadEnv(
	"production",
	process.cwd(),
	"GITHUB_REPO_LINK",
).GITHUB_REPO_LINK;
if (!process.env.GITHUB_REPO_LINK && repositoryLink) {
	process.env.GITHUB_REPO_LINK = repositoryLink;
}

await import("./prerender");
