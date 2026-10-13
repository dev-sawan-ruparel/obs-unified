/**
 * `c.req.json()` resolves `null`, arrays and primitives for bodies such as
 * `null` or `"x"`. Every JSON ingest and admin route used to dereference the
 * result straight away and answer 500. They must all answer 400 now, and the
 * replay receiver must reject a chunk before writing it to blob storage.
 */

import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { createTelemetryCollectorApp } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { aiReceiverPlugin } from "./ai-receiver";
import { askRoutesPlugin } from "./ask-routes";
import { evalCasesRoutesPlugin } from "./eval-cases-routes";
import { identityReceiverPlugin } from "./identity-receiver";
import { replayReceiverPlugin } from "./replay-receiver";
import { usageReceiverPlugin } from "./usage-receiver";

const passthrough: MiddlewareHandler<{
	Bindings: CollectorEnv;
	Variables: { projectId: string };
}> = async (c, next) => {
	c.set("projectId", "default");
	await next();
};

const app = createTelemetryCollectorApp({
	plugins: [
		aiReceiverPlugin,
		usageReceiverPlugin,
		replayReceiverPlugin,
		identityReceiverPlugin,
		askRoutesPlugin,
		evalCasesRoutesPlugin,
	],
	auth: { middleware: passthrough },
	dashboardAuth: { middleware: passthrough, registerRoutes: () => {} },
});

const ROUTES = [
	"/v1/ai",
	"/v1/ai/evaluations",
	"/v1/usage",
	"/v1/replays",
	"/v1/identify",
	"/internal/ask",
	"/internal/eval-cases",
	"/internal/eval-runs",
	"/internal/eval-cases/case-1/results",
];

const NON_OBJECT_BODIES = ["null", "[]", '"text"', "42", "true"];

const post = (path: string, body: string, env: Partial<CollectorEnv> = {}) =>
	app.request(
		path,
		{ method: "POST", headers: { "content-type": "application/json" }, body },
		{ DB: new MemSqlDb() as unknown as D1Database, ...env } as CollectorEnv,
	);

describe("JSON body validation", () => {
	for (const path of ROUTES) {
		it(`${path} answers 400 for non-object JSON bodies`, async () => {
			for (const body of NON_OBJECT_BODIES) {
				const res = await post(path, body);
				expect(res.status, `${path} <- ${body}`).toBe(400);
				const json = (await res.json()) as { error?: string };
				expect(typeof json.error, `${path} <- ${body}`).toBe("string");
			}
			const malformed = await post(path, "{not json");
			expect(malformed.status, `${path} <- malformed`).toBe(400);
		});
	}

	it("/v1/replays rejects a chunk without visitorId before touching blob storage", async () => {
		const puts: string[] = [];
		const bucket = {
			put: async (key: string) => {
				puts.push(key);
			},
		};
		const res = await post(
			"/v1/replays",
			JSON.stringify({ sessionId: "sess-1", sequenceNumber: 0, events: [] }),
			{ REPLAYS_BUCKET: bucket as unknown as R2Bucket },
		);
		expect(res.status).toBe(400);
		expect(puts).toEqual([]);
	});
});
