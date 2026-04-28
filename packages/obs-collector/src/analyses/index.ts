// RFC 0002 Stage 1 — Analysis catalog entry point.
//
// Combines static Tier 0 (universal) analyses with dynamically derived
// Tier 1 analyses. Agent 1's runner imports `getAllAnalysesForProject`
// to pick up the active set for a project on each scheduler tick. Tier 2
// (user-defined / LLM-suggested) analyses live in `analysis_definitions`
// directly and are merged in by the runner, not here.

import type { AnalysisDefinition } from "@obs/types";

import { deriveAnalysesForProject } from "./derive";
import { INVESTIGATION_ANALYSES } from "./investigations";
import { TIER0_ANALYSES } from "./tier0";

interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

export interface AnalysisContext {
	db: D1Database;
}

export const getAllAnalysesForProject = async (
	projectId: string,
	ctx: AnalysisContext,
): Promise<AnalysisDefinition[]> => {
	const tier1 = await deriveAnalysesForProject(projectId, ctx.db);
	return [...TIER0_ANALYSES, ...INVESTIGATION_ANALYSES, ...tier1];
};

export { TIER0_ANALYSES } from "./tier0";
export { INVESTIGATION_ANALYSES } from "./investigations";
export { deriveAnalysesForProject } from "./derive";
