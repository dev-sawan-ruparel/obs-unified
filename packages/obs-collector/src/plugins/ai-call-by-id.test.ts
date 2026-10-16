import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { createTelemetryCollectorApp } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { aiReceiverPlugin } from "./ai-receiver";

const passthrough: MiddlewareHandler<{
	Bindings: CollectorEnv;
	Variables: { projectId: string };
}> = async (c, next) => {
	c.set("projectId", "default");
	await next();
};

const app = createTelemetryCollectorApp({
	plugins: [aiReceiverPlugin],
	auth: { middleware: passthrough },
	dashboardAuth: { middleware: passthrough, registerRoutes: () => {} },
});

const row = {
	project_id: "default",
	call_id: "call-1",
	trace_id: "trace-1",
	span_id: "span-1",
	service_name: "svc",
	model_name: "gpt-4.1",
	provider: "openai",
	call_type: "chat",
	request_json: null,
	response_json: null,
	prompt_tokens: 10,
	completion_tokens: 5,
	total_cost_usd: 0.01,
	latency_ms: 120,
	is_error: 0,
	error_message: null,
	occurred_at: "2026-05-01T00:00:00.000Z",
	received_at: "2026-05-01T00:00:01.000Z",
	expires_at: "2026-05-02T00:00:00.000Z",
};

describe("GET /internal/ai/calls/:callId", () => {
	it("returns the call with its trace and span ids", async () => {
		const db = new MemSqlDb({
			first: (sql, binds) =>
				sql.includes("FROM ai_calls") && binds[1] === "call-1" ? row : null,
		});
		const res = await app.request("/internal/ai/calls/call-1", {}, {
			DB: db,
		} as unknown as CollectorEnv);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			call: { callId: string; modelName: string };
			traceId: string;
			spanId: string;
		};
		expect(body.call.callId).toBe("call-1");
		expect(body.call.modelName).toBe("gpt-4.1");
		expect(body.traceId).toBe("trace-1");
		expect(body.spanId).toBe("span-1");
		expect(db.calls[0].binds).toEqual(["default", "call-1"]);
	});

	it("answers 404 for an unknown call id", async () => {
		const db = new MemSqlDb({ first: () => null });
		const res = await app.request("/internal/ai/calls/nope", {}, {
			DB: db,
		} as unknown as CollectorEnv);
		expect(res.status).toBe(404);
	});
});
