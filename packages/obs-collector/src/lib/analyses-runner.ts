/**
 * RFC 0002 Stage 1 — runner that executes SQL-only Analyses on the existing
 * scheduled handler.
 *
 * runSqlAnalysis  — execute one definition's `sql` against D1 and shape the
 *                   row(s) into an AnalysisResult.
 * runAllDueAnalyses — orchestrator: refresh the in-process registry into
 *                   analysis_definitions, find which ones are due, run them,
 *                   persist the results. Per-analysis errors are isolated
 *                   via Promise.allSettled so one bad SQL doesn't kill the
 *                   batch.
 *
 * Result shape convention: an Analysis SQL is expected to return a single
 * row with the columns:
 *
 *   status         TEXT  | NULL  -- 'ok' | 'warn' | 'critical' | 'unknown'
 *   primary_value  REAL  | NULL
 *   baseline_value REAL  | NULL
 *   payload        TEXT  | NULL  -- JSON-serialized object, optional
 *
 * If `status` is NULL we derive it from the magnitude of delta_pct
 * (>=25% → critical, >=10% → warn, else ok). delta_pct itself is computed
 * here from primary/baseline so individual SQL queries don't have to.
 */

import type {
	AnalysisDefinition,
	AnalysisResult,
	AnalysisStatus,
} from "@obs-unified/types";
import { getAllAnalysesForProject } from "../analyses/index";
import type { CollectorEnv } from "../framework/env";
import {
	type ChildSpanRunner,
	consoleLogger,
	type Logger,
} from "../framework/logger";
import { AnalysesStore } from "./analyses-store";
import { generateNarrative, LlmCallError, type LlmConfig } from "./llm";
import {
	computeSignature,
	evaluateGate,
	type NarrativeIntent,
} from "./narrate-gate";
import { type SqlDb, sqlDbFor } from "./sql-db";

export interface AnalysisRunContext {
	db: SqlDb;
	projectId: string;
	retentionHours: number;
	/** Stage 3: narrative LLM config. Undefined = narratives disabled. */
	llm?: LlmConfig;
	/** Stage 3: max narrative-writes per project per hour. Default 50. */
	narrativeBudgetPerHour?: number;
	/** Pluggable logger; defaults to console. */
	logger?: Logger;
}

interface AnalysisSqlRow {
	status?: string | null;
	primary_value?: number | null;
	baseline_value?: number | null;
	payload?: string | null;
}

const VALID_STATUSES: ReadonlySet<AnalysisStatus> = new Set([
	"ok",
	"warn",
	"critical",
	"unknown",
]);

const deriveStatus = (deltaPct: number | null): AnalysisStatus => {
	if (deltaPct === null || !Number.isFinite(deltaPct)) return "unknown";
	const magnitude = Math.abs(deltaPct);
	if (magnitude >= 25) return "critical";
	if (magnitude >= 10) return "warn";
	return "ok";
};

const computeDeltaPct = (
	primary: number | null,
	baseline: number | null,
): number | null => {
	if (
		primary === null ||
		baseline === null ||
		!Number.isFinite(primary) ||
		!Number.isFinite(baseline) ||
		baseline === 0
	) {
		return null;
	}
	return ((primary - baseline) / baseline) * 100;
};

const parsePayload = (
	payload: string | null | undefined,
): Record<string, unknown> => {
	if (!payload) return {};
	try {
		const parsed = JSON.parse(payload) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

export async function runSqlAnalysis(
	def: AnalysisDefinition,
	ctx: AnalysisRunContext,
): Promise<AnalysisResult> {
	if (!def.sql)
		throw new Error(
			`Analysis "${def.id}" has no sql; cannot run as SQL analysis`,
		);

	const startedAt = Date.now();
	// Contract with Agent 2's analysis derivation:
	//   - Tier 0 SQL is static and references the literal token {{PROJECT_ID}};
	//     the runner string-replaces it before execution.
	//   - Tier 1 SQL bakes the project_id in at derivation time (escaped via
	//     SQL '' quoting) and contains no token.
	// Either way, queries expect zero ? bindings. project_id is collector-
	// internal (never user-supplied), but we still validate the shape to keep
	// future user-defined SQL safe from token-replacement injection.
	if (!/^[A-Za-z0-9_-]+$/.test(ctx.projectId)) {
		throw new Error(
			`refusing to run analysis: unsafe project_id ${ctx.projectId}`,
		);
	}
	const sqlWithProject = def.sql.replace(/\{\{PROJECT_ID\}\}/g, ctx.projectId);
	const row = await ctx.db.prepare(sqlWithProject).first<AnalysisSqlRow>();

	const primaryValue =
		row && typeof row.primary_value === "number" ? row.primary_value : null;
	const baselineValue =
		row && typeof row.baseline_value === "number" ? row.baseline_value : null;
	const deltaPct = computeDeltaPct(primaryValue, baselineValue);

	const rawStatus = row?.status;
	const status: AnalysisStatus =
		rawStatus && VALID_STATUSES.has(rawStatus as AnalysisStatus)
			? (rawStatus as AnalysisStatus)
			: deriveStatus(deltaPct);

	const generatedAt = new Date().toISOString();

	const payload = parsePayload(row?.payload);
	const narrativeSignature = computeSignature({
		status,
		primaryValue,
		baselineValue,
		payload,
	});

	return {
		analysisId: def.id,
		projectId: ctx.projectId,
		generatedAt,
		paramsHash: null,
		status,
		primaryValue,
		baselineValue,
		deltaPct,
		payload,
		narrative: null,
		narrativeSignature,
		durationMs: Date.now() - startedAt,
	};
}

/**
 * RFC 0002 Stage 3 — narrate pass. Decides whether to call the LLM,
 * reuse a cached narrative, or skip; mutates the result in place.
 *
 * Budget is checked once at call time (not pre-decided per panel) so
 * the runner doesn't waste effort computing gates for analyses that
 * won't get a turn anyway. `[narrate]` log lines are the operator's
 * audit trail for "why didn't this panel narrate?".
 */
async function narratePass(
	def: AnalysisDefinition,
	current: AnalysisResult,
	previous: AnalysisResult | null,
	ctx: AnalysisRunContext,
	_store: AnalysesStore,
	budgetState: { remaining: number },
): Promise<void> {
	if (!def.narrate) return;
	if (!ctx.llm) return;

	const intent: NarrativeIntent = evaluateGate(def.narrate.only_when, {
		current,
		previous,
	});

	if (intent === "skip") return;

	if (intent === "reuse" && previous?.narrative) {
		current.narrative = previous.narrative;
		// Keep the previous signature so subsequent runs continue to compare
		// against the state that produced this narrative.
		current.narrativeSignature = previous.narrativeSignature;
		return;
	}

	if (intent !== "call") return;

	if (budgetState.remaining <= 0) {
		(ctx.logger ?? consoleLogger).warn("[narrate] budget exhausted", {
			analysis_id: def.id,
		});
		if (previous?.narrative) {
			current.narrative = previous.narrative;
			current.narrativeSignature = previous.narrativeSignature;
		}
		return;
	}

	try {
		budgetState.remaining -= 1;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20_000);
		const text = await generateNarrative(
			{ definition: def, current, previous },
			{ ...ctx.llm, signal: controller.signal },
		).finally(() => clearTimeout(timeout));
		current.narrative = text;
		// Keep the just-computed signature so cache compare works next run.
	} catch (error) {
		const msg =
			error instanceof LlmCallError
				? `${error.message}`
				: error instanceof Error
					? error.message
					: String(error);
		(ctx.logger ?? consoleLogger).error("[narrate] LLM call failed", {
			analysis_id: def.id,
			error: msg,
		});
		if (previous?.narrative) {
			current.narrative = previous.narrative;
			current.narrativeSignature = previous.narrativeSignature;
		}
	}
}

/**
 * Orchestrator. Refreshes the analysis_definitions registry from the
 * in-process registry (so newly-derived Tier 1 analyses become visible
 * to the dashboard within one tick), then runs whatever's due.
 *
 * Stage 1 has a single project ("default"). When a projects table is
 * available we'll iterate it here.
 */
export async function runAllDueAnalyses(
	ctx: {
		env: CollectorEnv;
		retentionHours: number;
		logger?: Logger;
		tracer?: ChildSpanRunner;
	},
	_runtime?: unknown,
): Promise<{
	ran: number;
	failed: number;
	refreshed: number;
	narrated: number;
	skipped?: number;
}> {
	const logger = ctx.logger ?? consoleLogger;
	const db = sqlDbFor(ctx.env);
	const store = new AnalysesStore(db);
	const projectId = "default";
	const now = Date.now();
	const expiresAt = now + ctx.retentionHours * 3600 * 1000;

	// 1. Refresh the registry — Agent 2's getAllAnalysesForProject builds the
	//    union of Tier 0 + derived Tier 1 + user-defined analyses.
	let registered: AnalysisDefinition[] = [];
	try {
		registered = await getAllAnalysesForProject(projectId, {
			db,
		});
	} catch (error) {
		logger.error("[analyses] failed to load registered analyses", {
			project_id: projectId,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	let refreshed = 0;
	for (const def of registered) {
		try {
			await store.upsertDefinition(projectId, def);
			refreshed += 1;
		} catch (error) {
			logger.error("[analyses] upsertDefinition failed", {
				analysis_id: def.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// 2. Find what's due and run them.
	const due = await store.getDueAnalyses(projectId, now);
	if (due.length === 0) {
		return { ran: 0, failed: 0, refreshed, narrated: 0 };
	}

	// Narrative LLM config — present only when an API key is set on the
	// worker. We don't fail the run if it's missing; we just skip the
	// narrate pass entirely (every panel still produces numbers).
	//
	// Provider preference: OpenAI wins when both keys are set — configuring
	// both is presumed deliberate. Empty-string env values from .dev.vars
	// are coerced to undefined so they don't accidentally override defaults.
	const openaiBase = ctx.env.OPENAI_BASE_URL?.trim()
		? ctx.env.OPENAI_BASE_URL
		: undefined;
	const narrativeModel = ctx.env.NARRATIVE_MODEL?.trim()
		? ctx.env.NARRATIVE_MODEL
		: undefined;
	const llm: LlmConfig | undefined = ctx.env.OPENAI_API_KEY?.trim()
		? {
				provider: "openai",
				apiKey: ctx.env.OPENAI_API_KEY,
				model: narrativeModel ?? "gpt-4o-mini",
				apiUrl: openaiBase,
				tracer: ctx.tracer,
			}
		: ctx.env.ANTHROPIC_API_KEY?.trim()
			? {
					provider: "anthropic",
					apiKey: ctx.env.ANTHROPIC_API_KEY,
					model: narrativeModel ?? "claude-3-5-haiku-latest",
					tracer: ctx.tracer,
				}
			: undefined;
	const parsedNarrativeBudget = Number.parseInt(
		ctx.env.NARRATIVE_BUDGET_PER_HOUR ?? "",
		10,
	);
	const narrativeBudgetPerHour = Number.isFinite(parsedNarrativeBudget)
		? parsedNarrativeBudget
		: 50;
	const narrativesUsed = llm
		? await store.countNarrativesInWindow(projectId, 60)
		: 0;
	const budgetState = {
		remaining: Math.max(0, narrativeBudgetPerHour - narrativesUsed),
	};

	const runCtx: AnalysisRunContext = {
		db,
		projectId,
		retentionHours: ctx.retentionHours,
		llm,
		narrativeBudgetPerHour,
		logger,
	};

	// Run with bounded concurrency. D1 is happy with a handful of parallel
	// queries; 45 in flight at once causes the Workers scheduled handler
	// to hit its CPU/wall-time cap before any results land. We also log
	// per-analysis so a stuck SQL is identifiable in the log rather than
	// silently swallowed.
	const CONCURRENCY = 4;
	// Lease window for the per-analysis claim. Long enough that a healthy
	// narrative pass (LLM roundtrip + result insert) won't get rerun by the
	// next tick, short enough that a worker crash unblocks the row within
	// two ticks. 90 s sits between the every-minute cron and a typical LLM
	// p95.
	const CLAIM_LEASE_MS = 90_000;
	let ran = 0;
	let failed = 0;
	let skipped = 0;
	let narrated = 0;
	const queue = [...due];
	const workers: Promise<void>[] = [];
	for (let w = 0; w < CONCURRENCY; w += 1) {
		workers.push(
			(async () => {
				while (queue.length > 0) {
					const def = queue.shift();
					if (!def) return;
					const claimed = await store.claimAnalysis(
						projectId,
						def.id,
						Date.now(),
						CLAIM_LEASE_MS,
					);
					if (!claimed) {
						skipped += 1;
						logger.info("[analyses] skipped (lease held by another tick)", {
							analysis_id: def.id,
						});
						continue;
					}
					try {
						const result = await runSqlAnalysis(def, runCtx);
						// Stage 3: narrate pass. Reads previous result from D1 to
						// run gate logic + signature cache; isolated from query
						// failures so a flaky LLM doesn't drop the data row.
						if (def.narrate && runCtx.llm) {
							const previous = await store.getLatestResult(projectId, def.id);
							await narratePass(
								def,
								result,
								previous,
								runCtx,
								store,
								budgetState,
							);
							if (result.narrative) narrated += 1;
						}
						await store.insertResult(result, expiresAt);
						// markRan releases the claim as a side-effect.
						await store.markRan(projectId, def.id, result.generatedAt);
						ran += 1;
					} catch (error) {
						failed += 1;
						await store.releaseClaim(projectId, def.id);
						logger.error("[analyses] analysis failed", {
							analysis_id: def.id,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}
			})(),
		);
	}
	await Promise.all(workers);

	return { ran, failed, refreshed, narrated, skipped };
}
