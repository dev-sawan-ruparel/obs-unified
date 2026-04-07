import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";
import type { SessionReplayMetadataRow } from "@obs/types";

export const replayQueryRoutesPlugin: CollectorPlugin = {
	name: "replay-query-routes",
	register(app, runtime) {
		app.get("/v1/query/replays", async (c) => {
			const limit = parseInt(c.req.query("limit") ?? "50", 10);
			const { results } = await c.env.DB.prepare(
				`SELECT * FROM session_replay_metadata ORDER BY last_chunk_at DESC LIMIT ?`
			)
				.bind(limit)
				.all<SessionReplayMetadataRow>();

			return c.json({ replays: results });
		});

		app.get("/v1/query/replays/:sessionId", async (c) => {
			const sessionId = c.req.param("sessionId");
			
			if (!c.env.REPLAYS_BUCKET) {
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			const metadata = await c.env.DB.prepare(
				`SELECT * FROM session_replay_metadata WHERE session_id = ?`
			)
				.bind(sessionId)
				.first<SessionReplayMetadataRow>();

			if (!metadata) {
				return c.json({ error: "Session replay not found" }, 404);
			}

			const prefix = `replays/${sessionId}/`;
			const list = await c.env.REPLAYS_BUCKET.list({ prefix });

			if (list.objects.length === 0) {
				return c.json({ error: "Replay chunks missing in storage" }, 404);
			}

			list.objects.sort((a, b) => a.key.localeCompare(b.key));
			
			const orderedChunksData: Record<string, any>[][] = [];
			for (const obj of list.objects) {
				const objectData = await c.env.REPLAYS_BUCKET.get(obj.key);
				if (objectData) {
					orderedChunksData.push(await objectData.json<Record<string, any>[]>());
				}
			}

			const events = orderedChunksData.flat();

			return c.json({
				metadata,
				events
			});
		});
	},
};
