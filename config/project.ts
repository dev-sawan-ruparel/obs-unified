import project from "./project.json";

const configuredLink =
	import.meta.env?.GITHUB_REPO_LINK ||
	(typeof process !== "undefined" ? process.env.GITHUB_REPO_LINK : undefined) ||
	project.GITHUB_REPO_LINK;

const repositoryUrl = new URL(configuredLink);
if (
	repositoryUrl.origin !== "https://github.com" ||
	!/^\/[\w.-]+\/[\w.-]+\/?$/.test(repositoryUrl.pathname) ||
	repositoryUrl.search ||
	repositoryUrl.hash ||
	repositoryUrl.username ||
	repositoryUrl.password
) {
	throw new Error("GITHUB_REPO_LINK must be an HTTPS GitHub repository URL.");
}

export const GITHUB_REPO_LINK = configuredLink.replace(/\/+$/, "");

/** Adapt repository links in authored Markdown to the configured destination. */
export function configuredRepositoryLink(href: string | undefined) {
	if (
		href === project.GITHUB_REPO_LINK ||
		href?.startsWith(`${project.GITHUB_REPO_LINK}/`)
	) {
		return `${GITHUB_REPO_LINK}${href.slice(project.GITHUB_REPO_LINK.length)}`;
	}
	return href;
}
