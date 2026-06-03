import type { EvidenceReference, JsonValue } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import {
	type EvalCase,
	type EvalCaseInput,
	EvalCaseSourceNotFoundError,
	type EvalCaseSourceType,
	EvalCasesStore,
	type EvalRunInput,
	isEvalCaseSourceType,
	isEvalRunStatus,
} from "../lib/eval-cases-store";
import { sourceLinkEvidenceReferences } from "../lib/evidence-references";
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

interface EvalCaseResultResponse {
	id: string;
	projectId: string;
	evalCaseId: string;
	runId: string;
	passed: boolean;
	score: number | null;
	actualOutcome: string | null;
	details: unknown;
	createdAt: string;
	evidenceReferences?: EvidenceReference[];
}

interface EvalRunRequestBody {
	id?: unknown;
	runId?: unknown;
	evalCaseId?: unknown;
	status?: unknown;
	candidate?: unknown;
	startedAt?: unknown;
	endedAt?: unknown;
	totalCount?: unknown;
	passCount?: unknown;
	failCount?: unknown;
	averageScore?: unknown;
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

const asNonNegativeNumber = (value: unknown): number | undefined | null => {
	if (value === undefined) return undefined;
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: null;
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

const parseJsonMaybe = (value: unknown): unknown => {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? JSON.parse(value) : value;
};

const evalCaseResultEvidenceReferences = (
	evalCase: EvalCase,
	resultId: string,
): EvidenceReference[] =>
	sourceLinkEvidenceReferences(
		{
			sourceLabel: `Eval case result "${resultId}"`,
			sourceId: resultId,
			sourceKind: "eval_case_result",
			sourceRoute: `#/evaluations?case=${encodeURIComponent(evalCase.id)}&result=${encodeURIComponent(resultId)}`,
			sourceName: evalCase.name,
		},
		evalCase,
	);

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

		app.post("/internal/eval-runs", async (c) => {
			let body: EvalRunRequestBody;
			try {
				body = (await c.req.json()) as EvalRunRequestBody;
			} catch {
				return c.json(badRequest("body must be JSON"), 400);
			}

			const id = asOptionalString(body.id ?? body.runId)?.trim();
			if ((body.id ?? body.runId) !== undefined && !id) {
				return c.json(badRequest("id must be a non-empty string"), 400);
			}
			const evalCaseId = asOptionalString(body.evalCaseId)?.trim() || null;
			if (
				body.evalCaseId !== undefined &&
				body.evalCaseId !== null &&
				!evalCaseId
			) {
				return c.json(badRequest("evalCaseId must be a string"), 400);
			}
			const status = body.status ?? "running";
			if (!isEvalRunStatus(status)) {
				return c.json(badRequest("status is invalid"), 400);
			}
			const metadata = asRecord(body.metadata);
			if (metadata === null) {
				return c.json(badRequest("metadata must be a JSON object"), 400);
			}
			const candidate = asRecord(body.candidate);
			if (candidate === null) {
				return c.json(badRequest("candidate must be a JSON object"), 400);
			}

			const totalCount = asNonNegativeNumber(body.totalCount);
			const passCount = asNonNegativeNumber(body.passCount);
			const failCount = asNonNegativeNumber(body.failCount);
			const averageScore = asNonNegativeNumber(body.averageScore);
			if (totalCount === null) {
				return c.json(
					badRequest("totalCount must be a non-negative number"),
					400,
				);
			}
			if (passCount === null) {
				return c.json(
					badRequest("passCount must be a non-negative number"),
					400,
				);
			}
			if (failCount === null) {
				return c.json(
					badRequest("failCount must be a non-negative number"),
					400,
				);
			}
			if (averageScore === null && body.averageScore !== null) {
				return c.json(
					badRequest("averageScore must be a non-negative number"),
					400,
				);
			}

			const input: EvalRunInput = {
				id: id ?? undefined,
				evalCaseId,
				status,
				candidate: {
					agentId: asOptionalString(candidate.agentId),
					agentVersion: asOptionalString(candidate.agentVersion),
					promptId: asOptionalString(candidate.promptId),
					promptVersion: asOptionalString(candidate.promptVersion),
					modelProvider: asOptionalString(candidate.modelProvider),
					model: asOptionalString(candidate.model),
					modelVersion: asOptionalString(candidate.modelVersion),
				},
				startedAt: asOptionalString(body.startedAt),
				endedAt: asOptionalString(body.endedAt),
				totalCount: totalCount ?? undefined,
				passCount: passCount ?? undefined,
				failCount: failCount ?? undefined,
				averageScore: averageScore ?? null,
				metadata,
			};

			const store = new EvalCasesStore(sqlDbFor(c.env));
			try {
				const evalRun = await store.createRun(getProjectId(c), input);
				return c.json({ evalRun }, 201);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (message.includes("does not reference a case")) {
					return c.json({ error: "Not Found", message }, 404);
				}
				return c.json(badRequest(message), 400);
			}
		});

		app.get("/internal/eval-runs", async (c) => {
			const rawStatus = c.req.query("status");
			const status =
				rawStatus === undefined
					? undefined
					: isEvalRunStatus(rawStatus)
						? rawStatus
						: null;
			if (status === null) {
				return c.json(badRequest("status is invalid"), 400);
			}
			const store = new EvalCasesStore(sqlDbFor(c.env));
			const evalRuns = await store.listRuns({
				projectId: getProjectId(c),
				evalCaseId: c.req.query("evalCaseId"),
				status,
				limit: parseLimit(c.req.query("limit")),
			});
			return c.json({ evalRuns });
		});

		app.get("/internal/eval-runs/:id", async (c) => {
			const id = c.req.param("id");
			if (!id) return c.json(badRequest("id is required"), 400);
			const store = new EvalCasesStore(sqlDbFor(c.env));
			const evalRun = await store.getRun(getProjectId(c), id);
			if (!evalRun) {
				return c.json(
					{ error: "Not Found", message: "Eval run not found" },
					404,
				);
			}
			return c.json({ evalRun });
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
			const projectId = getProjectId(c);
			const evalCase = await store.getCase(getProjectId(c), evalCaseId);
			if (!evalCase) {
				return c.json(
					{ error: "Not Found", message: "Eval case not found" },
					404,
				);
			}

			const id = randomHex(16);
			const runId =
				typeof body.runId === "string" && body.runId.trim()
					? body.runId.trim()
					: `run_${randomHex(8)}`;
			const evalRun = await store.getRun(projectId, runId);
			if (evalRun?.evalCaseId && evalRun.evalCaseId !== evalCaseId) {
				return c.json(
					badRequest("runId belongs to a different eval case"),
					400,
				);
			}
			const passed = body.passed ? 1 : 0;
			const score =
				typeof body.score === "number" && Number.isFinite(body.score)
					? body.score
					: null;
			const actualOutcome =
				typeof body.actualOutcome === "string" ? body.actualOutcome : null;
			const details_json =
				body.details === undefined ? null : JSON.stringify(body.details);
			const now = new Date().toISOString();

			await db
				.prepare(
					`INSERT INTO eval_case_results (
					id, project_id, eval_case_id, run_id, passed, score, actual_outcome, details_json, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					id,
					projectId,
					evalCaseId,
					runId,
					passed,
					score,
					actualOutcome,
					details_json,
					now,
				)
				.run();

			if (evalRun) await store.refreshRunSummary(projectId, runId);
			const refreshedRun = evalRun
				? await store.getRun(projectId, runId)
				: null;
			const evalCaseResult: EvalCaseResultResponse = {
				id,
				projectId,
				evalCaseId,
				runId,
				passed: body.passed,
				score,
				actualOutcome,
				details: body.details ?? null,
				createdAt: now,
				evidenceReferences: evalCaseResultEvidenceReferences(evalCase, id),
			};

			return c.json(
				{
					evalCaseResult,
					evalRun: refreshedRun,
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

			const store = new EvalCasesStore(db);
			const evalCase = await store.getCase(getProjectId(c), evalCaseId);
			if (!evalCase) {
				return c.json(
					{ error: "Not Found", message: "Eval case not found" },
					404,
				);
			}

			const evalCaseResults: EvalCaseResultResponse[] = rows.results.map(
				(row) => ({
					id: row.id,
					projectId: row.project_id,
					evalCaseId: row.eval_case_id,
					runId: row.run_id,
					passed: row.passed === 1,
					score: row.score,
					actualOutcome: row.actual_outcome,
					details: parseJsonMaybe(row.details_json),
					createdAt: row.created_at,
					evidenceReferences: evalCaseResultEvidenceReferences(
						evalCase,
						row.id,
					),
				}),
			);

			return c.json({ evalCaseResults });
		});
	},
};
