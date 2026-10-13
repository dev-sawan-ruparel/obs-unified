import type { ReplayChunkInput } from "@obsunified/types";
import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";
import { readJsonObject } from "./_json";

export const replayReceiverPlugin: CollectorPlugin = {
	name: "replay-receiver",
	register(app, runtime) {
		app.post("/v1/replays", async (c) => {
			const projectId = getProjectId(c);
			const payload = await readJsonObject<ReplayChunkInput>(c);
			if (!payload) return c.json({ error: "Invalid JSON body" }, 400);
			// visitor_id is NOT NULL on session_replay_metadata; rejecting a
			// missing visitorId here keeps the chunk out of blob storage instead
			// of failing the metadata insert after the object was written.
			if (
				!isSafeId(payload.sessionId) ||
				!isSafeId(payload.visitorId) ||
				!Number.isInteger(payload.sequenceNumber) ||
				payload.sequenceNumber < 0 ||
				!Array.isArray(payload.events)
			) {
				return c.json({ error: "Invalid replay payload" }, 400);
			}
			const now = new Date().toISOString();

			const timestamp = Date.now();
			const objectKey = `replays/${projectId}/${payload.sessionId}/${timestamp}-${payload.sequenceNumber}.json`;

			if (!c.env.REPLAYS_BUCKET) {
				runtime.logger.error("REPLAYS_BUCKET binding is missing", {
					project_id: projectId,
				});
				return c.json({ error: "Replay storage not configured" }, 500);
			}

			const payloadString = JSON.stringify(payload.events);
			const chunkBytes = new TextEncoder().encode(payloadString).length;

			await c.env.REPLAYS_BUCKET.put(objectKey, payloadString, {
				httpMetadata: { contentType: "application/json" },
			});

			await sqlDbFor(c.env)
				.prepare(
					`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, session_id) DO UPDATE SET
           last_chunk_at = excluded.last_chunk_at,
           chunk_count = session_replay_metadata.chunk_count + 1,
           events_count = session_replay_metadata.events_count + excluded.events_count,
           storage_bytes = session_replay_metadata.storage_bytes + excluded.storage_bytes
        `,
				)
				.bind(
					projectId,
					payload.sessionId,
					payload.visitorId,
					now,
					now,
					1,
					payload.events.length,
					chunkBytes,
				)
				.run();

			return c.json({ success: true, chunkKey: objectKey });
		});
	},
};

function isSafeId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 160 &&
		/^[A-Za-z0-9._:-]+$/.test(value) &&
		!value.includes("..")
	);
}
