import type { StoredSpan } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import type {
	CollectorRuntime,
	SpanProcessorPlugin,
} from "../framework/collector";
import type { CollectorRouteContext } from "../framework/env";
import { sha256Hex } from "../lib/hash";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { aiSpanPayloadsProcessorPlugin } from "./ai-span-payloads-processor";

const span = (): StoredSpan => ({
	projectId: "proj-123",
	spanId: "span-1",
	parentSpanId: null,
	traceId: "trace-1",
	traceState: null,
	serviceName: "agent-service",
	scopeName: null,
	scopeVersion: null,
	spanName: "llm",
	spanKind: 1,
	statusCode: 1,
	statusMessage: null,
	startTime: "2026-05-22T00:00:00.000Z",
	endTime: "2026-05-22T00:00:01.000Z",
	durationMs: 1000,
	attributesJson: JSON.stringify({
		"openinference.span.kind": "LLM",
		"ai.payload.input": "raw prompt",
		"ai.payload.output": "raw completion",
		"obs.action.id": "action-1",
	}),
	droppedAttributesCount: 0,
	resourceAttributesJson: "{}",
	eventsJson: "[]",
	droppedEventsCount: 0,
	linksJson: "[]",
	droppedLinksCount: 0,
	receivedAt: "2026-05-22T00:00:01.000Z",
	expiresAt: "2026-05-23T00:00:01.000Z",
	sessionId: null,
	interactionId: null,
});

const processWith = async (db: MemSqlDb, env: Record<string, unknown> = {}) => {
	const processors: SpanProcessorPlugin[] = [];
	aiSpanPayloadsProcessorPlugin.register(
		{} as Parameters<typeof aiSpanPayloadsProcessorPlugin.register>[0],
		{
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		} as unknown as CollectorRuntime,
	);
	const processFn = processors[0]?.process;
	if (!processFn) throw new Error("span processor was not registered");
	return processFn([span()], {
		env: { DB: db, ...env },
		now: new Date(),
		logger: console,
	} as unknown as CollectorRouteContext);
};

describe("aiSpanPayloadsProcessorPlugin payload capture policy", () => {
	it("stores hashes but omits raw payloads when project capture is disabled", async () => {
		const db = new MemSqlDb();
		const processed = await processWith(db);

		const insert = db.callsMatching("INSERT INTO ai_span_payloads")[0];
		expect(insert.binds).toContain(null);
		expect(insert.binds).toContain(await sha256Hex("raw prompt"));
		expect(insert.binds).toContain(await sha256Hex("raw completion"));

		const attrs = JSON.parse(processed[0].attributesJson);
		expect(attrs["ai.payload.input"]).toBeUndefined();
		expect(attrs["ai.payload.output"]).toBeUndefined();
	});

	it("stores raw payloads only when capture is explicitly enabled", async () => {
		const db = new MemSqlDb();
		await processWith(db, { OBS_PAYLOAD_CAPTURE_DEFAULT: "true" });

		const insert = db.callsMatching("INSERT INTO ai_span_payloads")[0];
		expect(insert.binds).toContain("raw prompt");
		expect(insert.binds).toContain("raw completion");
		expect(insert.binds).toContain(await sha256Hex("raw prompt"));
		expect(insert.binds).toContain(await sha256Hex("raw completion"));
	});
});
