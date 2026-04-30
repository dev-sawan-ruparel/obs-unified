// RFC 0002 Stage 1 — Analysis catalog entry point.
//
// Combines static Tier 0 (universal) analyses with dynamically derived
// Tier 1 analyses. Agent 1's runner imports `getAllAnalysesForProject`
// to pick up the active set for a project on each scheduler tick. Tier 2
// (user-defined / LLM-suggested) analyses live in `analysis_definitions`
// directly and are merged in by the runner, not here.
//
// Stage 6 augments the merge with auto-pinning: the top analyses cited
// by the Ask box over the past week get a `pinned: true` flag the
// dashboard groups separately at the top of the Health tab.

import type { AnalysisDefinition } from "@obs/types";

import { AnalysesStore } from "../lib/analyses-store";
import { deriveAnalysesForProject } from "./derive";
import { INVESTIGATION_ANALYSES } from "./investigations";
import { TIER0_ANALYSES } from "./tier0";

// We accept the worker-runtime D1Database here, but only use prepare/bind/all,
// so a structural subtype keeps obs-collector tests free of cloudflare types.
interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	run(): Promise<unknown>;
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
	const all = [...TIER0_ANALYSES, ...INVESTIGATION_ANALYSES, ...tier1];

	// Stage 6 — fold in the auto-pinned set. We tolerate failures on the
	// pin lookup (e.g. fresh install before migration 025) so registry
	// loading never breaks because the optional signal is missing.
	let pinnedIds = new Set<string>();
	try {
		// biome-ignore lint/suspicious/noExplicitAny: structural D1 vs runtime D1
		const store = new AnalysesStore(ctx.db as any);
		const top = await store.getTopAskedAnalyses(projectId);
		pinnedIds = new Set(top.map((t) => t.analysisId));
	} catch {
		// no-op
	}

	if (pinnedIds.size === 0) return all;
	return all.map((d) =>
		pinnedIds.has(d.id) ? { ...d, pinned: true } : d,
	);
};

export { TIER0_ANALYSES } from "./tier0";
export { INVESTIGATION_ANALYSES } from "./investigations";
export { deriveAnalysesForProject } from "./derive";
