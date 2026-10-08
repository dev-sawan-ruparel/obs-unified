import type {
	ActionRef,
	AgentRunRef,
	ArtifactRef,
	EvalResultRef,
	RetrievalEventRef,
	ToolCallRef,
} from "./identity-index";
import {
	mapAction,
	mapAgentRun,
	mapArtifact,
	mapEvalResult,
	mapRetrievalEvent,
	mapToolCall,
} from "./identity-index/mappers";
import type { SqlDb } from "./sql-db";

export type ActionRecord = Omit<ActionRef, "projectId"> & {
	projectId: string;
};

export type AgentRunRecord = Omit<AgentRunRef, "projectId"> & {
	projectId: string;
};

export type ToolCallRecord = Omit<ToolCallRef, "projectId" | "sideEffect"> & {
	projectId: string;
	sideEffect: boolean | number;
};

export type RetrievalEventRecord = Omit<RetrievalEventRef, "projectId"> & {
	projectId: string;
};

export type EvalResultRecord = Omit<EvalResultRef, "projectId" | "passed"> & {
	projectId: string;
	passed: boolean | number;
};

export type ArtifactRecord = Omit<ArtifactRef, "projectId"> & {
	projectId: string;
};

export class ActionStore {
	constructor(private readonly db: SqlDb) {}

	async upsertAction(action: ActionRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO actions (
					id, project_id, root_action_id, caused_by_action_id, actor_type, actor_id,
					action_kind, name, status, started_at, ended_at, duration_ms, trace_id,
					span_id, session_id, interaction_id, user_id, agent_run_id, step_id,
					tool_call_id, prompt_version, model_name, provider, total_cost_usd,
					attrs_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					project_id = excluded.project_id,
					root_action_id = excluded.root_action_id,
					caused_by_action_id = excluded.caused_by_action_id,
					actor_type = excluded.actor_type,
					actor_id = excluded.actor_id,
					action_kind = excluded.action_kind,
					name = excluded.name,
					status = excluded.status,
					started_at = excluded.started_at,
					ended_at = excluded.ended_at,
					duration_ms = excluded.duration_ms,
					trace_id = excluded.trace_id,
					span_id = excluded.span_id,
					session_id = excluded.session_id,
					interaction_id = excluded.interaction_id,
					user_id = excluded.user_id,
					agent_run_id = excluded.agent_run_id,
					step_id = excluded.step_id,
					tool_call_id = excluded.tool_call_id,
					prompt_version = excluded.prompt_version,
					model_name = excluded.model_name,
					provider = excluded.provider,
					total_cost_usd = excluded.total_cost_usd,
					attrs_json = excluded.attrs_json
			`)
			.bind(
				action.id,
				action.projectId,
				action.rootActionId,
				action.causedByActionId,
				action.actorType,
				action.actorId,
				action.actionKind,
				action.name,
				action.status,
				action.startedAt,
				action.endedAt,
				action.durationMs,
				action.traceId,
				action.spanId,
				action.sessionId,
				action.interactionId,
				action.userId,
				action.agentRunId,
				action.stepId,
				action.toolCallId,
				action.promptVersion,
				action.modelName,
				action.provider,
				action.totalCostUsd,
				action.attrsJson,
			)
			.run();
	}

	async upsertAgentRun(run: AgentRunRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO agent_runs (
					id, project_id, agent_id, agent_name, agent_version, goal, outcome,
					autonomy_level, status, error_message, total_cost_usd,
					total_duration_ms, metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					project_id = excluded.project_id,
					agent_id = excluded.agent_id,
					agent_name = excluded.agent_name,
					agent_version = excluded.agent_version,
					goal = excluded.goal,
					outcome = excluded.outcome,
					autonomy_level = excluded.autonomy_level,
					status = excluded.status,
					error_message = excluded.error_message,
					total_cost_usd = excluded.total_cost_usd,
					total_duration_ms = excluded.total_duration_ms,
					metadata_json = excluded.metadata_json
			`)
			.bind(
				run.id,
				run.projectId,
				run.agentId,
				run.agentName,
				run.agentVersion,
				run.goal,
				run.outcome,
				run.autonomyLevel,
				run.status,
				run.errorMessage,
				run.totalCostUsd,
				run.totalDurationMs,
				run.metadataJson,
			)
			.run();
	}

	async upsertToolCall(toolCall: ToolCallRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO tool_calls (
					id, action_id, project_id, tool_name, args_hash, result_hash,
					error_type, side_effect, approval_state, args_redacted, result_redacted,
					mcp_audit_json, mutation_before_json, mutation_after_json,
					mutation_diff_json, mutation_artifact_id
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					action_id = excluded.action_id,
					project_id = excluded.project_id,
					tool_name = excluded.tool_name,
					args_hash = excluded.args_hash,
					result_hash = excluded.result_hash,
					error_type = excluded.error_type,
					side_effect = excluded.side_effect,
					approval_state = excluded.approval_state,
					args_redacted = excluded.args_redacted,
					result_redacted = excluded.result_redacted,
					mcp_audit_json = excluded.mcp_audit_json,
					mutation_before_json = excluded.mutation_before_json,
					mutation_after_json = excluded.mutation_after_json,
					mutation_diff_json = excluded.mutation_diff_json,
					mutation_artifact_id = excluded.mutation_artifact_id
			`)
			.bind(
				toolCall.id,
				toolCall.actionId,
				toolCall.projectId,
				toolCall.toolName,
				toolCall.argsHash,
				toolCall.resultHash,
				toolCall.errorType,
				toolCall.sideEffect ? 1 : 0,
				toolCall.approvalState,
				toolCall.argsRedacted,
				toolCall.resultRedacted,
				toolCall.mcpAuditJson,
				toolCall.mutationBeforeJson,
				toolCall.mutationAfterJson,
				toolCall.mutationDiffJson,
				toolCall.mutationArtifactId,
			)
			.run();
	}

	async upsertRetrievalEvent(event: RetrievalEventRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO retrieval_events (
					id, action_id, project_id, retriever_name, query_hash, documents_json,
					total_results, max_relevance_score, duration_ms
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					action_id = excluded.action_id,
					project_id = excluded.project_id,
					retriever_name = excluded.retriever_name,
					query_hash = excluded.query_hash,
					documents_json = excluded.documents_json,
					total_results = excluded.total_results,
					max_relevance_score = excluded.max_relevance_score,
					duration_ms = excluded.duration_ms
			`)
			.bind(
				event.id,
				event.actionId,
				event.projectId,
				event.retrieverName,
				event.queryHash,
				event.documentsJson,
				event.totalResults,
				event.maxRelevanceScore,
				event.durationMs,
			)
			.run();
	}

	async upsertEvalResult(result: EvalResultRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO eval_results (
					id, action_id, project_id, evaluator_name, evaluator_version, score,
					passed, reasoning, rubric_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					action_id = excluded.action_id,
					project_id = excluded.project_id,
					evaluator_name = excluded.evaluator_name,
					evaluator_version = excluded.evaluator_version,
					score = excluded.score,
					passed = excluded.passed,
					reasoning = excluded.reasoning,
					rubric_json = excluded.rubric_json
			`)
			.bind(
				result.id,
				result.actionId,
				result.projectId,
				result.evaluatorName,
				result.evaluatorVersion,
				result.score,
				result.passed ? 1 : 0,
				result.reasoning,
				result.rubricJson,
			)
			.run();
	}

	async upsertArtifact(artifact: ArtifactRecord): Promise<void> {
		await this.db
			.prepare(`
				INSERT INTO artifacts (
					id, action_id, project_id, artifact_name, artifact_type, storage_ref,
					size_bytes, sha256_hash, content_preview
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					action_id = excluded.action_id,
					project_id = excluded.project_id,
					artifact_name = excluded.artifact_name,
					artifact_type = excluded.artifact_type,
					storage_ref = excluded.storage_ref,
					size_bytes = excluded.size_bytes,
					sha256_hash = excluded.sha256_hash,
					content_preview = excluded.content_preview
			`)
			.bind(
				artifact.id,
				artifact.actionId,
				artifact.projectId,
				artifact.artifactName,
				artifact.artifactType,
				artifact.storageRef,
				artifact.sizeBytes,
				artifact.sha256Hash,
				artifact.contentPreview,
			)
			.run();
	}

	async getAction(
		projectId: string,
		actionId: string,
	): Promise<ActionRef | null> {
		const row = await this.db
			.prepare(`SELECT * FROM actions WHERE project_id = ? AND id = ? LIMIT 1`)
			.bind(projectId, actionId)
			.first<Parameters<typeof mapAction>[0]>();
		return row ? mapAction(row) : null;
	}

	async listActionsByRoot(
		projectId: string,
		rootActionId: string,
		limit = 100,
	): Promise<ActionRef[]> {
		const rows = await this.db
			.prepare(
				`SELECT * FROM actions
					WHERE project_id = ? AND root_action_id = ?
					ORDER BY started_at ASC LIMIT ?`,
			)
			.bind(projectId, rootActionId, limit)
			.all<Parameters<typeof mapAction>[0]>();
		return rows.results.map(mapAction);
	}

	async getAgentRun(
		projectId: string,
		agentRunId: string,
	): Promise<AgentRunRef | null> {
		const row = await this.db
			.prepare(
				`SELECT * FROM agent_runs WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, agentRunId)
			.first<Parameters<typeof mapAgentRun>[0]>();
		return row ? mapAgentRun(row) : null;
	}

	async listToolCallsByAction(
		projectId: string,
		actionId: string,
		limit = 100,
	): Promise<ToolCallRef[]> {
		const rows = await this.db
			.prepare(
				`SELECT * FROM tool_calls
					WHERE project_id = ? AND action_id = ?
					LIMIT ?`,
			)
			.bind(projectId, actionId, limit)
			.all<Parameters<typeof mapToolCall>[0]>();
		return rows.results.map(mapToolCall);
	}

	async listRetrievalEventsByAction(
		projectId: string,
		actionId: string,
		limit = 100,
	): Promise<RetrievalEventRef[]> {
		const rows = await this.db
			.prepare(
				`SELECT * FROM retrieval_events
					WHERE project_id = ? AND action_id = ?
					LIMIT ?`,
			)
			.bind(projectId, actionId, limit)
			.all<Parameters<typeof mapRetrievalEvent>[0]>();
		return rows.results.map(mapRetrievalEvent);
	}

	async listEvalResultsByAction(
		projectId: string,
		actionId: string,
		limit = 100,
	): Promise<EvalResultRef[]> {
		const rows = await this.db
			.prepare(
				`SELECT * FROM eval_results
					WHERE project_id = ? AND action_id = ?
					LIMIT ?`,
			)
			.bind(projectId, actionId, limit)
			.all<Parameters<typeof mapEvalResult>[0]>();
		return rows.results.map(mapEvalResult);
	}

	async listArtifactsByAction(
		projectId: string,
		actionId: string,
		limit = 100,
	): Promise<ArtifactRef[]> {
		const rows = await this.db
			.prepare(
				`SELECT * FROM artifacts
					WHERE project_id = ? AND action_id = ?
					LIMIT ?`,
			)
			.bind(projectId, actionId, limit)
			.all<Parameters<typeof mapArtifact>[0]>();
		return rows.results.map(mapArtifact);
	}
}
