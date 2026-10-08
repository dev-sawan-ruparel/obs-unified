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
			// Project scope must come from auth middleware, never from the client
			// URL. The dashboard live-tail client uses a fetch stream so it can
			// send the same X-Project-Id header as the rest of the API.
			const projectId = getProjectId(c);
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
