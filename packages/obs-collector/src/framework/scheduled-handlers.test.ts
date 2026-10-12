/**
 * The scheduled maintenance handlers expose a runtime-neutral `run(env)`
 * alongside the Cloudflare `scheduled(event, env, ctx)` adapter. These tests
 * pin two contracts non-Workers hosts (the Node collector) rely on:
 *
 *   1. `scheduled` is a pure delegate — it issues exactly the SQL `run` does
 *      and never reads the event or context.
 *   2. `run` reports a summary and, for analyses, converts failures into a
 *      logged `undefined` rather than a rejection.
 */

import { describe, expect, it, vi } from "vitest";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import {
	createAnalysesRunHandler,
	createRetentionCleanupHandler,
} from "./collector";
import type { CollectorEnv } from "./env";
import type { Logger } from "./logger";

const makeLogger = () =>
	({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}) satisfies Logger;

const envFor = (db: MemSqlDb): CollectorEnv =>
	({ DB: db }) as unknown as CollectorEnv;

// The Workers adapter must not touch these; passing non-objects proves it.
const NO_EVENT = undefined as unknown as ScheduledEvent;
const NO_CTX = undefined as unknown as ExecutionContext;

describe("createRetentionCleanupHandler", () => {
	it("run(env) purges each table and returns the per-table counts", async () => {
		const logger = makeLogger();
		const db = new MemSqlDb({ run: () => ({ changes: 3 }), all: () => [] });
		const handler = createRetentionCleanupHandler({ logger });

		const summary = await handler.run(envFor(db));

		expect(summary).toMatchObject({
			spans: 3,
			usage: 3,
			logs: 3,
			analysis_results: 3,
			profile_blobs: 3,
		});
		// The AI and metrics stores purge several tables each and sum the
		// changes, so their counts are a multiple of the per-statement value.
		expect(summary.ai_calls).toBeGreaterThanOrEqual(3);
		expect(summary.ai_calls % 3).toBe(0);
		expect(summary.metric_points).toBeGreaterThanOrEqual(3);
		expect(summary.metric_points % 3).toBe(0);
		expect(db.callsMatching("DELETE FROM profile_blobs")).toHaveLength(1);
		expect(logger.info).toHaveBeenCalledWith(
			"[retention-cleanup] purged expired rows",
			expect.objectContaining({ spans: 3, profile_blobs: 3 }),
		);
	});

	it("scheduled(event, env, ctx) delegates to run(env) and ignores event/ctx", async () => {
		const viaRun = new MemSqlDb({ all: () => [] });
		const viaScheduled = new MemSqlDb({ all: () => [] });
		const handler = createRetentionCleanupHandler({ logger: makeLogger() });

		await handler.run(envFor(viaRun));
		await expect(
			handler.scheduled(NO_EVENT, envFor(viaScheduled), NO_CTX),
		).resolves.toBeUndefined();

		expect(viaRun.calls.length).toBeGreaterThan(0);
		expect(viaScheduled.calls.map((c) => c.sql)).toEqual(
			viaRun.calls.map((c) => c.sql),
		);
	});

	it("deletes expired profile blobs from PROFILES_BUCKET when present", async () => {
		const db = new MemSqlDb({
			all: (sql) =>
				sql.includes("FROM profile_blobs")
					? [
							{ id: "p1", blob_url: "default/1/p1.pprof.gz" },
							{ id: "p2", blob_url: "default/2/p2.pprof.gz" },
						]
					: [],
			run: () => ({ changes: 2 }),
		});
		const bucketDelete = vi.fn(async () => {});
		const env = {
			DB: db,
			PROFILES_BUCKET: { delete: bucketDelete },
		} as unknown as CollectorEnv;

		const summary = await createRetentionCleanupHandler({
			logger: makeLogger(),
		}).run(env);

		expect(summary.profile_blobs).toBe(2);
		expect(bucketDelete).toHaveBeenCalledTimes(2);
		expect(bucketDelete).toHaveBeenCalledWith("default/1/p1.pprof.gz");
	});
});

describe("createAnalysesRunHandler", () => {
	it("run(env) returns the run summary when nothing is due", async () => {
		const logger = makeLogger();
		const db = new MemSqlDb({ all: () => [], first: () => null });
		const handler = createAnalysesRunHandler({ logger });

		const summary = await handler.run(envFor(db));

		expect(summary).toMatchObject({ ran: 0, failed: 0, narrated: 0 });
		expect(logger.info).toHaveBeenCalledWith(
			"[analyses] scheduled run summary",
			expect.objectContaining({ ran: 0, failed: 0 }),
		);
	});

	it("run(env) resolves undefined and logs when the database fails", async () => {
		const logger = makeLogger();
		const db = new MemSqlDb({
			all: () => {
				throw new Error("relation analysis_definitions does not exist");
			},
		});
		const handler = createAnalysesRunHandler({ logger });

		await expect(handler.run(envFor(db))).resolves.toBeUndefined();
		expect(logger.error).toHaveBeenCalledWith(
			"[analyses] scheduled run failed",
			expect.objectContaining({
				error: "relation analysis_definitions does not exist",
			}),
		);
	});

	it("scheduled(event, env, ctx) delegates to run(env) and ignores event/ctx", async () => {
		const viaRun = new MemSqlDb({ all: () => [], first: () => null });
		const viaScheduled = new MemSqlDb({ all: () => [], first: () => null });
		const handler = createAnalysesRunHandler({ logger: makeLogger() });

		await handler.run(envFor(viaRun));
		await expect(
			handler.scheduled(NO_EVENT, envFor(viaScheduled), NO_CTX),
		).resolves.toBeUndefined();

		expect(viaRun.calls.length).toBeGreaterThan(0);
		expect(viaScheduled.calls.map((c) => c.sql)).toEqual(
			viaRun.calls.map((c) => c.sql),
		);
	});
});
