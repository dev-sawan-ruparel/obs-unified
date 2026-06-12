import type {
	EvidenceReference,
	EvidenceReferenceContract as EvidenceReferenceContractType,
	JsonValue,
} from "@obsunified/types";
import { EVIDENCE_REFERENCE_CONTRACT } from "@obsunified/types";
import { sourceLinkEvidenceReferences } from "./evidence-references";
import { randomHex } from "./hash";
import { parseJsonArray, parseJsonValue } from "./json";
import type { SqlDb } from "./sql-db";

export type EvalCaseSourceType =
	| "agent_run"
	| "action"
	| "ai_call"
	| "tool_call"
	| "trace";

export interface EvalCaseSourceLinks {
	sourceAgentRunId?: string | null;
	sourceActionId?: string | null;
	sourceAiCallId?: string | null;
	sourceToolCallId?: string | null;
	sourceTraceId?: string | null;
	sourceSpanId?: string | null;
}

export interface EvalCaseInput {
	sourceEntityType: EvalCaseSourceType;
	sourceEntityId: string;
	name: string;
	expectedOutcome?: string | null;
	rubric?: JsonValue | null;
	redactedPrompt?: JsonValue | null;
	referencePayload?: JsonValue | null;
	metadata?: Record<string, JsonValue>;
	source?: EvalCaseSourceLinks;
}

export interface EvalCase extends Required<EvalCaseSourceLinks> {
	id: string;
	projectId: string;
	sourceEntityType: EvalCaseSourceType;
	sourceEntityId: string;
	name: string;
	expectedOutcome: string | null;
	rubric: JsonValue | null;
	redactedPrompt: JsonValue | null;
	referencePayload: JsonValue | null;
	metadata: Record<string, JsonValue>;
	createdAt: string;
	updatedAt: string;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContractType;
}

export interface EvalCaseListOptions {
	projectId: string;
	sourceEntityType?: EvalCaseSourceType;
	sourceEntityId?: string;
	limit?: number;
}

export type EvalRunStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "canceled";

export interface EvalRunCandidate {
	agentId: string | null;
	agentVersion: string | null;
	promptId: string | null;
	promptVersion: string | null;
	modelProvider: string | null;
	model: string | null;
	modelVersion: string | null;
}

export interface EvalRunSourceCase {
	id: string;
	name: string;
	sourceEntityType: string;
	sourceEntityId: string;
	sourceAgentRunId: string | null;
	sourceActionId: string | null;
	sourceAiCallId: string | null;
	sourceToolCallId: string | null;
	sourceTraceId: string | null;
	sourceSpanId: string | null;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContractType;
}

export interface EvalRun {
	id: string;
	projectId: string;
	evalCaseId: string | null;
	status: EvalRunStatus;
	candidate: EvalRunCandidate;
	startedAt: string | null;
	endedAt: string | null;
	totalCount: number;
	passCount: number;
	failCount: number;
	averageScore: number | null;
	metadata: Record<string, JsonValue>;
	createdAt: string;
	sourceEvalCase?: EvalRunSourceCase | null;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContractType;
}

export interface EvalRunInput {
	id?: string;
	evalCaseId?: string | null;
	status?: EvalRunStatus;
	candidate?: Partial<EvalRunCandidate>;
	startedAt?: string | null;
	endedAt?: string | null;
	totalCount?: number;
	passCount?: number;
	failCount?: number;
	averageScore?: number | null;
	metadata?: Record<string, JsonValue>;
}

export interface EvalRunsListOptions {
	projectId: string;
	evalCaseId?: string;
	status?: EvalRunStatus;
	limit?: number;
}

interface EvalRunRow {
	id: string;
	project_id: string;
	eval_case_id: string | null;
	candidate_agent_id: string | null;
	candidate_agent_version: string | null;
	candidate_prompt_id: string | null;
	candidate_prompt_version: string | null;
	candidate_model_provider: string | null;
	candidate_model: string | null;
	candidate_model_version: string | null;
	status: string;
	started_at: string | null;
	ended_at: string | null;
	total_count: number;
	pass_count: number;
	fail_count: number;
	average_score: number | null;
	metadata_json: unknown;
	created_at: string;
	case_id?: string | null;
	case_name?: string | null;
	case_source_entity_type?: string | null;
	case_source_entity_id?: string | null;
	case_source_agent_run_id?: string | null;
	case_source_action_id?: string | null;
	case_source_ai_call_id?: string | null;
	case_source_tool_call_id?: string | null;
	case_source_trace_id?: string | null;
	case_source_span_id?: string | null;
}

interface EvalCaseRow {
	id: string;
	project_id: string;
	source_entity_type: string;
	source_entity_id: string;
	source_agent_run_id: string | null;
	source_action_id: string | null;
	source_ai_call_id: string | null;
	source_tool_call_id: string | null;
	source_trace_id: string | null;
	source_span_id: string | null;
	name: string;
	expected_outcome: string | null;
	rubric_json: unknown;
	redacted_prompt_json: unknown;
	reference_payload_json: unknown;
	metadata_json: unknown;
	created_at: string;
	updated_at: string;
}

interface ActionSourceRow {
	id: string;
	agent_run_id: string | null;
	tool_call_id: string | null;
	trace_id: string | null;
	span_id: string | null;
}

interface AiCallSourceRow {
	call_id: string;
	trace_id: string | null;
	span_id: string | null;
	request_json: unknown;
	response_json: unknown;
}

interface ToolCallSourceRow {
	id: string;
	action_id: string | null;
	tool_name: string | null;
	args_hash: string | null;
	result_hash: string | null;
	mcp_audit_json?: unknown;
	mutation_before_json?: unknown;
	mutation_after_json?: unknown;
	mutation_diff_json?: unknown;
	mutation_artifact_id?: string | null;
}

interface SpanSourceRow {
	trace_id: string;
	span_id: string;
}

interface PayloadRow {
	input_json: unknown;
	output_json: unknown;
}

interface RetrievalEventRow {
	documents_json: unknown;
}

export class EvalCaseSourceNotFoundError extends Error {
	constructor(
		readonly projectId: string,
		readonly sourceEntityType: EvalCaseSourceType,
		readonly sourceEntityId: string,
	) {
		super(
			`Source ${sourceEntityType}:${sourceEntityId} not found in project ${projectId}`,
		);
		this.name = "EvalCaseSourceNotFoundError";
	}
}

const SOURCE_TYPES: EvalCaseSourceType[] = [
	"agent_run",
	"action",
	"ai_call",
	"tool_call",
	"trace",
];

const EVAL_RUN_STATUSES: EvalRunStatus[] = [
	"pending",
	"running",
	"completed",
	"failed",
	"canceled",
];

export const isEvalCaseSourceType = (
	value: unknown,
): value is EvalCaseSourceType =>
	typeof value === "string" &&
	SOURCE_TYPES.includes(value as EvalCaseSourceType);

export const isEvalRunStatus = (value: unknown): value is EvalRunStatus =>
	typeof value === "string" &&
	EVAL_RUN_STATUSES.includes(value as EvalRunStatus);

const parseJsonField = (value: unknown): JsonValue | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return parseJsonValue(value);
	return value as JsonValue;
};

const parseJsonRecordField = (value: unknown): Record<string, JsonValue> => {
	const parsed = parseJsonField(value);
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as Record<string, JsonValue>)
		: {};
};

const jsonString = (value: JsonValue | null | undefined): string | null =>
	value === undefined || value === null ? null : JSON.stringify(value);

const compactLinks = (
	links: EvalCaseSourceLinks,
): Record<string, JsonValue> => {
	const out: Record<string, JsonValue> = {};
	if (links.sourceAgentRunId) out.agentRunId = links.sourceAgentRunId;
	if (links.sourceActionId) out.actionId = links.sourceActionId;
	if (links.sourceAiCallId) out.aiCallId = links.sourceAiCallId;
	if (links.sourceToolCallId) out.toolCallId = links.sourceToolCallId;
	if (links.sourceTraceId) out.traceId = links.sourceTraceId;
	if (links.sourceSpanId) out.spanId = links.sourceSpanId;
	return out;
};

const clampLimit = (limit: number | undefined): number =>
	Math.min(
		200,
		Math.max(1, Number.isFinite(limit ?? NaN) ? (limit ?? 50) : 50),
	);

const nonNegativeInteger = (value: number | undefined): number => {
	if (value === undefined) return 0;
	if (!Number.isFinite(value) || value < 0) {
		throw new Error("summary counters must be non-negative numbers");
	}
	return Math.floor(value);
};

const optionalScore = (value: number | null | undefined): number | null => {
	if (value === undefined || value === null) return null;
	if (!Number.isFinite(value)) throw new Error("averageScore must be a number");
	return value;
};

const evalCaseEvidenceReferences = (evalCase: EvalCase): EvidenceReference[] =>
	sourceLinkEvidenceReferences(
		{
			sourceLabel: `Eval case "${evalCase.name}"`,
			sourceId: evalCase.id,
			sourceKind: "eval_case",
			sourceRoute: `#/evaluations?case=${encodeURIComponent(evalCase.id)}`,
			sourceName: evalCase.name,
		},
		evalCase,
	);

export const rowToEvalCase = (row: EvalCaseRow): EvalCase => {
	const evalCase: EvalCase = {
		id: row.id,
		projectId: row.project_id,
		sourceEntityType: row.source_entity_type as EvalCaseSourceType,
		sourceEntityId: row.source_entity_id,
		sourceAgentRunId: row.source_agent_run_id ?? null,
		sourceActionId: row.source_action_id ?? null,
		sourceAiCallId: row.source_ai_call_id ?? null,
		sourceToolCallId: row.source_tool_call_id ?? null,
		sourceTraceId: row.source_trace_id ?? null,
		sourceSpanId: row.source_span_id ?? null,
		name: row.name,
		expectedOutcome: row.expected_outcome ?? null,
		rubric: parseJsonField(row.rubric_json),
		redactedPrompt: parseJsonField(row.redacted_prompt_json),
		referencePayload: parseJsonField(row.reference_payload_json),
		metadata: parseJsonRecordField(row.metadata_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	evalCase.evidenceReferences = evalCaseEvidenceReferences(evalCase);
	evalCase.evidenceContract = EVIDENCE_REFERENCE_CONTRACT;
	return evalCase;
};

const evalRunEvidenceReferences = (run: EvalRun): EvidenceReference[] => {
	if (!run.sourceEvalCase) return [];
	return sourceLinkEvidenceReferences(
		{
			sourceLabel: `Eval run "${run.id}"`,
			sourceId: run.id,
			sourceKind: "eval_run",
			sourceRoute: `#/evaluations?run=${encodeURIComponent(run.id)}`,
			sourceName: run.sourceEvalCase.name,
		},
		run.sourceEvalCase,
	);
};

const rowToEvalRun = (row: EvalRunRow): EvalRun => {
	const sourceEvalCase: EvalRunSourceCase | null =
		row.case_id && row.case_name
			? {
					id: row.case_id,
					name: row.case_name,
					sourceEntityType: row.case_source_entity_type ?? "",
					sourceEntityId: row.case_source_entity_id ?? "",
					sourceAgentRunId: row.case_source_agent_run_id ?? null,
					sourceActionId: row.case_source_action_id ?? null,
					sourceAiCallId: row.case_source_ai_call_id ?? null,
					sourceToolCallId: row.case_source_tool_call_id ?? null,
					sourceTraceId: row.case_source_trace_id ?? null,
					sourceSpanId: row.case_source_span_id ?? null,
				}
			: null;
	if (sourceEvalCase) {
		sourceEvalCase.evidenceReferences = sourceLinkEvidenceReferences(
			{
				sourceLabel: `Eval case "${sourceEvalCase.name}"`,
				sourceId: sourceEvalCase.id,
				sourceKind: "eval_case",
				sourceRoute: `#/evaluations?case=${encodeURIComponent(sourceEvalCase.id)}`,
				sourceName: sourceEvalCase.name,
			},
			sourceEvalCase,
		);
		sourceEvalCase.evidenceContract = EVIDENCE_REFERENCE_CONTRACT;
	}

	const run: EvalRun = {
		id: row.id,
		projectId: row.project_id,
		evalCaseId: row.eval_case_id ?? null,
		status: isEvalRunStatus(row.status) ? row.status : "pending",
		candidate: {
			agentId: row.candidate_agent_id ?? null,
			agentVersion: row.candidate_agent_version ?? null,
			promptId: row.candidate_prompt_id ?? null,
			promptVersion: row.candidate_prompt_version ?? null,
			modelProvider: row.candidate_model_provider ?? null,
			model: row.candidate_model ?? null,
			modelVersion: row.candidate_model_version ?? null,
		},
		startedAt: row.started_at ?? null,
		endedAt: row.ended_at ?? null,
		totalCount: row.total_count ?? 0,
		passCount: row.pass_count ?? 0,
		failCount: row.fail_count ?? 0,
		averageScore: row.average_score ?? null,
		metadata: parseJsonRecordField(row.metadata_json),
		createdAt: row.created_at,
		sourceEvalCase,
	};
	run.evidenceReferences = evalRunEvidenceReferences(run);
	run.evidenceContract = EVIDENCE_REFERENCE_CONTRACT;
	return run;
};

export class EvalCasesStore {
	constructor(private readonly db: SqlDb) {}

	async createCase(projectId: string, input: EvalCaseInput): Promise<EvalCase> {
		if (!projectId)
			throw new Error("EvalCasesStore.createCase: projectId is required");
		if (!isEvalCaseSourceType(input.sourceEntityType)) {
			throw new Error("sourceEntityType is invalid");
		}
		const sourceEntityId = input.sourceEntityId.trim();
		if (!sourceEntityId) throw new Error("sourceEntityId is required");
		const name = input.name.trim();
		if (!name) throw new Error("name is required");

		const hydrated = await this.hydrateSource(
			projectId,
			input.sourceEntityType,
			sourceEntityId,
			input.source ?? {},
		);
		const payload = await this.findPayload(projectId, hydrated.links);
		const autoMetadata = await this.buildMetadata(projectId, hydrated.links);
		const metadata = {
			...(input.metadata ?? {}),
			...autoMetadata,
			sourceLinks: compactLinks(hydrated.links),
		};
		const now = new Date().toISOString();
		const evalCase: EvalCase = {
			id: randomHex(16),
			projectId,
			sourceEntityType: input.sourceEntityType,
			sourceEntityId,
			sourceAgentRunId: hydrated.links.sourceAgentRunId ?? null,
			sourceActionId: hydrated.links.sourceActionId ?? null,
			sourceAiCallId: hydrated.links.sourceAiCallId ?? null,
			sourceToolCallId: hydrated.links.sourceToolCallId ?? null,
			sourceTraceId: hydrated.links.sourceTraceId ?? null,
			sourceSpanId: hydrated.links.sourceSpanId ?? null,
			name,
			expectedOutcome: input.expectedOutcome ?? null,
			rubric: input.rubric ?? null,
			redactedPrompt: input.redactedPrompt ?? payload?.input ?? null,
			referencePayload: input.referencePayload ?? payload?.output ?? null,
			metadata,
			createdAt: now,
			updatedAt: now,
		};
		evalCase.evidenceReferences = evalCaseEvidenceReferences(evalCase);

		await this.db
			.prepare(
				`INSERT INTO eval_cases (
					id, project_id, source_entity_type, source_entity_id,
					source_agent_run_id, source_action_id, source_ai_call_id,
					source_tool_call_id, source_trace_id, source_span_id,
					name, expected_outcome, rubric_json, redacted_prompt_json,
					reference_payload_json, metadata_json, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				evalCase.id,
				evalCase.projectId,
				evalCase.sourceEntityType,
				evalCase.sourceEntityId,
				evalCase.sourceAgentRunId,
				evalCase.sourceActionId,
				evalCase.sourceAiCallId,
				evalCase.sourceToolCallId,
				evalCase.sourceTraceId,
				evalCase.sourceSpanId,
				evalCase.name,
				evalCase.expectedOutcome,
				jsonString(evalCase.rubric),
				jsonString(evalCase.redactedPrompt),
				jsonString(evalCase.referencePayload),
				JSON.stringify(evalCase.metadata),
				evalCase.createdAt,
				evalCase.updatedAt,
			)
			.run();

		return evalCase;
	}

	async getCase(projectId: string, id: string): Promise<EvalCase | null> {
		const row = await this.db
			.prepare(
				`SELECT * FROM eval_cases WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, id)
			.first<EvalCaseRow>();
		return row ? rowToEvalCase(row) : null;
	}

	async listCases(options: EvalCaseListOptions): Promise<EvalCase[]> {
		if (!options.projectId)
			throw new Error("EvalCasesStore.listCases: projectId is required");
		const limit = clampLimit(options.limit);
		let sql = `SELECT * FROM eval_cases WHERE project_id = ?`;
		const params: unknown[] = [options.projectId];
		if (options.sourceEntityType) {
			sql += ` AND source_entity_type = ?`;
			params.push(options.sourceEntityType);
		}
		if (options.sourceEntityId) {
			sql += ` AND source_entity_id = ?`;
			params.push(options.sourceEntityId);
		}
		sql += ` ORDER BY created_at DESC LIMIT ?`;
		params.push(limit);

		const rows = await this.db
			.prepare(sql)
			.bind(...params)
			.all<EvalCaseRow>();
		return rows.results.map(rowToEvalCase);
	}

	async createRun(projectId: string, input: EvalRunInput): Promise<EvalRun> {
		if (!projectId)
			throw new Error("EvalCasesStore.createRun: projectId is required");
		const id = input.id?.trim() || `run_${randomHex(8)}`;
		const evalCaseId = input.evalCaseId?.trim() || null;
		const status = input.status ?? "running";
		if (!isEvalRunStatus(status)) throw new Error("status is invalid");
		if (evalCaseId) {
			const evalCase = await this.getCase(projectId, evalCaseId);
			if (!evalCase) throw new Error("evalCaseId does not reference a case");
		}

		const candidate = input.candidate ?? {};
		const totalCount = nonNegativeInteger(input.totalCount);
		const passCount = nonNegativeInteger(input.passCount);
		const failCount = nonNegativeInteger(input.failCount);
		const averageScore = optionalScore(input.averageScore);
		const now = new Date().toISOString();
		const startedAt =
			input.startedAt === undefined
				? status === "pending"
					? null
					: now
				: input.startedAt;
		const endedAt = input.endedAt ?? null;

		await this.db
			.prepare(
				`INSERT INTO eval_runs (
					id, project_id, eval_case_id,
					candidate_agent_id, candidate_agent_version,
					candidate_prompt_id, candidate_prompt_version,
					candidate_model_provider, candidate_model, candidate_model_version,
					status, started_at, ended_at,
					total_count, pass_count, fail_count, average_score,
					metadata_json, created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				projectId,
				evalCaseId,
				candidate.agentId ?? null,
				candidate.agentVersion ?? null,
				candidate.promptId ?? null,
				candidate.promptVersion ?? null,
				candidate.modelProvider ?? null,
				candidate.model ?? null,
				candidate.modelVersion ?? null,
				status,
				startedAt,
				endedAt,
				totalCount,
				passCount,
				failCount,
				averageScore,
				JSON.stringify(input.metadata ?? {}),
				now,
			)
			.run();

		const run = await this.getRun(projectId, id);
		if (!run) throw new Error("EvalCasesStore.createRun: insert failed");
		return run;
	}

	async getRun(projectId: string, id: string): Promise<EvalRun | null> {
		const row = await this.db
			.prepare(
				`${this.evalRunSelectSql()}
				WHERE r.project_id = ? AND r.id = ?
				LIMIT 1`,
			)
			.bind(projectId, id)
			.first<EvalRunRow>();
		return row ? rowToEvalRun(row) : null;
	}

	async listRuns(options: EvalRunsListOptions): Promise<EvalRun[]> {
		if (!options.projectId)
			throw new Error("EvalCasesStore.listRuns: projectId is required");
		if (options.status && !isEvalRunStatus(options.status)) {
			throw new Error("status is invalid");
		}
		const limit = clampLimit(options.limit);
		let sql = `${this.evalRunSelectSql()} WHERE r.project_id = ?`;
		const params: unknown[] = [options.projectId];
		if (options.evalCaseId) {
			sql += ` AND r.eval_case_id = ?`;
			params.push(options.evalCaseId);
		}
		if (options.status) {
			sql += ` AND r.status = ?`;
			params.push(options.status);
		}
		sql += ` ORDER BY r.created_at DESC LIMIT ?`;
		params.push(limit);

		const rows = await this.db
			.prepare(sql)
			.bind(...params)
			.all<EvalRunRow>();
		return rows.results.map(rowToEvalRun);
	}

	async refreshRunSummary(projectId: string, id: string): Promise<void> {
		const found = await this.db
			.prepare(
				`SELECT id FROM eval_runs WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, id)
			.first<{ id: string }>();
		if (!found) return;

		await this.db
			.prepare(
				`UPDATE eval_runs
				SET total_count = (
						SELECT COUNT(*) FROM eval_case_results
						WHERE project_id = ? AND run_id = ?
					),
					pass_count = (
						SELECT COUNT(*) FROM eval_case_results
						WHERE project_id = ? AND run_id = ? AND passed = 1
					),
					fail_count = (
						SELECT COUNT(*) FROM eval_case_results
						WHERE project_id = ? AND run_id = ? AND passed = 0
					),
					average_score = (
						SELECT AVG(score) FROM eval_case_results
						WHERE project_id = ? AND run_id = ? AND score IS NOT NULL
					)
				WHERE project_id = ? AND id = ?`,
			)
			.bind(
				projectId,
				id,
				projectId,
				id,
				projectId,
				id,
				projectId,
				id,
				projectId,
				id,
			)
			.run();
	}

	private evalRunSelectSql(): string {
		return `SELECT
			r.*,
			c.id AS case_id,
			c.name AS case_name,
			c.source_entity_type AS case_source_entity_type,
			c.source_entity_id AS case_source_entity_id,
			c.source_agent_run_id AS case_source_agent_run_id,
			c.source_action_id AS case_source_action_id,
			c.source_ai_call_id AS case_source_ai_call_id,
			c.source_tool_call_id AS case_source_tool_call_id,
			c.source_trace_id AS case_source_trace_id,
			c.source_span_id AS case_source_span_id
		FROM eval_runs r
		LEFT JOIN eval_cases c
			ON c.project_id = r.project_id AND c.id = r.eval_case_id`;
	}

	private async hydrateSource(
		projectId: string,
		sourceEntityType: EvalCaseSourceType,
		sourceEntityId: string,
		explicit: EvalCaseSourceLinks,
	): Promise<{ links: EvalCaseSourceLinks }> {
		const links: EvalCaseSourceLinks = { ...explicit };

		switch (sourceEntityType) {
			case "action": {
				const action = await this.getActionSource(projectId, sourceEntityId);
				if (!action)
					throw new EvalCaseSourceNotFoundError(
						projectId,
						sourceEntityType,
						sourceEntityId,
					);
				links.sourceActionId = action.id;
				links.sourceAgentRunId ??= action.agent_run_id;
				links.sourceToolCallId ??= action.tool_call_id;
				links.sourceTraceId ??= action.trace_id;
				links.sourceSpanId ??= action.span_id;
				break;
			}
			case "agent_run": {
				const found = await this.db
					.prepare(
						`SELECT id FROM agent_runs WHERE project_id = ? AND id = ? LIMIT 1`,
					)
					.bind(projectId, sourceEntityId)
					.first<{ id: string }>();
				if (!found)
					throw new EvalCaseSourceNotFoundError(
						projectId,
						sourceEntityType,
						sourceEntityId,
					);
				links.sourceAgentRunId = sourceEntityId;
				const action = await this.db
					.prepare(
						`SELECT id, agent_run_id, tool_call_id, trace_id, span_id
						FROM actions
						WHERE project_id = ? AND (id = ? OR agent_run_id = ?)
						ORDER BY started_at ASC LIMIT 1`,
					)
					.bind(projectId, sourceEntityId, sourceEntityId)
					.first<ActionSourceRow>();
				if (action) {
					links.sourceActionId ??= action.id;
					links.sourceTraceId ??= action.trace_id;
					links.sourceSpanId ??= action.span_id;
				}
				break;
			}
			case "ai_call": {
				const call = explicit.sourceTraceId
					? await this.db
							.prepare(
								`SELECT call_id, trace_id, span_id, request_json, response_json
								FROM ai_calls
								WHERE project_id = ?
									AND trace_id = ?
									AND (call_id = ? OR span_id = ?)
								LIMIT 1`,
							)
							.bind(
								projectId,
								explicit.sourceTraceId,
								sourceEntityId,
								sourceEntityId,
							)
							.first<AiCallSourceRow>()
					: await this.db
							.prepare(
								`SELECT call_id, trace_id, span_id, request_json, response_json
								FROM ai_calls
								WHERE project_id = ? AND (call_id = ? OR span_id = ?)
								LIMIT 1`,
							)
							.bind(projectId, sourceEntityId, sourceEntityId)
							.first<AiCallSourceRow>();
				if (!call)
					throw new EvalCaseSourceNotFoundError(
						projectId,
						sourceEntityType,
						sourceEntityId,
					);
				links.sourceAiCallId = call.call_id;
				links.sourceTraceId ??= call.trace_id;
				links.sourceSpanId ??= call.span_id;
				break;
			}
			case "tool_call": {
				const tool = await this.getToolCallSource(projectId, sourceEntityId);
				if (!tool)
					throw new EvalCaseSourceNotFoundError(
						projectId,
						sourceEntityType,
						sourceEntityId,
					);
				links.sourceToolCallId = tool.id;
				links.sourceActionId ??= tool.action_id;
				if (tool.action_id) {
					const action = await this.getActionSource(projectId, tool.action_id);
					links.sourceAgentRunId ??= action?.agent_run_id;
					links.sourceTraceId ??= action?.trace_id;
					links.sourceSpanId ??= action?.span_id;
				}
				break;
			}
			case "trace": {
				const span = await this.db
					.prepare(
						`SELECT trace_id, span_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id = ?
						ORDER BY start_time ASC LIMIT 1`,
					)
					.bind(projectId, sourceEntityId)
					.first<SpanSourceRow>();
				if (!span)
					throw new EvalCaseSourceNotFoundError(
						projectId,
						sourceEntityType,
						sourceEntityId,
					);
				links.sourceTraceId = span.trace_id;
				links.sourceSpanId ??= span.span_id;
				break;
			}
		}

		return { links };
	}

	private async getActionSource(
		projectId: string,
		actionId: string,
	): Promise<ActionSourceRow | null> {
		return this.db
			.prepare(
				`SELECT id, agent_run_id, tool_call_id, trace_id, span_id
				FROM actions
				WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, actionId)
			.first<ActionSourceRow>();
	}

	private async getToolCallSource(
		projectId: string,
		toolCallId: string,
	): Promise<ToolCallSourceRow | null> {
		return this.db
			.prepare(
				`SELECT id, action_id, tool_name, args_hash, result_hash,
					mcp_audit_json, mutation_before_json, mutation_after_json,
					mutation_diff_json, mutation_artifact_id
				FROM tool_calls
				WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, toolCallId)
			.first<ToolCallSourceRow>();
	}

	private async findPayload(
		projectId: string,
		links: EvalCaseSourceLinks,
	): Promise<{ input: JsonValue | null; output: JsonValue | null } | null> {
		let row: PayloadRow | null = null;
		if (links.sourceTraceId && links.sourceSpanId) {
			row = await this.db
				.prepare(
					`SELECT input_json, output_json
					FROM ai_span_payloads
					WHERE project_id = ? AND trace_id = ? AND span_id = ?
					LIMIT 1`,
				)
				.bind(projectId, links.sourceTraceId, links.sourceSpanId)
				.first<PayloadRow>();
		}
		if (!row && links.sourceActionId) {
			row = await this.db
				.prepare(
					`SELECT input_json, output_json
					FROM ai_span_payloads
					WHERE project_id = ? AND action_id = ?
					ORDER BY received_at DESC LIMIT 1`,
				)
				.bind(projectId, links.sourceActionId)
				.first<PayloadRow>();
		}
		if (!row && links.sourceTraceId) {
			row = await this.db
				.prepare(
					`SELECT input_json, output_json
					FROM ai_span_payloads
					WHERE project_id = ? AND trace_id = ?
					ORDER BY received_at DESC LIMIT 1`,
				)
				.bind(projectId, links.sourceTraceId)
				.first<PayloadRow>();
		}
		if (!row) return null;
		return {
			input: parseJsonField(row.input_json),
			output: parseJsonField(row.output_json),
		};
	}

	private async buildMetadata(
		projectId: string,
		links: EvalCaseSourceLinks,
	): Promise<Record<string, JsonValue>> {
		const linkedSpans: JsonValue[] = [];
		if (links.sourceTraceId && links.sourceSpanId) {
			linkedSpans.push({
				traceId: links.sourceTraceId,
				spanId: links.sourceSpanId,
			});
		}

		const toolHashes: JsonValue[] = [];
		if (links.sourceToolCallId) {
			const tool = await this.getToolCallSource(
				projectId,
				links.sourceToolCallId,
			);
			if (tool) toolHashes.push(toolHashMetadata(tool));
		} else if (links.sourceActionId) {
			const rows = await this.db
				.prepare(
					`SELECT id, action_id, tool_name, args_hash, result_hash,
						mcp_audit_json, mutation_before_json, mutation_after_json,
						mutation_diff_json, mutation_artifact_id
					FROM tool_calls
					WHERE project_id = ? AND action_id = ?
					LIMIT 25`,
				)
				.bind(projectId, links.sourceActionId)
				.all<ToolCallSourceRow>();
			for (const row of rows.results) {
				toolHashes.push(toolHashMetadata(row));
			}
		}

		const documentRefs: JsonValue[] = [];
		if (links.sourceActionId) {
			const rows = await this.db
				.prepare(
					`SELECT documents_json
					FROM retrieval_events
					WHERE project_id = ? AND action_id = ?
					LIMIT 25`,
				)
				.bind(projectId, links.sourceActionId)
				.all<RetrievalEventRow>();
			for (const row of rows.results) {
				for (const doc of parseJsonArray(
					typeof row.documents_json === "string"
						? row.documents_json
						: JSON.stringify(row.documents_json ?? []),
				)) {
					documentRefs.push(doc as JsonValue);
				}
			}
		}

		const metadata: Record<string, JsonValue> = {};
		if (linkedSpans.length > 0) metadata.linkedSpans = linkedSpans;
		if (toolHashes.length > 0) metadata.toolHashes = toolHashes;
		if (documentRefs.length > 0) metadata.documentRefs = documentRefs;
		return metadata;
	}
}

const toolHashMetadata = (tool: ToolCallSourceRow): JsonValue => {
	const metadata: Record<string, JsonValue> = {
		toolCallId: tool.id,
		toolName: tool.tool_name,
		argsHash: tool.args_hash,
		resultHash: tool.result_hash,
	};

	const mcpAudit = parseEvidenceJson(tool.mcp_audit_json);
	if (mcpAudit !== null) metadata.mcpAudit = mcpAudit;

	const mutationEvidence: Record<string, JsonValue> = {};
	const before = parseEvidenceJson(tool.mutation_before_json);
	const after = parseEvidenceJson(tool.mutation_after_json);
	const diff = parseEvidenceJson(tool.mutation_diff_json);
	if (before !== null) mutationEvidence.before = before;
	if (after !== null) mutationEvidence.after = after;
	if (diff !== null) mutationEvidence.diff = diff;
	if (tool.mutation_artifact_id) {
		mutationEvidence.artifactId = tool.mutation_artifact_id;
	}
	if (Object.keys(mutationEvidence).length > 0) {
		metadata.mutationEvidence = mutationEvidence;
	}

	return metadata;
};

const parseEvidenceJson = (value: unknown): JsonValue | null => {
	if (value === null || value === undefined) return null;
	if (typeof value === "string") return parseJsonValue(value);
	if (
		typeof value === "object" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value as JsonValue;
	}
	return null;
};
