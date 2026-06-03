import type {
	AIEvaluationRecord,
	AlertEvaluation,
	AlertRule,
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

export const evidenceRouteFor = (
	entityKind: EvidenceEntityKind,
	entityId: string,
	traceId?: string | null,
) => {
	switch (entityKind) {
		case "analysis":
			return analysisRoute(entityId);
		case "action":
			return `#/actions/${encodeURIComponent(entityId)}`;
		case "alert":
			return `#/alerts?alert=${encodeURIComponent(entityId)}`;
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
		case "docs":
			return entityId.startsWith("#/") ? entityId : `#/docs/${entityId}`;
	}
	const exhaustive: never = entityKind;
	return exhaustive;
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

const instrumentationGapEvidenceReferences = (
	result: Pick<AnalysisResult, "analysisId" | "payload">,
): EvidenceReference[] => {
	const gaps = result.payload.instrumentationGaps;
	if (!isRecord(gaps)) return [];
	const traceId = asString(gaps.traceId);
	const blindspots = gaps.blindspots;
	if (!traceId || !Array.isArray(blindspots)) return [];

	return blindspots
		.filter(isRecord)
		.map((gap, index): EvidenceReference | null => {
			const spanId = asString(gap.parentSpanId);
			if (!spanId) return null;
			const serviceName = asString(gap.parentServiceName);
			const spanName = asString(gap.parentSpanName);
			const durationMs =
				typeof gap.durationMs === "number" && Number.isFinite(gap.durationMs)
					? gap.durationMs
					: null;
			const ratio =
				typeof gap.ratioOfParent === "number" &&
				Number.isFinite(gap.ratioOfParent)
					? gap.ratioOfParent
					: null;
			const recommendation = asString(gap.recommendation);
			const thresholdVersion =
				asString(gap.thresholdVersion) ??
				(isRecord(gaps.thresholds) ? asString(gaps.thresholds.version) : null);
			const entityId = `${traceId}:${spanId}`;
			const route = spanRoute(traceId, spanId);
			const label = spanName ? `${spanName} (${spanId})` : `span ${spanId}`;
			const durationText =
				durationMs === null ? "unknown duration" : `${durationMs}ms`;
			const ratioText =
				ratio === null ? "" : `, ${(ratio * 100).toFixed(1)}% of parent`;
			const thresholdText = thresholdVersion
				? ` Thresholds: ${thresholdVersion}.`
				: "";
			const docsRoute = "#/docs/howto/ebpf";
			return {
				evidenceId: `analysis:${result.analysisId}:instrumentation-gap:${index}:span:${entityId}`,
				entityKind: "span",
				entityId,
				route,
				source: "analysis.payload.instrumentationGaps",
				confidence: 0.9,
				reason: `Analysis "${result.analysisId}" found uninstrumented self-time on ${label}: ${durationText}${ratioText}.${thresholdText}${recommendation ? ` ${recommendation}` : ""}`,
				citations: [
					{
						label: `trace ${traceId}`,
						entityKind: "trace",
						entityId: traceId,
						route: traceRoute(traceId),
					},
				],
				suggestedNextPivots: [
					{
						label: "Open uninstrumented span",
						entityKind: "span",
						entityId,
						route,
						reason:
							"Inspect the parent span whose self-time suggests missing child instrumentation.",
					},
					{
						label: "Open trace gap data",
						entityKind: "trace",
						entityId: traceId,
						route: `${traceRoute(traceId)}/gaps`,
						reason:
							"Review all structured instrumentation blindspots for this trace.",
					},
					{
						label: "Open profiler setup docs",
						entityKind: "docs",
						entityId: "howto/ebpf",
						route: docsRoute,
						reason:
							serviceName != null
								? `Use profiler or eBPF setup guidance to cover missing spans in ${serviceName}.`
								: "Use profiler or eBPF setup guidance to cover missing spans.",
					},
				],
			};
		})
		.filter((ref): ref is EvidenceReference => ref !== null)
		.slice(0, MAX_ANALYSIS_EVIDENCE_REFERENCES);
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

	const route = evidenceRouteFor(
		candidate.entityKind,
		candidate.entityId,
		traceId,
	);
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

export const alertEvidenceReferences = (
	rule: AlertRule,
	evaluation?: AlertEvaluation | null,
): EvidenceReference[] => {
	const route = evidenceRouteFor("alert", rule.id);
	const references: EvidenceReference[] = [
		{
			evidenceId: evaluation
				? `alert:${rule.id}:evaluation:${evaluation.id}`
				: `alert:${rule.id}:rule`,
			entityKind: "alert",
			entityId: rule.id,
			route,
			source: evaluation
				? "alert_evaluations"
				: "alerts.rule_evaluation_preview",
			confidence: evaluation ? 1 : 0.8,
			reason: evaluation
				? `Alert "${rule.name}" evaluated to ${evaluation.value} and state ${evaluation.state}.`
				: `Alert "${rule.name}" was evaluated against its configured threshold.`,
			citations: [
				{
					label: rule.name,
					entityKind: "alert",
					entityId: rule.id,
					route,
				},
			],
			suggestedNextPivots: [
				{
					label: "Open alert",
					entityKind: "alert",
					entityId: rule.id,
					route,
					reason: "Inspect the alert rule, threshold, and recent evaluations.",
				},
			],
		},
	];

	if (rule.analysisId) {
		const analysisRouteValue = analysisRoute(rule.analysisId);
		references.push({
			evidenceId: evaluation
				? `alert:${rule.id}:evaluation:${evaluation.id}:analysis:${rule.analysisId}`
				: `alert:${rule.id}:analysis:${rule.analysisId}`,
			entityKind: "analysis",
			entityId: rule.analysisId,
			route: analysisRouteValue,
			source: "alert_rules.analysis_id",
			confidence: 0.9,
			reason: `Alert "${rule.name}" is bound to analysis "${rule.analysisId}".`,
			citations: [
				{
					label: rule.name,
					entityKind: "alert",
					entityId: rule.id,
					route,
				},
			],
			suggestedNextPivots: [
				{
					label: "Open investigation",
					entityKind: "analysis",
					entityId: rule.analysisId,
					route: analysisRouteValue,
					reason: "Review the analysis result that drives this alert.",
				},
			],
		});
	}

	return references;
};

export const aiEvaluationEvidenceReferences = (
	evaluation: Pick<
		AIEvaluationRecord,
		"evaluationId" | "traceId" | "spanId" | "name" | "source"
	>,
): EvidenceReference[] => {
	const spanEntityId = `${evaluation.traceId}:${evaluation.spanId}`;
	const spanRouteValue = evidenceRouteFor(
		"span",
		spanEntityId,
		evaluation.traceId,
	);
	return [
		{
			evidenceId: `ai-evaluation:${evaluation.evaluationId}`,
			entityKind: "eval",
			entityId: evaluation.evaluationId,
			route: evidenceRouteFor("eval", evaluation.evaluationId),
			source: `ai_span_evaluations.${evaluation.source}`,
			confidence: 0.95,
			reason: `AI evaluation "${evaluation.name}" graded span "${evaluation.spanId}".`,
			citations: [
				{
					label: `span ${evaluation.spanId}`,
					entityKind: "span",
					entityId: spanEntityId,
					route: spanRouteValue,
				},
				{
					label: `trace ${evaluation.traceId}`,
					entityKind: "trace",
					entityId: evaluation.traceId,
					route: evidenceRouteFor("trace", evaluation.traceId),
				},
			],
			suggestedNextPivots: [
				{
					label: "Open span",
					entityKind: "span",
					entityId: spanEntityId,
					route: spanRouteValue,
					reason: "Inspect the evaluated AI span and its surrounding trace.",
				},
			],
		},
	];
};

export interface SourceEvidenceLinks {
	sourceAgentRunId?: string | null;
	sourceActionId?: string | null;
	sourceToolCallId?: string | null;
	sourceTraceId?: string | null;
	sourceSpanId?: string | null;
}

export const sourceLinkEvidenceReferences = (
	source: {
		sourceLabel: string;
		sourceId: string;
		sourceKind: "eval_case" | "eval_case_result" | "eval_run";
		sourceRoute?: string | null;
		sourceName?: string | null;
	},
	links: SourceEvidenceLinks,
): EvidenceReference[] => {
	const citations: EvidenceCitation[] = [];
	if (source.sourceRoute) {
		citations.push({
			label: source.sourceName ?? source.sourceId,
			entityKind: "eval",
			entityId: source.sourceId,
			route: source.sourceRoute,
		});
	}

	const candidates: Array<{
		kind: EvidenceEntityKind;
		id: string | null | undefined;
		label: string;
		confidence: number;
	}> = [
		{
			kind: "action",
			id: links.sourceActionId,
			label: "source action",
			confidence: 0.92,
		},
		{
			kind: "tool_call",
			id: links.sourceToolCallId,
			label: "source tool call",
			confidence: 0.9,
		},
		{
			kind: "agent_run",
			id: links.sourceAgentRunId,
			label: "source agent run",
			confidence: 0.9,
		},
		{
			kind: "span",
			id:
				links.sourceTraceId && links.sourceSpanId
					? `${links.sourceTraceId}:${links.sourceSpanId}`
					: null,
			label: "source span",
			confidence: 0.9,
		},
		{
			kind: "trace",
			id: links.sourceTraceId,
			label: "source trace",
			confidence: 0.88,
		},
	];

	return candidates
		.filter((candidate): candidate is typeof candidate & { id: string } =>
			Boolean(candidate.id),
		)
		.map((candidate) => {
			const route = evidenceRouteFor(
				candidate.kind,
				candidate.id,
				links.sourceTraceId,
			);
			return {
				evidenceId: `${source.sourceKind}:${source.sourceId}:${candidate.kind}:${candidate.id}`,
				entityKind: candidate.kind,
				entityId: candidate.id,
				route,
				source: `${source.sourceKind}.source_links`,
				confidence: candidate.confidence,
				reason: `${source.sourceLabel} links to ${candidate.label} "${candidate.id}".`,
				citations,
				suggestedNextPivots: [
					{
						label: `Open ${candidate.label}`,
						entityKind: candidate.kind,
						entityId: candidate.id,
						route,
						reason:
							"Inspect the production evidence behind this evaluation item.",
					},
				],
			} satisfies EvidenceReference;
		});
};

export const analysisResultEvidenceReferences = (
	result: Pick<AnalysisResult, "analysisId" | "payload">,
): EvidenceReference[] => {
	const references: EvidenceReference[] = [
		...instrumentationGapEvidenceReferences(result),
	];
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
