import {
	manifestByAction,
	manifestByActor,
	manifestByAgentRun,
} from "./identity-index/action-lookups";
import {
	manifestByInteraction,
	manifestBySession,
	manifestByTrace,
} from "./identity-index/key-lookups";
import type {
	EntityManifest,
	EntityManifestExtended,
} from "./identity-index/types";
import { manifestByUser } from "./identity-index/user-lookup";
import type { SqlDb } from "./sql-db";

export type {
	ActionRef,
	AgentRunRef,
	AICallRef,
	ArtifactRef,
	EntityManifest,
	EntityManifestExtended,
	EvalResultRef,
	LogRef,
	MetricExemplarRef,
	ReplayRef,
	RetrievalEventRef,
	SpanRef,
	ToolCallRef,
	UsageEventRef,
} from "./identity-index/types";

export class IdentityIndex {
	constructor(private readonly db: SqlDb) {}

	async bySession(
		projectId: string,
		sessionId: string,
	): Promise<EntityManifest> {
		return manifestBySession(this.db, projectId, sessionId);
	}

	async byTrace(projectId: string, traceId: string): Promise<EntityManifest> {
		return manifestByTrace(this.db, projectId, traceId);
	}

	async byInteraction(
		projectId: string,
		interactionId: string,
	): Promise<EntityManifest> {
		return manifestByInteraction(this.db, projectId, interactionId);
	}

	async byUser(
		projectId: string,
		userId: string,
		opts: { limit?: number; sessions?: number } = {},
	): Promise<EntityManifest> {
		return manifestByUser(this.db, projectId, userId, opts);
	}

	async byAction(
		projectId: string,
		actionId: string,
	): Promise<EntityManifestExtended> {
		return manifestByAction(this.db, projectId, actionId);
	}

	async byAgentRun(
		projectId: string,
		agentRunId: string,
	): Promise<EntityManifestExtended> {
		return manifestByAgentRun(this.db, projectId, agentRunId);
	}

	async byActor(
		projectId: string,
		actorType: string,
		actorId: string,
	): Promise<EntityManifestExtended> {
		return manifestByActor(this.db, projectId, actorType, actorId);
	}
}
