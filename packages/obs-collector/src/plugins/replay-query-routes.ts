import type { SessionReplayMetadataRow } from "@obsunified/types";
import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

const DEFAULT_CHUNK_LIMIT = 100;
const MAX_CHUNK_LIMIT = 500;
const REPLAY_CHUNK_FETCH_CONCURRENCY = 8;

interface ReplayChunkObject {
	key: string;
}

interface ReplayChunkBody {
	json<T>(): Promise<T>;
}

interface ReplayChunkBucket {
	get(key: string): Promise<ReplayChunkBody | null>;
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const current = nextIndex++;
				results[current] = await mapper(items[current]);
			}
		}),
	);
	return results;
}

export async function fetchReplayChunks(
	bucket: ReplayChunkBucket,
	objects: ReplayChunkObject[],
	concurrency = REPLAY_CHUNK_FETCH_CONCURRENCY,
): Promise<Record<string, unknown>[]> {
	const chunks = await mapWithConcurrency(objects, concurrency, async (obj) => {
		const objectData = await bucket.get(obj.key);
		if (!objectData) return [];
		return objectData.json<Record<string, unknown>[]>();
	});
	return chunks.flat();
}

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
			const objects: Array<{ key: string }> = [];
			let cursor: string | undefined;
			do {
				const page = await c.env.REPLAYS_BUCKET.list({ prefix, cursor });
				objects.push(...page.objects);
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);

			if (objects.length === 0) {
				return c.json({ error: "Replay chunks missing in storage" }, 404);
			}

			objects.sort((a, b) => a.key.localeCompare(b.key));

			const chunkOffset = Math.max(
				0,
				parseInt(c.req.query("chunkOffset") ?? "0", 10) || 0,
			);
			const chunkLimit = Math.max(
				1,
				Math.min(
					MAX_CHUNK_LIMIT,
					parseInt(
						c.req.query("chunkLimit") ?? String(DEFAULT_CHUNK_LIMIT),
						10,
					) || DEFAULT_CHUNK_LIMIT,
				),
			);
			const selectedObjects = objects.slice(
				chunkOffset,
				chunkOffset + chunkLimit,
			);
			const events = await fetchReplayChunks(
				c.env.REPLAYS_BUCKET,
				selectedObjects,
			);
			const nextChunkOffset =
				chunkOffset + chunkLimit < objects.length
					? chunkOffset + chunkLimit
					: null;

			return c.json({
				metadata,
				events,
				chunks: {
					offset: chunkOffset,
					limit: chunkLimit,
					returned: selectedObjects.length,
					total: objects.length,
					nextChunkOffset,
				},
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
			let cursor: string | undefined;
			do {
				const page = await bucket.list({ prefix, cursor });
				if (page.objects.length > 0) {
					await Promise.all(page.objects.map((obj) => bucket.delete(obj.key)));
				}
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);

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
