import type { EvidenceReference } from "./evidence";

export type AnalysisStatus = "ok" | "warn" | "critical" | "unknown";
export type AnalysisView = "tile" | "page" | "alert";
export type AnalysisSource = "tier0" | "tier1" | "user" | "llm-suggested";

/**
 * Capability-based grouping for the Health tab. Determined at registration
 * time; the dashboard uses these as section headers.
 */
export type AnalysisGroup =
	| "Health"
	| "Services"
	| "Dependencies"
	| "Async"
	| "AI"
	| "Frontend"
	| "Custom";

/**
 * Narrative spec — the prompt the LLM gets and the gate predicate that
 * decides whether to call the LLM at all on a given run.
 *
 * Gate predicate language (mini DSL evaluated in `narrate-gate.ts`):
 *
 *   status_changed         status moved between {ok,warn,critical,unknown}
 *   delta_pct>N            |primary - baseline| / baseline × 100 > N
 *   delta_pct>=N            (and >, <, <=, !=, == — N is a number)
 *   signature_changed      narrativeSignature differs from previous result's
 *   always                 never gate (use sparingly)
 *   never                  never narrate (equivalent to omitting the spec)
 *   <a> && <b>             both must hold
 *   <a> || <b>             either holds
 *
 * The first run of a panel always narrates if the spec is present and
 * not `never`, since there's no previous to compare against.
 */
export interface NarrativeSpec {
	/**
	 * Prompt template. {{title}}, {{primary}}, {{baseline}}, {{delta_pct}},
	 * {{status}}, {{trace_ids}}, {{service}} are substituted from the result
	 * before the LLM call. Keep it ≤2 sentences worth of guidance — the
	 * system prompt enforces declarative tone, citation, and time anchor.
	 */
	prompt: string;
	/**
	 * Gate predicate string. See language above. Default: `status_changed`.
	 */
	only_when?: string;
}

/**
 * The persisted definition of an Analysis. SQL-only analyses (Stage 1)
 * carry their query string here; analyses that compute via Polars / LLM
 * (later stages) point at a handler id instead.
 */
export interface AnalysisDefinition {
	id: string;
	title: string;
	group: AnalysisGroup;
	source: AnalysisSource;
	view: AnalysisView;
	/** Refresh interval in seconds. 0 / undefined = on-demand only. */
	refreshSeconds?: number;
	/** Stage 1: literal SQL string. Later stages add `handler: string` for sidecar dispatch. */
	sql?: string;
	/** JSON-serializable metadata about scope (e.g. service name, edge endpoints). */
	scope?: Record<string, unknown>;
	/** Stage 3: optional narrative spec. Absent = panel never narrates. */
	narrate?: NarrativeSpec;
	/**
	 * Stage 6: derived flag. `true` means the analysis is currently in the
	 * dashboard's auto-pinned set (top-cited by the Ask box over the past
	 * week). Computed at registry-load time; not persisted in the database.
	 */
	pinned?: boolean;
}

/**
 * Result of running an Analysis once. Persisted to `analysis_results` and
 * read by the dashboard. Stage 1 leaves `narrative` and `narrativeSignature`
 * as `null` — they fill in at Stage 3.
 */
export interface AnalysisResult {
	analysisId: string;
	projectId: string;
	generatedAt: string;
	paramsHash: string | null;
	status: AnalysisStatus;
	primaryValue: number | null;
	baselineValue: number | null;
	deltaPct: number | null;
	payload: Record<string, unknown>;
	narrative: string | null;
	narrativeSignature: string | null;
	durationMs: number;
	evidenceReferences?: EvidenceReference[];
}

export interface AnalysesListResponse {
	analyses: AnalysisDefinition[];
	timestamp: string;
}

export interface AnalysisResultResponse {
	definition: AnalysisDefinition;
	result: AnalysisResult | null;
	timestamp: string;
}

export interface AnalysisResultsBulkResponse {
	results: Array<{
		definition: AnalysisDefinition;
		result: AnalysisResult | null;
	}>;
	timestamp: string;
}

/**
 * RFC 0002 Stage 5 — Ask box. Quick-ask single-turn shape.
 *
 * The dashboard sends `{ question }`, the collector runs an LLM tool-use
 * loop (currently with two tools: `list_analyses`, `run_analysis`), and
 * returns:
 *   - `answer`: one or two declarative sentences citing the analyses
 *     it consulted. Subject to the same rendering rules as panel
 *     narratives (no first-person, time anchor, ≤2 sentences).
 *   - `evidence`: the analysis id + result for each `run_analysis` call
 *     the model made. The UI links these so users can click through.
 *   - `queries`: a flat audit log of the tool calls. Powers the "Show
 *     the queries I ran" expander; users build trust by spot-checking.
 *   - `error`: populated when the loop bailed (no API key, model
 *     timeout, iteration cap). `answer` will be null in that case.
 */
export interface AskQuery {
	tool: "list_analyses" | "run_analysis";
	args: Record<string, unknown>;
	durationMs: number;
}

export interface AskEvidence {
	analysisId: string;
	result: AnalysisResult | null;
	definition: AnalysisDefinition;
}

export interface AskRequest {
	question: string;
}

export interface AskResponse {
	answer: string | null;
	evidence: AskEvidence[];
	evidenceReferences?: EvidenceReference[];
	queries: AskQuery[];
	error: string | null;
	timestamp: string;
}
