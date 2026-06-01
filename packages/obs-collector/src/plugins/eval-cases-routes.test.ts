import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { evalCasesRoutesPlugin } from "./eval-cases-routes";

const env = (db: MemSqlDb): CollectorEnv => ({
	DB: db as unknown as D1Database,
});

const setup = () => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	evalCasesRoutesPlugin.register(app, new CollectorRuntime());
	return app;
};

const evalCaseRow = {
	id: "case-1",
	project_id: "default",
	source_entity_type: "action",
	source_entity_id: "action-1",
	source_agent_run_id: "run-1",
	source_action_id: "action-1",
	source_ai_call_id: null,
	source_tool_call_id: "tool-1",
	source_trace_id: "trace-1",
	source_span_id: "span-1",
	name: "Wrong invoice update",
	expected_outcome: "Reject unsafe invoice update",
	rubric_json: '{"criteria":["approval"]}',
	redacted_prompt_json: '{"messages":[]}',
	reference_payload_json: '{"answer":"reject"}',
	metadata_json: '{"sourceLinks":{"actionId":"action-1"}}',
	created_at: "2026-05-31T00:00:00.000Z",
	updated_at: "2026-05-31T00:00:00.000Z",
};

describe("evalCasesRoutesPlugin", () => {
	it("saves an eval case from a production action source", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM actions")) {
					return {
						id: "action-1",
						agent_run_id: "run-1",
						tool_call_id: "tool-1",
						trace_id: "trace-1",
						span_id: "span-1",
					};
				}
				if (sql.includes("FROM tool_calls")) {
					return {
						id: "tool-1",
						action_id: "action-1",
						tool_name: "update_invoice",
						args_hash: "args-hash",
						result_hash: "result-hash",
					};
				}
				if (sql.includes("FROM ai_span_payloads")) {
					return {
						input_json: '{"prompt":"redacted"}',
						output_json: '{"result":"blocked"}',
					};
				}
				return null;
			},
			all: () => [],
		});
		const app = setup();

		const res = await app.request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "action",
					sourceEntityId: "action-1",
					name: "Wrong invoice update",
					expectedOutcome: "Reject unsafe invoice update",
					rubric: { criteria: ["approval"] },
				}),
			},
			env(db),
		);

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			evalCase: {
				sourceActionId: string;
				sourceAgentRunId: string;
				sourceToolCallId: string;
				redactedPrompt: unknown;
				referencePayload: unknown;
			};
		};
		expect(body.evalCase.sourceActionId).toBe("action-1");
		expect(body.evalCase.sourceAgentRunId).toBe("run-1");
		expect(body.evalCase.sourceToolCallId).toBe("tool-1");
		expect(body.evalCase.redactedPrompt).toEqual({ prompt: "redacted" });
		expect(body.evalCase.referencePayload).toEqual({ result: "blocked" });
		expect(db.callsMatching("INSERT INTO eval_cases")).toHaveLength(1);
	});

	it("fetches and lists eval cases", async () => {
		const db = new MemSqlDb({
			first: () => evalCaseRow,
			all: () => [evalCaseRow],
		});
		const app = setup();

		const getRes = await app.request(
			"/internal/eval-cases/case-1",
			{ method: "GET" },
			env(db),
		);
		const listRes = await app.request(
			"/internal/eval-cases?sourceEntityType=action&sourceEntityId=action-1",
			{ method: "GET" },
			env(db),
		);

		expect(getRes.status).toBe(200);
		expect(listRes.status).toBe(200);
		const getBody = (await getRes.json()) as { evalCase: { id: string } };
		const listBody = (await listRes.json()) as {
			evalCases: Array<{ sourceEntityId: string }>;
		};
		expect(getBody.evalCase.id).toBe("case-1");
		expect(listBody.evalCases[0].sourceEntityId).toBe("action-1");
	});

	it("validates source type and reports missing production sources", async () => {
		const app = setup();

		const invalid = await app.request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "span",
					sourceEntityId: "span-1",
					name: "Bad source",
				}),
			},
			env(new MemSqlDb()),
		);
		expect(invalid.status).toBe(400);

		const db = new MemSqlDb({ first: () => null });
		const missing = await setup().request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "ai_call",
					sourceEntityId: "missing-call",
					name: "Missing call",
				}),
			},
			env(db),
		);
		expect(missing.status).toBe(404);
	});
});
