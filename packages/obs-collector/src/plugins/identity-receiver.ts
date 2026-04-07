import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";
import type { IdentifyInput } from "@obs/types";

export const identityReceiverPlugin: CollectorPlugin = {
	name: "identity-receiver",
	register(app, runtime) {
		app.post("/v1/identify", async (c) => {
			const payload = await c.req.json<IdentifyInput>();
			const now = new Date().toISOString();

			const propertiesJson = payload.properties
				? JSON.stringify(payload.properties)
				: null;

			await c.env.DB.prepare(
				`INSERT INTO user_profiles (user_id, visitor_id, email, name, properties_json, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           visitor_id = excluded.visitor_id,
           email = COALESCE(excluded.email, user_profiles.email),
           name = COALESCE(excluded.name, user_profiles.name),
           properties_json = COALESCE(excluded.properties_json, user_profiles.properties_json),
           last_seen_at = excluded.last_seen_at
        `
			)
				.bind(
					payload.userId,
					payload.visitorId,
					payload.email ?? null,
					payload.name ?? null,
					propertiesJson,
					now,
					now
				)
				.run();

			return c.json({ success: true, userId: payload.userId });
		});
	},
};
