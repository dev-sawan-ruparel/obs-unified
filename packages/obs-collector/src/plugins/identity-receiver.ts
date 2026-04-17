import type { CollectorPlugin } from "../framework/collector";
import type { IdentifyInput } from "@obs/types";
import { getProjectId } from "./_context";

export const identityReceiverPlugin: CollectorPlugin = {
	name: "identity-receiver",
	register(app) {
		app.post("/v1/identify", async (c) => {
			const projectId = getProjectId(c);
			let payload: IdentifyInput;
			try {
				payload = await c.req.json<IdentifyInput>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			if (!payload.userId || typeof payload.userId !== "string") {
				return c.json({ error: "userId is required" }, 400);
			}
			if (payload.userId.length > 256) {
				return c.json({ error: "userId too long (max 256)" }, 400);
			}
			if (payload.email && (typeof payload.email !== "string" || payload.email.length > 320)) {
				return c.json({ error: "Invalid email" }, 400);
			}
			if (payload.name && (typeof payload.name !== "string" || payload.name.length > 256)) {
				return c.json({ error: "Invalid name" }, 400);
			}
			const now = new Date().toISOString();

			const propertiesJson = payload.properties
				? JSON.stringify(payload.properties)
				: null;

			// user_id is the PK today (single-tenant legacy). For MVP, we keep
			// that contract — user_id is treated as globally unique and the
			// first project to identify them "owns" the profile. project_id on
			// the row reflects where the user was first seen.
			await c.env.DB.prepare(
				`INSERT INTO user_profiles (project_id, user_id, visitor_id, email, name, properties_json, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           visitor_id = excluded.visitor_id,
           email = COALESCE(excluded.email, user_profiles.email),
           name = COALESCE(excluded.name, user_profiles.name),
           properties_json = COALESCE(excluded.properties_json, user_profiles.properties_json),
           last_seen_at = excluded.last_seen_at
        `,
			)
				.bind(
					projectId,
					payload.userId,
					payload.visitorId,
					payload.email ?? null,
					payload.name ?? null,
					propertiesJson,
					now,
					now,
				)
				.run();

			return c.json({ success: true, userId: payload.userId });
		});
	},
};
