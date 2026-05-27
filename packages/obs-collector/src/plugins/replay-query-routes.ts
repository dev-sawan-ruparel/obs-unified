import type { SessionReplayMetadataRow } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export const replayQueryRoutesPlugin: CollectorPlugin = {
	name: "replay-query-routes",
	register(app) {
		app.get("/internal/replays", async (c) => {
			const projectId = getProjectId(c);
			const limit = Math.max(
				1,
				Math.min(500, parseInt(c.req.query("limit") ?? "50", 10) || 50),
			);
			const { results } = await sqlDbFor(c.env)
				.prepare(
					`SELECT
					r.*,
					(SELECT page_path FROM usage_events e WHERE e.project_id = r.project_id AND e.session_id = r.session_id AND e.event_type = 'page_view' ORDER BY e.occurred_at ASC LIMIT 1) as starting_link
				 FROM session_replay_metadata r
				 WHERE r.project_id = ?
				 ORDER BY r.last_chunk_at DESC
				 LIMIT ?`,
				)
				.bind(projectId, limit)
				.all();

			return c.json({ replays: results });
		});

		app.get("/internal/replays/:sessionId", async (c) => {
			const projectId = getProjectId(c);
			const sessionId = c.req.param("sessionId");

			if (!c.env.REPLAYS_BUCKET) {
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			const metadata = await sqlDbFor(c.env)
				.prepare(
					`SELECT * FROM session_replay_metadata WHERE project_id = ? AND session_id = ?`,
				)
				.bind(projectId, sessionId)
				.first<SessionReplayMetadataRow>();

			if (!metadata) {
				return c.json({ error: "Session replay not found" }, 404);
			}

			const prefix = `replays/${projectId}/${sessionId}/`;
			const list = await c.env.REPLAYS_BUCKET.list({ prefix });

			if (list.objects.length === 0) {
				return c.json({ error: "Replay chunks missing in storage" }, 404);
			}

			list.objects.sort((a, b) => a.key.localeCompare(b.key));

			const orderedChunksData: Record<string, unknown>[][] = [];
			for (const obj of list.objects) {
				const objectData = await c.env.REPLAYS_BUCKET.get(obj.key);
				if (objectData) {
					orderedChunksData.push(
						await objectData.json<Record<string, unknown>[]>(),
					);
				}
			}

			const events = orderedChunksData.flat();

			return c.json({
				metadata,
				events,
			});
		});

		app.delete("/internal/replays/:sessionId", async (c) => {
			const projectId = getProjectId(c);
			const sessionId = c.req.param("sessionId");

			if (!c.env.REPLAYS_BUCKET) {
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			// 1. Check if it exists
			const metadata = await sqlDbFor(c.env)
				.prepare(
					`SELECT * FROM session_replay_metadata WHERE project_id = ? AND session_id = ?`,
				)
				.bind(projectId, sessionId)
				.first<SessionReplayMetadataRow>();

			if (!metadata) {
				return c.json({ error: "Session replay not found" }, 404);
			}

			// 2. Delete all chunks from bucket
			const bucket = c.env.REPLAYS_BUCKET;
			if (!bucket) {
				return c.json({ error: "Replay storage not configured" }, 500);
			}
			const prefix = `replays/${projectId}/${sessionId}/`;
			const list = await bucket.list({ prefix });

			if (list.objects.length > 0) {
				await Promise.all(list.objects.map((obj) => bucket.delete(obj.key)));
			}

			// 3. Delete metadata from DB
			await sqlDbFor(c.env)
				.prepare(
					`DELETE FROM session_replay_metadata WHERE project_id = ? AND session_id = ?`,
				)
				.bind(projectId, sessionId)
				.run();

			return c.json({ success: true });
		});
	},
};
