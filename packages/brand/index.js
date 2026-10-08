/*
 * @obsunified/brand
 *
 * Programmatic access to the brand asset paths. Most consumers should
 * import the asset files directly via the package's `exports` field
 * (e.g. `import faviconUrl from "@obsunified/brand/favicons/favicon.svg"`
 * with Vite/Webpack), or copy them into their public/ directory via
 * `node packages/brand/scripts/sync-to-projects.mjs`.
 *
 * This module is provided for tooling that prefers absolute paths
 * (build scripts, doc generators, etc.).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const brandRoot = __dirname;

export const tokens = resolve(__dirname, "tokens/tokens.css");

export const logo = {
	mark: resolve(__dirname, "logo/mark.svg"),
	markDark: resolve(__dirname, "logo/mark-dark.svg"),
	wordmark: resolve(__dirname, "logo/wordmark.svg"),
	wordmarkDark: resolve(__dirname, "logo/wordmark-dark.svg"),
};

export const favicons = {
	svg: resolve(__dirname, "favicons/favicon.svg"),
	ico: resolve(__dirname, "favicons/favicon.ico"),
	apple: resolve(__dirname, "favicons/apple-touch-icon.png"),
	icon192: resolve(__dirname, "favicons/icon-192.png"),
	icon512: resolve(__dirname, "favicons/icon-512.png"),
	iconMaskable: resolve(__dirname, "favicons/icon-maskable-512.png"),
	manifest: resolve(__dirname, "favicons/site.webmanifest"),
};

export const og = {
	product: resolve(__dirname, "og/obs-unified.svg"),
	docs: resolve(__dirname, "og/docs.svg"),
	presence: resolve(__dirname, "og/presence.svg"),
	profile: resolve(__dirname, "og/profile.svg"),
	profileDark: resolve(__dirname, "og/profile-dark.svg"),
};

export const palette = {
	bg: "#F9F9F9",
	surface: "#FFFFFF",
	surfaceLow: "#F3F3F3",
	surfaceHigh: "#E8E8E8",
	primary: "#006B18",
	primaryContainer: "#008821",
	error: "#B7102A",
	warning: "#A56100",
	accent: "#17497B",
	onSurface: "#1A1C1C",
	onSurfaceMuted: "#4E5555",
	onSurfaceSubtle: "#6B7171",
	outline: "#BDCBB6",
	outlineSoft: "#E5E7E3",
};
