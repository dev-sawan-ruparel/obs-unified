import type { IdentifyInput } from "@obsunified/types";
import type { CollectorPlugin } from "../framework/collector";
import { dialectFor, sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";
import { readJsonObject } from "./_json";

export const identityReceiverPlugin: CollectorPlugin = {
	name: "identity-receiver",
	register(app) {
		app.post("/v1/identify", async (c) => {
			const projectId = getProjectId(c);
			const payload = await readJsonObject<IdentifyInput>(c);
			if (!payload) return c.json({ error: "Invalid JSON body" }, 400);
			if (!payload.userId || typeof payload.userId !== "string") {
				return c.json({ error: "userId is required" }, 400);
			}
			if (payload.userId.length > 256) {
				return c.json({ error: "userId too long (max 256)" }, 400);
			}
			if (
				payload.email &&
				(typeof payload.email !== "string" || payload.email.length > 320)
			) {
				return c.json({ error: "Invalid email" }, 400);
			}
			if (
				payload.name &&
				(typeof payload.name !== "string" || payload.name.length > 256)
			) {
				return c.json({ error: "Invalid name" }, 400);
			}
			const now = new Date().toISOString();

			// Backfill window: callers (synthetic seeds, historical imports)
			// can pass firstSeenAt to set the user's earliest observed
			// activity. We accept anything in the past; future timestamps
			// fall back to `now` so a clock-skew client can't poison the
			// table.
			let firstSeenAt = now;
			if (payload.firstSeenAt) {
				const parsed = new Date(payload.firstSeenAt);
				if (!Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now()) {
					firstSeenAt = parsed.toISOString();
				}
			}

			const propertiesJson = payload.properties
				? JSON.stringify(payload.properties)
				: null;

			// Profiles are keyed by (project_id, user_id) — migration 045.
			// user_id values are caller-chosen (often an email), so two
			// projects identifying the same id must get two independent rows;
			// an ingest key for one project can never read or rewrite another
			// project's profile through this endpoint.
			//
			// On conflict we keep the EARLIEST first_seen_at via MIN() — once
			// observed, a user's first-seen is monotonic; an identify() call
			// that runs at "now" must not overwrite a true historical value.
			const db = sqlDbFor(c.env);
			const firstSeenExpr =
				dialectFor(db).name === "postgres"
					? "LEAST(user_profiles.first_seen_at, excluded.first_seen_at)"
					: "MIN(user_profiles.first_seen_at, excluded.first_seen_at)";

			await db
				.prepare(
					`INSERT INTO user_profiles (project_id, user_id, visitor_id, email, name, properties_json, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, user_id) DO UPDATE SET
           visitor_id = excluded.visitor_id,
           email = COALESCE(excluded.email, user_profiles.email),
           name = COALESCE(excluded.name, user_profiles.name),
           properties_json = COALESCE(excluded.properties_json, user_profiles.properties_json),
           first_seen_at = ${firstSeenExpr},
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
					firstSeenAt,
					now,
				)
				.run();

			return c.json({ success: true, userId: payload.userId });
		});
	},
};
