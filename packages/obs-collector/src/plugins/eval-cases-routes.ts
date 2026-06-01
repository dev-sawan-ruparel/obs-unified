import type { JsonValue } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import {
	type EvalCaseInput,
	EvalCaseSourceNotFoundError,
	type EvalCaseSourceType,
	EvalCasesStore,
	isEvalCaseSourceType,
} from "../lib/eval-cases-store";
import { randomHex } from "../lib/hash";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

interface EvalCaseRequestBody {
	sourceEntityType?: unknown;
	sourceEntityId?: unknown;
	source?: {
		type?: unknown;
		id?: unknown;
		agentRunId?: unknown;
		actionId?: unknown;
		aiCallId?: unknown;
		toolCallId?: unknown;
		traceId?: unknown;
		spanId?: unknown;
	};
	name?: unknown;
	expectedOutcome?: unknown;
	rubric?: JsonValue | null;
	redactedPrompt?: JsonValue | null;
	referencePayload?: JsonValue | null;
	metadata?: unknown;
}

const asOptionalString = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	return typeof value === "string" ? value : null;
};

const asRecord = (value: unknown): Record<string, JsonValue> | null => {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, JsonValue>;
};

const badRequest = (message: string) => ({
	error: "Bad Request",
	message,
});

const parseLimit = (value: string | undefined): number => {
	const parsed = Number.parseInt(value ?? "50", 10);
	if (!Number.isFinite(parsed)) return 50;
	return Math.min(200, Math.max(1, parsed));
};

export const evalCasesRoutesPlugin: CollectorPlugin = {
	name: "eval-cases-routes",
	register(app) {
		app.post("/internal/eval-cases", async (c) => {
			let body: EvalCaseRequestBody;
			try {
				body = (await c.req.json()) as EvalCaseRequestBody;
			} catch {
				return c.json(badRequest("body must be JSON"), 400);
			}

			const sourceType = body.sourceEntityType ?? body.source?.type;
			if (!isEvalCaseSourceType(sourceType)) {
				return c.json(
					badRequest(
						"sourceEntityType must be one of: agent_run, action, ai_call, tool_call, trace",
					),
					400,
				);
			}
			const sourceId = asOptionalString(
				body.sourceEntityId ?? body.source?.id,
			)?.trim();
			if (!sourceId) {
				return c.json(badRequest("sourceEntityId is required"), 400);
			}
			const name = asOptionalString(body.name)?.trim();
			if (!name) {
				return c.json(badRequest("name is required"), 400);
			}
			const expectedOutcome = asOptionalString(body.expectedOutcome);
			if (
				body.expectedOutcome !== undefined &&
				body.expectedOutcome !== null &&
				expectedOutcome === null
			) {
				return c.json(badRequest("expectedOutcome must be a string"), 400);
			}
			const metadata = asRecord(body.metadata);
			if (metadata === null) {
				return c.json(badRequest("metadata must be a JSON object"), 400);
			}

			const input: EvalCaseInput = {
				sourceEntityType: sourceType,
				sourceEntityId: sourceId,
				name,
				expectedOutcome,
				rubric: body.rubric ?? null,
				redactedPrompt: body.redactedPrompt ?? null,
				referencePayload: body.referencePayload ?? null,
				metadata,
				source: {
					sourceAgentRunId: asOptionalString(body.source?.agentRunId),
					sourceActionId: asOptionalString(body.source?.actionId),
					sourceAiCallId: asOptionalString(body.source?.aiCallId),
					sourceToolCallId: asOptionalString(body.source?.toolCallId),
					sourceTraceId: asOptionalString(body.source?.traceId),
					sourceSpanId: asOptionalString(body.source?.spanId),
				},
			};

			const store = new EvalCasesStore(sqlDbFor(c.env));
			try {
				const evalCase = await store.createCase(getProjectId(c), input);
				return c.json({ evalCase }, 201);
			} catch (err) {
				if (err instanceof EvalCaseSourceNotFoundError) {
					return c.json(
						{
							error: "Not Found",
							message: err.message,
						},
						404,
					);
				}
				const message = err instanceof Error ? err.message : String(err);
				return c.json(badRequest(message), 400);
			}
		});

		app.get("/internal/eval-cases", async (c) => {
			const rawSourceType = c.req.query("sourceEntityType");
			const sourceEntityType =
				rawSourceType === undefined
					? undefined
					: isEvalCaseSourceType(rawSourceType)
						? rawSourceType
						: null;
			if (sourceEntityType === null) {
				return c.json(badRequest("sourceEntityType is invalid"), 400);
			}
			const store = new EvalCasesStore(sqlDbFor(c.env));
			const evalCases = await store.listCases({
				projectId: getProjectId(c),
				sourceEntityType: sourceEntityType as EvalCaseSourceType | undefined,
				sourceEntityId: c.req.query("sourceEntityId"),
				limit: parseLimit(c.req.query("limit")),
			});
			return c.json({ evalCases });
		});

		app.get("/internal/eval-cases/:id", async (c) => {
			const id = c.req.param("id");
			if (!id) return c.json(badRequest("id is required"), 400);
			const store = new EvalCasesStore(sqlDbFor(c.env));
			const evalCase = await store.getCase(getProjectId(c), id);
			if (!evalCase) {
				return c.json(
					{ error: "Not Found", message: "Eval case not found" },
					404,
				);
			}
			return c.json({ evalCase });
		});

		app.post("/internal/eval-cases/:id/results", async (c) => {
			const evalCaseId = c.req.param("id");
			if (!evalCaseId) return c.json(badRequest("id is required"), 400);

			let body: {
				runId?: unknown;
				passed?: unknown;
				score?: unknown;
				actualOutcome?: unknown;
				details?: unknown;
			};
			try {
				body = (await c.req.json()) as typeof body;
			} catch {
				return c.json(badRequest("body must be JSON"), 400);
			}

			if (body.passed === undefined || typeof body.passed !== "boolean") {
				return c.json(badRequest("passed must be a boolean"), 400);
			}

			const db = sqlDbFor(c.env);

			// Verify case exists
			const store = new EvalCasesStore(db);
			const evalCase = await store.getCase(getProjectId(c), evalCaseId);
			if (!evalCase) {
				return c.json(
					{ error: "Not Found", message: "Eval case not found" },
					404,
				);
			}

			const id = randomHex(16);
			const runId =
				typeof body.runId === "string" ? body.runId : `run_${randomHex(8)}`;
			const passed = body.passed ? 1 : 0;
			const score = typeof body.score === "number" ? body.score : null;
			const actualOutcome =
				typeof body.actualOutcome === "string" ? body.actualOutcome : null;
			const details_json = body.details ? JSON.stringify(body.details) : null;
			const now = new Date().toISOString();

			await db
				.prepare(
					`INSERT INTO eval_case_results (
					id, project_id, eval_case_id, run_id, passed, score, actual_outcome, details_json, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					id,
					getProjectId(c),
					evalCaseId,
					runId,
					passed,
					score,
					actualOutcome,
					details_json,
					now,
				)
				.run();

			return c.json(
				{
					evalCaseResult: {
						id,
						projectId: getProjectId(c),
						evalCaseId,
						runId,
						passed: body.passed,
						score,
						actualOutcome,
						details: body.details ?? null,
						createdAt: now,
					},
				},
				201,
			);
		});

		app.get("/internal/eval-cases/:id/results", async (c) => {
			const evalCaseId = c.req.param("id");
			if (!evalCaseId) return c.json(badRequest("id is required"), 400);

			const db = sqlDbFor(c.env);

			const rows = await db
				.prepare(
					`SELECT * FROM eval_case_results
				WHERE project_id = ? AND eval_case_id = ?
				ORDER BY created_at DESC`,
				)
				.bind(getProjectId(c), evalCaseId)
				.all<{
					id: string;
					project_id: string;
					eval_case_id: string;
					run_id: string;
					passed: number;
					score: number | null;
					actual_outcome: string | null;
					details_json: string | null;
					created_at: string;
				}>();

			const evalCaseResults = rows.results.map((row) => ({
				id: row.id,
				projectId: row.project_id,
				evalCaseId: row.eval_case_id,
				runId: row.run_id,
				passed: row.passed === 1,
				score: row.score,
				actualOutcome: row.actual_outcome,
				details: row.details_json ? JSON.parse(row.details_json) : null,
				createdAt: row.created_at,
			}));

			return c.json({ evalCaseResults });
		});
	},
};
