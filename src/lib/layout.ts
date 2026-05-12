import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { source } from "./source";

/**
 * Top-bar config shared by docs + home layouts. Branding is kept simple —
 * the documentation is for the obs-unified observability platform, no
 * external links beyond the repo and the dashboard entry point.
 */
export const baseOptions: BaseLayoutProps = {
	nav: {
		title: "obs-unified",
	},
	githubUrl: "https://github.com/sawanruparel/obs-unified",
	links: [
		{
			text: "Docs",
			url: "/docs",
		},
	],
};

export const docsOptions: DocsLayoutProps = {
	...baseOptions,
	tree: source.pageTree,
};
