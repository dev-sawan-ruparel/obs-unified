import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";
import type { SessionReplayMetadataRow } from "@obs/types";

export const replayQueryRoutesPlugin: CollectorPlugin = {
	name: "replay-query-routes",
	register(app, runtime) {
		app.get("/internal/replays", async (c) => {
			const limit = Math.max(1, Math.min(500, parseInt(c.req.query("limit") ?? "50", 10) || 50));
			const { results } = await c.env.DB.prepare(
				`SELECT 
					r.*,
					(SELECT page_path FROM usage_events e WHERE e.session_id = r.session_id AND e.event_type = 'page_view' ORDER BY e.occurred_at ASC LIMIT 1) as starting_link
				 FROM session_replay_metadata r 
				 ORDER BY r.last_chunk_at DESC 
				 LIMIT ?`
			)
				.bind(limit)
				.all();

			return c.json({ replays: results });
		});

		app.get("/internal/replays/:sessionId", async (c) => {
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

		app.delete("/internal/replays/:sessionId", async (c) => {
			const sessionId = c.req.param("sessionId");
			
			if (!c.env.REPLAYS_BUCKET) {
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			// 1. Check if it exists
			const metadata = await c.env.DB.prepare(
				`SELECT * FROM session_replay_metadata WHERE session_id = ?`
			)
				.bind(sessionId)
				.first<SessionReplayMetadataRow>();

			if (!metadata) {
				return c.json({ error: "Session replay not found" }, 404);
			}

			// 2. Delete all chunks from bucket
			const bucket = c.env.REPLAYS_BUCKET!;
			const prefix = `replays/${sessionId}/`;
			const list = await bucket.list({ prefix });

			if (list.objects.length > 0) {
				await Promise.all(list.objects.map(obj => bucket.delete(obj.key)));
			}

			// 3. Delete metadata from DB
			await c.env.DB.prepare(
				`DELETE FROM session_replay_metadata WHERE session_id = ?`
			)
				.bind(sessionId)
				.run();

			return c.json({ success: true });
		});
	},
};
