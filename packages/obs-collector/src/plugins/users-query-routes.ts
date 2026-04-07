import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";
import type { UserProfileRow, UserProfileDetail } from "@obs/types";

export const usersQueryRoutesPlugin: CollectorPlugin = {
	name: "users-query-routes",
	register(app, runtime) {
		app.get("/v1/query/users", async (c) => {
			const limit = parseInt(c.req.query("limit") ?? "50", 10);
			const { results } = await c.env.DB.prepare(
				`SELECT * FROM user_profiles ORDER BY last_seen_at DESC LIMIT ?`
			)
				.bind(limit)
				.all<UserProfileRow>();

			const users: UserProfileDetail[] = results.map((row) => ({
				userId: row.user_id,
				visitorId: row.visitor_id,
				email: row.email,
				name: row.name,
				properties: row.properties_json ? JSON.parse(row.properties_json) : {},
				firstSeenAt: row.first_seen_at,
				lastSeenAt: row.last_seen_at,
			}));

			return c.json({ users });
		});

		app.get("/v1/query/users/:userId", async (c) => {
			const userId = c.req.param("userId");
			const user = await c.env.DB.prepare(
				`SELECT * FROM user_profiles WHERE user_id = ?`
			)
				.bind(userId)
				.first<UserProfileRow>();

			if (!user) {
				return c.json({ error: "User not found" }, 404);
			}

			const detail: UserProfileDetail = {
				userId: user.user_id,
				visitorId: user.visitor_id,
				email: user.email,
				name: user.name,
				properties: user.properties_json ? JSON.parse(user.properties_json) : {},
				firstSeenAt: user.first_seen_at,
				lastSeenAt: user.last_seen_at,
			};

			return c.json({ user: detail });
		});
	},
};
