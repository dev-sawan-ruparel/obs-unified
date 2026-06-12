import type {
	AICallRecord,
	AICallsOverviewOptions,
	AICallsOverviewResponse,
	AIEvaluationsListOptions,
	AIEvaluationsListResponse,
	AISessionDetailResponse,
	AISessionsListOptions,
	AISessionsListResponse,
	AISpansOverviewOptions,
	AISpansOverviewResponse,
} from "@obsunified/types";
import { getAICallsOverview, ingestAICallBatch } from "./ai-store/calls";
import {
	getAIEvaluation,
	ingestAIEvaluations,
	listAIEvaluations,
} from "./ai-store/evaluations";
import { purgeExpiredAIData } from "./ai-store/retention";
import { getAISessionDetail, listAISessions } from "./ai-store/sessions";
import { getAISpansOverview } from "./ai-store/spans";
import type { IngestEvaluation } from "./ai-store/types";
import type { SqlDb } from "./sql-db";

export type { IngestEvaluation } from "./ai-store/types";

export class AIStore {
	constructor(private readonly db: SqlDb) {}

	async ingestBatch(calls: AICallRecord[]): Promise<void> {
		return ingestAICallBatch(this.db, calls);
	}

	async getAICalls(
		options: AICallsOverviewOptions,
	): Promise<AICallsOverviewResponse> {
		return getAICallsOverview(this.db, options);
	}

	async purgeExpired(): Promise<number> {
		return purgeExpiredAIData(this.db);
	}

	async getAISpans(
		options: AISpansOverviewOptions,
	): Promise<AISpansOverviewResponse> {
		return getAISpansOverview(this.db, options);
	}

	async listSessions(
		options: AISessionsListOptions,
	): Promise<AISessionsListResponse> {
		return listAISessions(this.db, options);
	}

	async getSession(
		projectId: string,
		sessionId: string,
	): Promise<AISessionDetailResponse> {
		return getAISessionDetail(this.db, projectId, sessionId);
	}

	async ingestEvaluations(evaluations: IngestEvaluation[]): Promise<void> {
		return ingestAIEvaluations(this.db, evaluations);
	}

	async listEvaluations(
		options: AIEvaluationsListOptions,
	): Promise<AIEvaluationsListResponse> {
		return listAIEvaluations(this.db, options);
	}

	async getEvaluation(projectId: string, evaluationId: string) {
		return getAIEvaluation(this.db, projectId, evaluationId);
	}
}
