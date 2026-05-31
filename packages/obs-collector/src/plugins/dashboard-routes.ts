import type { CollectorPlugin } from "../framework/collector";

/**
 * Serves the dashboard SPA.
 *
 * For Cloudflare Workers: configure [assets] in wrangler.toml pointing to
 * the @obs-unified/dashboard build output. The Workers runtime handles static file
 * serving automatically; this plugin provides the fallback route for SPA
 * client-side routing.
 *
 * For Node.js / other runtimes: serve static files from @obs-unified/dashboard/dist
 * using your framework's static file middleware, then mount this plugin for
 * the SPA fallback.
 */
export const dashboardRoutesPlugin: CollectorPlugin = {
	name: "dashboard-routes",
	register(app) {
		// SPA fallback: any /dashboard/* route that doesn't match a static file
		// should serve the dashboard index.html
		app.get("/dashboard/*", async (c) => {
			// In CF Workers with [assets], the runtime serves static files before
			// hitting this route. If we get here under Workers with ASSETS, we can
			// fetch and return `/dashboard/` (which serves the index.html SPA entrypoint)
			// directly, preserving the client-side URL in the browser address bar.
			const env = c.env as unknown as Record<string, unknown>;
			const assets = env?.ASSETS as { fetch: typeof fetch } | undefined;
			if (assets && typeof assets.fetch === "function") {
				const url = new URL(c.req.url);
				url.pathname = "/dashboard/";
				return assets.fetch(new Request(url.toString(), c.req.raw));
			}
			// Fallback: redirects to SPA root
			return c.redirect("/dashboard/");
		});

		// Root redirect: visiting the collector root goes to dashboard
		app.get("/", (c) => {
			return c.redirect("/dashboard/");
		});
	},
};
