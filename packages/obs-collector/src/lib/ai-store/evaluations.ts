import type {
	AIEvaluationRecord,
	AIEvaluationSource,
	AIEvaluationsListOptions,
	AIEvaluationsListResponse,
} from "@obs-unified/types";
import { aiEvaluationEvidenceReferences } from "../evidence-references";
import { parseJsonRecord } from "../json";
import type { SqlDb } from "../sql-db";
import type { AIEvaluationRow, IngestEvaluation } from "./types";
import { clampInt } from "./types";

export async function ingestAIEvaluations(
	db: SqlDb,
	evaluations: IngestEvaluation[],
): Promise<void> {
	if (evaluations.length === 0) return;
	const stmt = db.prepare(`
      INSERT INTO ai_span_evaluations (
        evaluation_id, project_id, trace_id, span_id, name,
        score, label, explanation, source, metadata_json,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
	await db.batch(
		evaluations.map((evaluation) =>
			stmt.bind(
				evaluation.evaluationId,
				evaluation.projectId,
				evaluation.traceId,
				evaluation.spanId,
				evaluation.name,
				evaluation.score,
				evaluation.label,
				evaluation.explanation,
				evaluation.source,
				evaluation.metadataJson,
				evaluation.createdAt,
				evaluation.expiresAt,
			),
		),
	);
}

export async function listAIEvaluations(
	db: SqlDb,
	options: AIEvaluationsListOptions,
): Promise<AIEvaluationsListResponse> {
	if (!options.projectId)
		throw new Error("AIStore.listEvaluations: projectId is required");
	const limit = clampInt(options.limit, 1, 1000, 200);

	let sql = `SELECT * FROM ai_span_evaluations WHERE project_id = ?`;
	const params: unknown[] = [options.projectId];

	if (options.traceId) {
		sql += ` AND trace_id = ?`;
		params.push(options.traceId);
	}
	if (options.spanId) {
		sql += ` AND span_id = ?`;
		params.push(options.spanId);
	}
	if (options.name) {
		sql += ` AND name = ?`;
		params.push(options.name);
	}

	sql += ` ORDER BY created_at DESC LIMIT ?`;
	params.push(limit);

	const results = await db
		.prepare(sql)
		.bind(...params)
		.all<AIEvaluationRow>();

	return {
		evaluations: mapEvaluationRows(results.results || []),
		timestamp: new Date().toISOString(),
	};
}

export function mapEvaluationRows(
	rows: AIEvaluationRow[],
): AIEvaluationRecord[] {
	return rows.map((row) => {
		const evaluation: AIEvaluationRecord = {
			evaluationId: row.evaluation_id,
			projectId: row.project_id,
			traceId: row.trace_id,
			spanId: row.span_id,
			name: row.name,
			score: row.score,
			label: row.label,
			explanation: row.explanation,
			source: row.source as AIEvaluationSource,
			metadata: parseJsonRecord(row.metadata_json),
			createdAt: row.created_at,
			expiresAt: row.expires_at,
		};
		evaluation.evidenceReferences = aiEvaluationEvidenceReferences(evaluation);
		return evaluation;
	});
}
