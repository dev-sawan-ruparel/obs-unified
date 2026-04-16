import type { CollectorPlugin } from "../framework/collector";

/**
 * Serves the dashboard SPA.
 *
 * For Cloudflare Workers: configure [assets] in wrangler.toml pointing to
 * the @obs/dashboard build output. The Workers runtime handles static file
 * serving automatically; this plugin provides the fallback route for SPA
 * client-side routing.
 *
 * For Node.js / other runtimes: serve static files from @obs/dashboard/dist
 * using your framework's static file middleware, then mount this plugin for
 * the SPA fallback.
 */
export const dashboardRoutesPlugin: CollectorPlugin = {
	name: "dashboard-routes",
	register(app) {
		// SPA fallback: any /dashboard/* route that doesn't match a static file
		// should serve the dashboard index.html
		app.get("/dashboard/*", (c) => {
			// In CF Workers with [assets], the runtime serves static files before
			// hitting this route. If we get here, the file doesn't exist, so we
			// return a redirect to /dashboard/ which will serve index.html.
			return c.redirect("/dashboard/");
		});

		// Root redirect: visiting the collector root goes to dashboard
		app.get("/", (c) => {
			return c.redirect("/dashboard/");
		});
	},
};
