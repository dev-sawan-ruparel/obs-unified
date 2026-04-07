import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";
import type { ReplayChunkInput } from "@obs/types";

export const replayReceiverPlugin: CollectorPlugin = {
	name: "replay-receiver",
	register(app, runtime) {
		app.post("/v1/replays", async (c) => {
			const payload = await c.req.json<ReplayChunkInput>();
			const now = new Date().toISOString();

			const timestamp = Date.now();
			const objectKey = `replays/${payload.sessionId}/${timestamp}-${payload.sequenceNumber}.json`;
			
			if (!c.env.REPLAYS_BUCKET) {
				console.error("REPLAYS_BUCKET binding is missing");
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			const payloadString = JSON.stringify(payload.events);
			const chunkBytes = new TextEncoder().encode(payloadString).length;

			await c.env.REPLAYS_BUCKET.put(
				objectKey,
				payloadString,
				{ httpMetadata: { contentType: "application/json" } }
			);

			await c.env.DB.prepare(
				`INSERT INTO session_replay_metadata (session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           last_chunk_at = excluded.last_chunk_at,
           chunk_count = session_replay_metadata.chunk_count + 1,
           events_count = session_replay_metadata.events_count + excluded.events_count,
           storage_bytes = session_replay_metadata.storage_bytes + excluded.storage_bytes
        `
			)
				.bind(
					payload.sessionId,
					payload.visitorId,
					now,
					now,
					1,
					payload.events.length,
					chunkBytes
				)
				.run();

			return c.json({ success: true, chunkKey: objectKey });
		});
	},
};
