import type {
	AnalysisResult,
	AskEvidence,
	EvidenceCitation,
	EvidenceEntityKind,
	EvidenceNextPivot,
	EvidenceReference,
	JsonValue,
} from "@obs-unified/types";

const analysisRoute = (analysisId: string) =>
	`#/investigate/${encodeURIComponent(analysisId)}`;

export const analysisEvidenceReference = (
	evidence: AskEvidence,
): EvidenceReference => {
	const route = analysisRoute(evidence.analysisId);
	const status = evidence.result?.status ?? "unknown";
	return {
		evidenceId: `ask:analysis:${evidence.analysisId}`,
		entityKind: "analysis",
		entityId: evidence.analysisId,
		route,
		source: "ask.run_analysis",
		confidence: evidence.result ? 1 : 0.55,
		reason: evidence.result
			? `Ask consulted analysis "${evidence.definition.title}" with latest status ${status}.`
			: `Ask consulted analysis "${evidence.definition.title}", but no latest result was available.`,
		citations: [
			{
				label: evidence.definition.title,
				entityKind: "analysis",
				entityId: evidence.analysisId,
				route,
			},
		],
		suggestedNextPivots: [
			{
				label: "Open investigation",
				entityKind: "analysis",
				entityId: evidence.analysisId,
				route,
				reason:
					"Review the analysis payload, narrative, and connected telemetry rail.",
			},
		],
	};
};

export const askEvidenceReferences = (
	evidence: Iterable<AskEvidence>,
): EvidenceReference[] =>
	[...evidence].map((item) => analysisEvidenceReference(item));

const MAX_ANALYSIS_EVIDENCE_REFERENCES = 50;

interface EvidenceTable {
	title?: string | null;
	headers: string[];
	rows: JsonValue[][];
}

interface RowEntity {
	entityKind: EvidenceEntityKind;
	entityId: string;
	route: string;
	label: string;
	confidence: number;
	citations: EvidenceCitation[];
	suggestedNextPivots: EvidenceNextPivot[];
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
	!!value && typeof value === "object" && !Array.isArray(value);

const asString = (value: JsonValue | undefined): string | null => {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return null;
};

const normalizeHeader = (header: string) =>
	header
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");

const valueFor = (
	row: JsonValue[],
	headerIndex: Map<string, number>,
	names: string[],
): string | null => {
	for (const name of names) {
		const index = headerIndex.get(name);
		if (index === undefined) continue;
		const value = asString(row[index]);
		if (value) return value;
	}
	return null;
};

const traceRoute = (traceId: string) =>
	`#/traces/${encodeURIComponent(traceId)}`;

const spanRoute = (traceId: string, spanId: string) =>
	`${traceRoute(traceId)}#span=${encodeURIComponent(spanId)}`;

const routeFor = (
	entityKind: EvidenceEntityKind,
	entityId: string,
	traceId?: string | null,
) => {
	switch (entityKind) {
		case "action":
			return `#/actions/${encodeURIComponent(entityId)}`;
		case "agent_run":
			return `#/agent-runs/${encodeURIComponent(entityId)}`;
		case "eval":
			return `#/evals/${encodeURIComponent(entityId)}`;
		case "log":
			return `#/logs?id=${encodeURIComponent(entityId)}`;
		case "profile":
			return traceId
				? `#/profiles/${encodeURIComponent(entityId)}?trace_id=${encodeURIComponent(traceId)}`
				: `#/profiles/${encodeURIComponent(entityId)}`;
		case "service":
			return `#/traces?service=${encodeURIComponent(entityId)}`;
		case "span": {
			const [tracePart, spanPart] = entityId.split(":");
			return spanPart ? spanRoute(tracePart, spanPart) : `#/spans/${entityId}`;
		}
		case "tool_call":
			return `#/tool-calls/${encodeURIComponent(entityId)}`;
		case "trace":
			return traceRoute(entityId);
		default:
			return `#/${entityKind}/${encodeURIComponent(entityId)}`;
	}
};

const parseEvidenceTables = (
	payload: Record<string, unknown>,
): Array<{ sectionName: string; table: EvidenceTable }> => {
	const evidence = payload.evidence;
	if (!isRecord(evidence)) return [];

	const tables: Array<{ sectionName: string; table: EvidenceTable }> = [];
	for (const [sectionName, section] of Object.entries(evidence)) {
		if (!isRecord(section)) continue;
		const headers = section.headers;
		const rows = section.rows;
		if (
			!Array.isArray(headers) ||
			!headers.every(
				(header): header is string => typeof header === "string",
			) ||
			!Array.isArray(rows)
		) {
			continue;
		}

		const normalizedRows = rows.filter((row): row is JsonValue[] =>
			Array.isArray(row),
		);
		tables.push({
			sectionName,
			table: {
				title: asString(section.title),
				headers,
				rows: normalizedRows,
			},
		});
	}
	return tables;
};

const entityFromRow = (
	row: JsonValue[],
	headers: string[],
): RowEntity | null => {
	const headerIndex = new Map(headers.map((header, index) => [header, index]));
	const traceId = valueFor(row, headerIndex, ["trace_id", "traceid", "trace"]);
	const spanId = valueFor(row, headerIndex, ["span_id", "spanid"]);
	const logId = valueFor(row, headerIndex, ["log_id", "logid"]);
	const profileId = valueFor(row, headerIndex, ["profile_id", "profileid"]);
	const actionId = valueFor(row, headerIndex, ["action_id", "actionid"]);
	const agentRunId = valueFor(row, headerIndex, [
		"agent_run_id",
		"agentrunid",
		"agent_run",
	]);
	const toolCallId = valueFor(row, headerIndex, [
		"tool_call_id",
		"toolcallid",
		"tool_call",
	]);
	const evalId = valueFor(row, headerIndex, ["eval_id", "evalid"]);
	const service = valueFor(row, headerIndex, ["service", "service_name"]);

	const traceCitation = traceId
		? [
				{
					label: `trace ${traceId}`,
					entityKind: "trace" as const,
					entityId: traceId,
					route: traceRoute(traceId),
				},
			]
		: [];

	if (traceId && spanId) {
		const entityId = `${traceId}:${spanId}`;
		return {
			entityKind: "span",
			entityId,
			route: spanRoute(traceId, spanId),
			label: `span ${spanId}`,
			confidence: 0.95,
			citations: traceCitation,
			suggestedNextPivots: [
				{
					label: "Open span",
					entityKind: "span",
					entityId,
					route: spanRoute(traceId, spanId),
					reason: "Inspect the cited span in its trace context.",
				},
				{
					label: "Open trace",
					entityKind: "trace",
					entityId: traceId,
					route: traceRoute(traceId),
					reason: "Review the surrounding trace context.",
				},
			],
		};
	}

	const candidates: Array<{
		entityKind: EvidenceEntityKind;
		entityId: string | null;
		labelPrefix: string;
		confidence: number;
	}> = [
		{
			entityKind: "trace",
			entityId: traceId,
			labelPrefix: "trace",
			confidence: 0.95,
		},
		{
			entityKind: "action",
			entityId: actionId,
			labelPrefix: "action",
			confidence: 0.9,
		},
		{
			entityKind: "tool_call",
			entityId: toolCallId,
			labelPrefix: "tool call",
			confidence: 0.9,
		},
		{
			entityKind: "agent_run",
			entityId: agentRunId,
			labelPrefix: "agent run",
			confidence: 0.9,
		},
		{
			entityKind: "profile",
			entityId: profileId,
			labelPrefix: "profile",
			confidence: 0.9,
		},
		{
			entityKind: "log",
			entityId: logId,
			labelPrefix: "log",
			confidence: 0.85,
		},
		{
			entityKind: "eval",
			entityId: evalId,
			labelPrefix: "eval",
			confidence: 0.85,
		},
		{
			entityKind: "service",
			entityId: service,
			labelPrefix: "service",
			confidence: 0.7,
		},
	];

	const candidate = candidates.find((item) => item.entityId);
	if (!candidate?.entityId) return null;

	const route = routeFor(candidate.entityKind, candidate.entityId, traceId);
	return {
		entityKind: candidate.entityKind,
		entityId: candidate.entityId,
		route,
		label: `${candidate.labelPrefix} ${candidate.entityId}`,
		confidence: candidate.confidence,
		citations: traceCitation.filter(
			(citation) =>
				citation.entityKind !== candidate.entityKind ||
				citation.entityId !== candidate.entityId,
		),
		suggestedNextPivots: [
			{
				label: `Open ${candidate.labelPrefix}`,
				entityKind: candidate.entityKind,
				entityId: candidate.entityId,
				route,
				reason: "Inspect the cited evidence row.",
			},
		],
	};
};

export const analysisResultEvidenceReferences = (
	result: Pick<AnalysisResult, "analysisId" | "payload">,
): EvidenceReference[] => {
	const references: EvidenceReference[] = [];
	for (const { sectionName, table } of parseEvidenceTables(result.payload)) {
		const headers = table.headers.map(normalizeHeader);
		for (const [rowIndex, row] of table.rows.entries()) {
			if (references.length >= MAX_ANALYSIS_EVIDENCE_REFERENCES) {
				return references;
			}
			const entity = entityFromRow(row, headers);
			if (!entity) continue;

			const title = table.title ?? sectionName;
			references.push({
				evidenceId: `analysis:${result.analysisId}:${sectionName}:${rowIndex}:${entity.entityKind}:${entity.entityId}`,
				entityKind: entity.entityKind,
				entityId: entity.entityId,
				route: entity.route,
				source: `analysis.payload.evidence.${sectionName}`,
				confidence: entity.confidence,
				reason: `Analysis "${result.analysisId}" cited ${entity.label} in "${title}" row ${rowIndex + 1}.`,
				citations: entity.citations,
				suggestedNextPivots: entity.suggestedNextPivots,
			});
		}
	}
	return references;
};
