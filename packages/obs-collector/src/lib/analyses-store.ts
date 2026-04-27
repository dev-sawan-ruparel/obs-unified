/**
 * AnalysesStore — RFC 0002 Stage 1 persistence for application-aware Analyses.
 *
 * Two tables:
 *   - analysis_definitions: durable registry of (id, title, group, sql, ...).
 *     Refreshed on every scheduled tick by the runner from the in-process
 *     analysis registry. Mirrored here so the dashboard can list available
 *     analyses without coupling to deploy artifacts.
 *   - analysis_results: append-only result rows. Reads are "latest per
 *     analysis_id" (covered by idx_analysis_results_latest); retention is
 *     handled by the existing scheduled cron via purgeExpired().
 */

import type {
	AnalysisDefinition,
	AnalysisGroup,
	AnalysisResult,
	AnalysisSource,
	AnalysisStatus,
	AnalysisView,
} from "@obs/types";

import { parseJsonRecord } from "./json";

interface DefinitionRow {
	project_id: string;
	id: string;
	title: string;
	group: string;
	source: string;
	view: string;
	refresh_seconds: number | null;
	sql: string | null;
	scope_json: string | null;
	created_at: string;
	updated_at: string;
	last_run_at: string | null;
}

interface ResultRow {
	id: number;
	project_id: string;
	analysis_id: string;
	generated_at: number;
	params_hash: string | null;
	status: string;
	primary_value: number | null;
	baseline_value: number | null;
	delta_pct: number | null;
	payload_json: string;
	narrative: string | null;
	narrative_signature: string | null;
	duration_ms: number;
	expires_at: number;
}

const rowToDefinition = (row: DefinitionRow): AnalysisDefinition => {
	const def: AnalysisDefinition = {
		id: row.id,
		title: row.title,
		group: row.group as AnalysisGroup,
		source: row.source as AnalysisSource,
		view: row.view as AnalysisView,
	};
	if (row.refresh_seconds !== null && row.refresh_seconds !== undefined) {
		def.refreshSeconds = row.refresh_seconds;
	}
	if (row.sql) {
		def.sql = row.sql;
	}
	if (row.scope_json) {
		def.scope = parseJsonRecord(row.scope_json);
	}
	return def;
};

const rowToResult = (row: ResultRow): AnalysisResult => ({
	analysisId: row.analysis_id,
	projectId: row.project_id,
	generatedAt: new Date(row.generated_at).toISOString(),
	paramsHash: row.params_hash,
	status: row.status as AnalysisStatus,
	primaryValue: row.primary_value,
	baselineValue: row.baseline_value,
	deltaPct: row.delta_pct,
	payload: row.payload_json ? parseJsonRecord(row.payload_json) : {},
	narrative: row.narrative,
	narrativeSignature: row.narrative_signature,
	durationMs: row.duration_ms,
});

export class AnalysesStore {
	constructor(private readonly db: D1Database) {}

	async upsertDefinition(
		projectId: string,
		def: AnalysisDefinition,
	): Promise<void> {
		if (!projectId)
			throw new Error("AnalysesStore.upsertDefinition: projectId is required");
		if (!def.id)
			throw new Error("AnalysesStore.upsertDefinition: def.id is required");

		const now = new Date().toISOString();
		const scopeJson = def.scope ? JSON.stringify(def.scope) : null;
		const refreshSeconds =
			def.refreshSeconds === undefined || def.refreshSeconds === null
				? null
				: def.refreshSeconds;

		await this.db
			.prepare(
				`INSERT INTO analysis_definitions (
					project_id, id, title, "group", source, view,
					refresh_seconds, sql, scope_json,
					created_at, updated_at, last_run_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
				ON CONFLICT(project_id, id) DO UPDATE SET
					title = excluded.title,
					"group" = excluded."group",
					source = excluded.source,
					view = excluded.view,
					refresh_seconds = excluded.refresh_seconds,
					sql = excluded.sql,
					scope_json = excluded.scope_json,
					updated_at = excluded.updated_at`,
			)
			.bind(
				projectId,
				def.id,
				def.title,
				def.group,
				def.source,
				def.view,
				refreshSeconds,
				def.sql ?? null,
				scopeJson,
				now,
				now,
			)
			.run();
	}

	async listDefinitions(projectId: string): Promise<AnalysisDefinition[]> {
		if (!projectId)
			throw new Error("AnalysesStore.listDefinitions: projectId is required");
		const result = await this.db
			.prepare(
				`SELECT project_id, id, title, "group" AS "group", source, view,
					refresh_seconds, sql, scope_json,
					created_at, updated_at, last_run_at
				FROM analysis_definitions
				WHERE project_id = ?
				ORDER BY "group", id`,
			)
			.bind(projectId)
			.all<DefinitionRow>();
		return (result.results ?? []).map(rowToDefinition);
	}

	async getDueAnalyses(
		projectId: string,
		now: number,
	): Promise<AnalysisDefinition[]> {
		if (!projectId)
			throw new Error("AnalysesStore.getDueAnalyses: projectId is required");
		// last_run_at is stored as ISO string; we compute due-ness in JS so the
		// comparison is unambiguous regardless of D1's date function support.
		const result = await this.db
			.prepare(
				`SELECT project_id, id, title, "group" AS "group", source, view,
					refresh_seconds, sql, scope_json,
					created_at, updated_at, last_run_at
				FROM analysis_definitions
				WHERE project_id = ? AND refresh_seconds IS NOT NULL`,
			)
			.bind(projectId)
			.all<DefinitionRow>();

		const due: AnalysisDefinition[] = [];
		for (const row of result.results ?? []) {
			const refreshSeconds = row.refresh_seconds;
			if (refreshSeconds === null || refreshSeconds === undefined) continue;
			const lastRunMs = row.last_run_at
				? Date.parse(row.last_run_at)
				: 0;
			if (lastRunMs + refreshSeconds * 1000 < now) {
				due.push(rowToDefinition(row));
			}
		}
		return due;
	}

	async markRan(
		projectId: string,
		analysisId: string,
		ranAt: string,
	): Promise<void> {
		await this.db
			.prepare(
				`UPDATE analysis_definitions
				SET last_run_at = ?
				WHERE project_id = ? AND id = ?`,
			)
			.bind(ranAt, projectId, analysisId)
			.run();
	}

	async getLatestResult(
		projectId: string,
		analysisId: string,
	): Promise<AnalysisResult | null> {
		if (!projectId)
			throw new Error("AnalysesStore.getLatestResult: projectId is required");
		const row = await this.db
			.prepare(
				`SELECT id, project_id, analysis_id, generated_at, params_hash,
					status, primary_value, baseline_value, delta_pct, payload_json,
					narrative, narrative_signature, duration_ms, expires_at
				FROM analysis_results
				WHERE project_id = ? AND analysis_id = ?
				ORDER BY generated_at DESC
				LIMIT 1`,
			)
			.bind(projectId, analysisId)
			.first<ResultRow>();
		return row ? rowToResult(row) : null;
	}

	async getLatestResultsBulk(
		projectId: string,
		analysisIds: string[],
	): Promise<Map<string, AnalysisResult>> {
		if (!projectId)
			throw new Error(
				"AnalysesStore.getLatestResultsBulk: projectId is required",
			);
		if (analysisIds.length === 0) return new Map();

		// Pull a recent window of rows for the requested analyses then group by
		// analysis_id, taking the row with the largest generated_at per group.
		// One query, no per-analysis round-trips.
		const placeholders = analysisIds.map(() => "?").join(", ");
		const result = await this.db
			.prepare(
				`SELECT id, project_id, analysis_id, generated_at, params_hash,
					status, primary_value, baseline_value, delta_pct, payload_json,
					narrative, narrative_signature, duration_ms, expires_at
				FROM analysis_results
				WHERE project_id = ? AND analysis_id IN (${placeholders})
				ORDER BY generated_at DESC`,
			)
			.bind(projectId, ...analysisIds)
			.all<ResultRow>();

		const latest = new Map<string, AnalysisResult>();
		for (const row of result.results ?? []) {
			if (!latest.has(row.analysis_id)) {
				latest.set(row.analysis_id, rowToResult(row));
			}
		}
		return latest;
	}

	async insertResult(
		result: AnalysisResult,
		expiresAt: number,
	): Promise<void> {
		if (!result.projectId)
			throw new Error("AnalysesStore.insertResult: projectId is required");
		if (!result.analysisId)
			throw new Error("AnalysesStore.insertResult: analysisId is required");

		const generatedAtMs = Date.parse(result.generatedAt);
		await this.db
			.prepare(
				`INSERT INTO analysis_results (
					project_id, analysis_id, generated_at, params_hash,
					status, primary_value, baseline_value, delta_pct, payload_json,
					narrative, narrative_signature, duration_ms, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				result.projectId,
				result.analysisId,
				Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
				result.paramsHash,
				result.status,
				result.primaryValue,
				result.baselineValue,
				result.deltaPct,
				JSON.stringify(result.payload ?? {}),
				result.narrative,
				result.narrativeSignature,
				result.durationMs,
				expiresAt,
			)
			.run();
	}

	async purgeExpired(): Promise<number> {
		const now = Date.now();
		const result = await this.db
			.prepare(`DELETE FROM analysis_results WHERE expires_at <= ?`)
			.bind(now)
			.run();
		return result.meta?.changes ?? 0;
	}
}
