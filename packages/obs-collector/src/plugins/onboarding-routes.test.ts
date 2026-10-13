import type { StoredSpan } from "@obsunified/types";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { createTelemetryCollectorApp } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { ingestTelemetrySpans } from "../lib/store/ingest";
import { createMigratedSqliteDb } from "../lib/test-utils/node-sqlite-db";
import { onboardingRoutesPlugin } from "./onboarding-routes";

const NOW = new Date().toISOString();
const LATER = new Date(Date.now() + 3_600_000).toISOString();

const span = (
	projectId: string,
	spanId: string,
	interactionId: string | null,
) =>
	({
		projectId,
		traceId: `trace-${projectId}`,
		spanId,
		parentSpanId: null,
		traceState: null,
		serviceName: "web",
		scopeName: null,
		scopeVersion: null,
		spanName: "GET /",
		spanKind: 2,
		statusCode: 1,
		statusMessage: null,
		startTime: NOW,
		endTime: NOW,
		durationMs: 1,
		attributesJson: "{}",
		droppedAttributesCount: 0,
		resourceAttributesJson: "{}",
		eventsJson: "[]",
		droppedEventsCount: 0,
		linksJson: "[]",
		droppedLinksCount: 0,
		receivedAt: NOW,
		expiresAt: LATER,
		sessionId: null,
		interactionId,
	}) satisfies StoredSpan;

describe("/internal/onboarding/counts", () => {
	it("counts only the caller's project", async () => {
		const db = createMigratedSqliteDb();
		await ingestTelemetrySpans(db, [
			span("alpha", "a1", "click-1"),
			span("alpha", "a2", null),
			span("beta", "b1", null),
		]);
		db.raw
			.prepare(
				`INSERT INTO user_profiles (project_id, user_id, visitor_id, first_seen_at, last_seen_at)
				 VALUES ('beta', 'u1', 'v1', ?, ?)`,
			)
			.run(NOW, NOW);

		const setProject: MiddlewareHandler<{
			Bindings: CollectorEnv;
			Variables: { projectId: string };
		}> = async (c, next) => {
			const header = c.req.header("x-project-id");
			if (header) c.set("projectId", header);
			await next();
		};
		const app = createTelemetryCollectorApp({
			plugins: [onboardingRoutesPlugin],
			dashboardAuth: { middleware: setProject, registerRoutes: () => {} },
		});
		const counts = async (projectId: string) => {
			const res = await app.request(
				"/internal/onboarding/counts",
				{ headers: { "x-project-id": projectId } },
				{ DB: db as unknown as D1Database } as CollectorEnv,
			);
			expect(res.status).toBe(200);
			return res.json();
		};

		expect(await counts("alpha")).toMatchObject({
			spans: 2,
			spansWithInteraction: 1,
			identifiedUsers: 0,
		});
		expect(await counts("beta")).toMatchObject({
			spans: 1,
			spansWithInteraction: 0,
			identifiedUsers: 1,
		});
		expect(await counts("gamma")).toMatchObject({
			spans: 0,
			logs: 0,
			usageEvents: 0,
			identifiedUsers: 0,
			aiCalls: 0,
			replayChunks: 0,
			spansWithInteraction: 0,
		});
		db.close();
	});
});
