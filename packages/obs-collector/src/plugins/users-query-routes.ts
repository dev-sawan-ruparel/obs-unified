import type {
	JsonValue,
	UserProfileDetail,
	UserProfileRow,
} from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export const usersQueryRoutesPlugin: CollectorPlugin = {
	name: "users-query-routes",
	register(app) {
		app.get("/internal/users", async (c) => {
			const projectId = getProjectId(c);
			const limit = Math.max(
				1,
				Math.min(1000, parseInt(c.req.query("limit") ?? "50", 10) || 50),
			);
			const { results } = await sqlDbFor(c.env)
				.prepare(
					`SELECT * FROM user_profiles WHERE project_id = ? ORDER BY last_seen_at DESC LIMIT ?`,
				)
				.bind(projectId, limit)
				.all<UserProfileRow>();

			const users: UserProfileDetail[] = results.map((row) => ({
				userId: row.user_id,
				visitorId: row.visitor_id,
				email: row.email,
				name: row.name,
				properties: parseProperties(row.properties_json),
				firstSeenAt: row.first_seen_at,
				lastSeenAt: row.last_seen_at,
			}));

			return c.json({ users });
		});

		app.get("/internal/users/:userId", async (c) => {
			const projectId = getProjectId(c);
			const userId = c.req.param("userId");
			const user = await sqlDbFor(c.env)
				.prepare(
					`SELECT * FROM user_profiles WHERE project_id = ? AND user_id = ?`,
				)
				.bind(projectId, userId)
				.first<UserProfileRow>();

			if (!user) {
				return c.json({ error: "User not found" }, 404);
			}

			const detail: UserProfileDetail = {
				userId: user.user_id,
				visitorId: user.visitor_id,
				email: user.email,
				name: user.name,
				properties: parseProperties(user.properties_json),
				firstSeenAt: user.first_seen_at,
				lastSeenAt: user.last_seen_at,
			};

			return c.json({ user: detail });
		});
	},
};

function parseProperties(value: string | null): Record<string, JsonValue> {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as JsonValue;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, JsonValue>)
			: {};
	} catch {
		return {};
	}
}
