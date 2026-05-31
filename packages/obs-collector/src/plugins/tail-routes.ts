import type { CollectorPlugin } from "../framework/collector";
import { getProjectId } from "./_context";

/**
 * Live tail SSE endpoint. The dashboard opens an EventSource here; the
 * collector proxies to the TailHub Durable Object which holds the open
 * stream and fans out broadcasts from ingest.
 */
export const tailRoutesPlugin: CollectorPlugin = {
	name: "tail-routes",
	register(app) {
		app.get("/internal/telemetry/tail", (c) => {
			const hub = c.env.TAIL_HUB;
			if (!hub) {
				return c.json(
					{ error: "Live tail not configured (TAIL_HUB binding missing)" },
					503,
				);
			}
			// EventSource can't send custom headers, so allow projectId override
			// via query param. The dashboard-auth middleware has already verified
			// the session; project isolation is the only thing the projectId
			// controls, and any authenticated user can query any project today.
			const projectId = c.req.query("projectId")?.trim() || getProjectId(c);
			// Validate the project identifier before using it as a Durable Object
			// name / broadcast filter. (Cross-project authz remains a known,
			// documented limitation — see comment above.)
			if (!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
				return c.json({ error: "invalid projectId" }, 400);
			}
			const kinds = c.req.query("kinds") || "span,log";

			const id = hub.idFromName("singleton");
			const stub = hub.get(id);

			const subscribeUrl = new URL("https://hub/subscribe");
			subscribeUrl.searchParams.set("projectId", projectId);
			subscribeUrl.searchParams.set("kinds", kinds);

			return stub.fetch(subscribeUrl.toString(), {
				method: "GET",
				signal: c.req.raw.signal,
			});
		});
	},
};
