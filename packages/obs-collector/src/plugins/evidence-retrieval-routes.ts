import type {
	EvidenceBundle,
	EvidenceBundleDetailLevel,
	EvidenceBundleIntent,
	EvidenceCompaction,
	EvidenceEntityKind,
	EvidenceNextPivot,
	EvidenceReference,
	EvidenceRetrievalRef,
	LogRecord,
	TelemetrySpanDetail,
	TelemetryTraceDetailResponse,
} from "@obsunified/types";
import type { CollectorPlugin } from "../framework/collector";
import {
	computeChangeBlastRadius,
	getChangeEvent,
	listChangeEvents,
} from "../lib/autosre-change-correlation";
import {
	getInvestigationFinding,
	searchInvestigationFindings,
} from "../lib/autosre-findings";
import {
	getOntologyGraph,
	loadTraceFaultLocusFromDb,
} from "../lib/autosre-ontology";
import {
	getIncidentInvestigation,
	listRemediationProposals,
} from "../lib/autosre-remediation-gate";
import type {
	ActionRef,
	EntityManifestExtended,
	ToolCallRef,
} from "../lib/identity-index";
import { IdentityIndex } from "../lib/identity-index";
import { LogsStore } from "../lib/logs-store";
import { decodePprofBlob, summarizeProfileFrames } from "../lib/parse-pprof";
import type { SqlDb } from "../lib/sql-db";
import { getProjectId } from "./_context";
import { fetchReplayChunks } from "./replay-query-routes";

interface EvidenceRefPayload {
	kind:
		| "logs"
		| "trace"
		| "action_graph"
		| "profile"
		| "replay"
		| "ai_call"
		| "tool_call";
	projectId: string;
	traceId?: string;
	anchorKind?: "action" | "agent_run" | "tool_call";
	anchorId?: string;
	profileId?: string;
	profileMode?: "metadata" | "frames";
	sessionId?: string;
	replayMode?: "metadata" | "events";
	chunkOffset?: number;
	callId?: string;
	toolCallId?: string;
	hours?: number;
	limit?: number;
}

interface ProfileEvidenceRow {
	id: string;
	service_name: string | null;
	profile_type: string;
	start_ts: string;
	end_ts: string;
	duration_ms: number;
	blob_size_bytes: number;
	blob_url?: string;
	sample_count: number | null;
	agent: string | null;
	received_at?: string;
	expires_at?: string;
}

interface ReplayEvidenceRow {
	session_id: string;
	visitor_id?: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
	storage_bytes?: number;
}

interface AICallEvidenceRow {
	call_id: string;
	trace_id: string;
	span_id?: string | null;
	service_name?: string | null;
	model_name: string;
	provider: string;
	call_type?: string;
	prompt_tokens?: number | null;
	completion_tokens?: number | null;
	total_cost_usd: number | null;
	latency_ms?: number | null;
	is_error?: number | null;
	error_message?: string | null;
	occurred_at: string;
	received_at?: string;
	expires_at?: string;
	interaction_id?: string | null;
	session_id?: string | null;
}

const BUNDLE_SCHEMA_VERSION = "obs-unified.evidence-bundle.v1" as const;
const DEFAULT_TARGET_TOKENS = 4000;
const DEFAULT_HOURS = 24;
const MAX_LOGS_FOR_BUNDLE = 500;
const MAX_LOGS_FOR_RETRIEVAL = 1000;
const DEFAULT_REPLAY_EVENT_CHUNKS = 5;
const MAX_REPLAY_EVENT_CHUNKS = 25;
const DEFAULT_PROFILE_FRAME_LIMIT = 50;
const MAX_PROFILE_FRAME_LIMIT = 200;
const EVIDENCE_INTENTS = new Set<EvidenceBundleIntent>([
	"debug_failure",
	"triage_incident",
	"explain_latency",
	"explain_cost",
	"inspect_agent_run",
	"inspect_tool_call",
	"find_instrumentation_gap",
	"general",
]);
const LOG_SEVERITIES = new Set<LogRecord["severity"]>([
	"DEBUG",
	"INFO",
	"WARN",
	"ERROR",
	"FATAL",
]);

const clampInt = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	const parsed =
		typeof value === "number"
			? value
			: Number.parseInt(typeof value === "string" ? value : "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
};

const estimateTokens = (value: unknown): number =>
	Math.ceil(JSON.stringify(value).length / 4);

const traceRoute = (traceId: string) =>
	`#/traces/${encodeURIComponent(traceId)}`;
const spanRoute = (traceId: string, spanId: string) =>
	`${traceRoute(traceId)}#span=${encodeURIComponent(spanId)}`;
const logRoute = (logId: string) => `#/logs?id=${encodeURIComponent(logId)}`;
const actionRoute = (actionId: string) =>
	`#/actions/${encodeURIComponent(actionId)}`;
const agentRunRoute = (agentRunId: string) =>
	`#/agent-runs/${encodeURIComponent(agentRunId)}`;
const toolCallRoute = (toolCallId: string) =>
	`#/tool-calls/${encodeURIComponent(toolCallId)}`;
const replayRoute = (sessionId: string) =>
	`#/replay?session=${encodeURIComponent(sessionId)}`;
const profileRoute = (profileId: string, traceId?: string) =>
	`#/profiles/${encodeURIComponent(profileId)}${
		traceId ? `?trace_id=${encodeURIComponent(traceId)}` : ""
	}`;
const aiCallRoute = (callId: string) =>
	`#/ai/calls/${encodeURIComponent(callId)}`;

const evidenceRef = (
	evidenceId: string,
	entityKind: EvidenceEntityKind,
	entityId: string,
	route: string,
	source: string,
	confidence: number,
	reason: string,
	citations: EvidenceReference["citations"] = [],
	suggestedNextPivots: EvidenceNextPivot[] = [],
): EvidenceReference => ({
	evidenceId,
	entityKind,
	entityId,
	route,
	source,
	confidence,
	reason,
	citations,
	suggestedNextPivots,
});

const encodeRef = (payload: EvidenceRefPayload): string => {
	const json = JSON.stringify(payload);
	const bytes = new TextEncoder().encode(json);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `eref_${globalThis
		.btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")}`;
};

const decodeRef = (refId: string): EvidenceRefPayload | null => {
	if (!refId.startsWith("eref_")) return null;
	try {
		const encoded = refId
			.slice("eref_".length)
			.replace(/-/g, "+")
			.replace(/_/g, "/");
		const padded = encoded.padEnd(
			encoded.length + ((4 - (encoded.length % 4)) % 4),
			"=",
		);
		const binary = globalThis.atob(padded);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes)) as EvidenceRefPayload;
	} catch {
		return null;
	}
};

const isProjectScopedRefPayload = (
	payload: EvidenceRefPayload | null,
): payload is EvidenceRefPayload =>
	Boolean(
		payload &&
			typeof payload.projectId === "string" &&
			payload.projectId.length > 0,
	);

const hasTraceId = (
	payload: EvidenceRefPayload,
): payload is EvidenceRefPayload & { traceId: string } =>
	typeof payload.traceId === "string" && payload.traceId.length > 0;

const expansionId = (): string =>
	`exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

const jsonOrNull = (value: unknown): string | null =>
	value === undefined ? null : JSON.stringify(value);

const materializeRetrievalRefs = async (
	db: SqlDb,
	projectId: string,
	refs: EvidenceRetrievalRef[],
) => {
	if (refs.length === 0) return;
	const stmt = db.prepare(
		`INSERT INTO evidence_retrieval_refs (
			ref_id, project_id, kind, anchor_kind, anchor_id, source, query_json,
			compacted_from_json, returned_json, last_seen_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
		ON CONFLICT(ref_id) DO UPDATE SET
			last_seen_at = CURRENT_TIMESTAMP,
			kind = excluded.kind,
			anchor_kind = excluded.anchor_kind,
			anchor_id = excluded.anchor_id,
			source = excluded.source,
			query_json = excluded.query_json,
			compacted_from_json = excluded.compacted_from_json,
			returned_json = excluded.returned_json,
			expires_at = excluded.expires_at`,
	);
	try {
		await db.batch(
			refs.map((ref) =>
				stmt.bind(
					ref.refId,
					projectId,
					ref.kind,
					ref.anchor.entityKind,
					ref.anchor.entityId,
					ref.source,
					jsonOrNull(ref.query),
					jsonOrNull(ref.compactedFrom),
					jsonOrNull(ref.returned),
					ref.expiresAt ?? null,
				),
			),
		);
	} catch {
		// Best-effort: encoded refs remain valid even before the migration lands.
	}
};

const recordRefExpansion = async (
	db: SqlDb,
	args: {
		projectId: string;
		refId: string;
		kind: EvidenceRefPayload["kind"];
		operation: "retrieve" | "search";
		resultStatus: "ok" | "error";
		limit?: number;
		query?: string;
	},
) => {
	try {
		const source = await db
			.prepare(
				`SELECT source FROM evidence_retrieval_refs
				 WHERE project_id = ? AND ref_id = ?
				 LIMIT 1`,
			)
			.bind(args.projectId, args.refId)
			.first<{ source: string }>();
		await db
			.prepare(
				`INSERT INTO evidence_ref_expansions (
					id, ref_id, project_id, kind, source, operation, result_status,
					limit_value, query_text, expanded_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
			)
			.bind(
				expansionId(),
				args.refId,
				args.projectId,
				args.kind,
				source?.source ?? null,
				args.operation,
				args.resultStatus,
				args.limit ?? null,
				args.query ?? null,
			)
			.run();
	} catch {
		// Best-effort telemetry must not break evidence expansion.
	}
};

const materializeBundle = async (
	db: SqlDb,
	projectId: string,
	bundle: EvidenceBundle,
): Promise<EvidenceBundle> => {
	await materializeRetrievalRefs(db, projectId, bundle.retrievalRefs);
	return bundle;
};

const spanLabel = (span: TelemetrySpanDetail): string =>
	`${span.serviceName || "unknown"}:${span.spanName}`;

const failedSpans = (spans: TelemetrySpanDetail[]): TelemetrySpanDetail[] =>
	spans.filter((span) => span.statusCode > 1 || Boolean(span.statusMessage));

const criticalPath = (spans: TelemetrySpanDetail[]): TelemetrySpanDetail[] =>
	[...spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 5);

const normalizeLogSignature = (message: string): string =>
	message
		.toLowerCase()
		.replace(/[0-9a-f]{16,}/g, "<hex>")
		.replace(/\b\d+\b/g, "<num>")
		.replace(/\s+/g, " ")
		.trim();

const clusterLogs = (
	traceId: string,
	logs: LogRecord[],
	logsRefId: string,
): { compactions: EvidenceCompaction[]; exemplars: LogRecord[] } => {
	const bySignature = new Map<string, LogRecord[]>();
	for (const log of logs) {
		const signature = normalizeLogSignature(log.message);
		const group = bySignature.get(signature) ?? [];
		group.push(log);
		bySignature.set(signature, group);
	}

	const exemplars: LogRecord[] = [];
	const compactions: EvidenceCompaction[] = [];
	for (const [signature, group] of bySignature) {
		const severitySorted = [...group].sort((a, b) => {
			const severityOrder = { FATAL: 5, ERROR: 4, WARN: 3, INFO: 2, DEBUG: 1 };
			return severityOrder[b.severity] - severityOrder[a.severity];
		});
		const selected = severitySorted.slice(
			0,
			Math.min(3, severitySorted.length),
		);
		exemplars.push(...selected);
		if (group.length > selected.length) {
			compactions.push({
				compactionId: `cmp_logs_${traceId}_${compactions.length + 1}`,
				kind: "logs",
				strategy: "signature_cluster",
				inputCount: group.length,
				outputCount: selected.length,
				reason: `Collapsed ${group.length} logs matching signature "${signature}" into ${selected.length} exemplar(s).`,
				exemplarEntityIds: selected.map((log) => log.logId),
				retrievalRefIds: [logsRefId],
			});
		}
	}

	return { compactions, exemplars: exemplars.slice(0, 20) };
};

const profilesForTrace = async (
	db: SqlDb,
	projectId: string,
	traceId: string,
): Promise<ProfileEvidenceRow[]> => {
	const rows = await db
		.prepare(
			`SELECT b.id, b.service_name, b.profile_type, b.start_ts, b.end_ts,
					b.duration_ms, b.blob_size_bytes, b.sample_count, b.agent,
					b.received_at, b.expires_at
			 FROM profile_trace_index i
			 JOIN profile_blobs b ON b.id = i.profile_id
			 WHERE i.project_id = ? AND i.trace_id = ?
			 ORDER BY b.end_ts DESC
			 LIMIT 10`,
		)
		.bind(projectId, traceId)
		.all<ProfileEvidenceRow>();
	return rows.results;
};

const profileTraceIds = async (
	db: SqlDb,
	projectId: string,
	profileId: string,
): Promise<string[]> => {
	const rows = await db
		.prepare(
			`SELECT trace_id FROM profile_trace_index
			 WHERE profile_id = ? AND project_id = ?
			 LIMIT 1000`,
		)
		.bind(profileId, projectId)
		.all<{ trace_id: string }>();
	return rows.results.map((row) => row.trace_id);
};

const replayBySession = async (
	db: SqlDb,
	projectId: string,
	sessionId: string,
): Promise<ReplayEvidenceRow | null> =>
	db
		.prepare(
			`SELECT session_id, visitor_id, first_chunk_at, last_chunk_at,
					chunk_count, events_count, storage_bytes
			 FROM session_replay_metadata
			 WHERE project_id = ? AND session_id = ?
			 LIMIT 1`,
		)
		.bind(projectId, sessionId)
		.first<ReplayEvidenceRow>();

const replayEventWindow = async (
	bucket: R2Bucket,
	projectId: string,
	sessionId: string,
	chunkOffset: number,
	chunkLimit: number,
): Promise<{
	events: Record<string, unknown>[];
	chunks: {
		offset: number;
		limit: number;
		returned: number;
		total: number;
		nextChunkOffset: number | null;
	};
}> => {
	const prefix = `replays/${projectId}/${sessionId}/`;
	const objects: Array<{ key: string }> = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor });
		objects.push(...page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);

	objects.sort((a, b) => a.key.localeCompare(b.key));
	const offset = Math.max(0, chunkOffset);
	const limit = Math.max(1, Math.min(MAX_REPLAY_EVENT_CHUNKS, chunkLimit));
	const selectedObjects = objects.slice(offset, offset + limit);
	return {
		events: await fetchReplayChunks(bucket, selectedObjects),
		chunks: {
			offset,
			limit,
			returned: selectedObjects.length,
			total: objects.length,
			nextChunkOffset: offset + limit < objects.length ? offset + limit : null,
		},
	};
};

const aiCallById = async (
	db: SqlDb,
	projectId: string,
	callId: string,
): Promise<AICallEvidenceRow | null> =>
	db
		.prepare(
			`SELECT call_id, trace_id, span_id, service_name, model_name, provider,
					call_type, prompt_tokens, completion_tokens, total_cost_usd,
					latency_ms, is_error, error_message, occurred_at, received_at,
					expires_at, interaction_id, session_id
			 FROM ai_calls
			 WHERE project_id = ? AND call_id = ?
			 LIMIT 1`,
		)
		.bind(projectId, callId)
		.first<AICallEvidenceRow>();

const toolCallById = async (
	db: SqlDb,
	projectId: string,
	toolCallId: string,
): Promise<ToolCallRef | null> => {
	const row = await db
		.prepare(
			`SELECT * FROM tool_calls
			 WHERE project_id = ? AND id = ?
			 LIMIT 1`,
		)
		.bind(projectId, toolCallId)
		.first<{
			id: string;
			action_id: string;
			project_id: string;
			tool_name: string;
			args_hash: string;
			result_hash: string;
			error_type: string | null;
			side_effect: number;
			approval_state: string | null;
			args_redacted: string | null;
			result_redacted: string | null;
			mcp_audit_json: string | null;
			mutation_before_json: string | null;
			mutation_after_json: string | null;
			mutation_diff_json: string | null;
			mutation_artifact_id: string | null;
		}>();
	if (!row) return null;
	return {
		id: row.id,
		actionId: row.action_id,
		projectId: row.project_id,
		toolName: row.tool_name,
		argsHash: row.args_hash,
		resultHash: row.result_hash,
		errorType: row.error_type,
		sideEffect: row.side_effect,
		approvalState: row.approval_state,
		argsRedacted: row.args_redacted,
		resultRedacted: row.result_redacted,
		mcpAuditJson: row.mcp_audit_json,
		mutationBeforeJson: row.mutation_before_json,
		mutationAfterJson: row.mutation_after_json,
		mutationDiffJson: row.mutation_diff_json,
		mutationArtifactId: row.mutation_artifact_id,
	};
};

const traceEvidenceReferences = (
	detail: TelemetryTraceDetailResponse,
	logExemplars: LogRecord[],
	profiles: ProfileEvidenceRow[],
): EvidenceReference[] => {
	const traceId = detail.trace.traceId;
	const refs: EvidenceReference[] = [
		evidenceRef(
			`trace:${traceId}`,
			"trace",
			traceId,
			traceRoute(traceId),
			"evidence.bundle.trace",
			1,
			`Trace ${traceId} contains ${detail.spans.length} span(s), with ${detail.trace.errorSpanCount} error span(s).`,
			[],
			[
				{
					label: "Open trace",
					entityKind: "trace",
					entityId: traceId,
					route: traceRoute(traceId),
					reason: "Inspect the full span tree.",
				},
			],
		),
	];

	for (const span of failedSpans(detail.spans).slice(0, 5)) {
		refs.push(
			evidenceRef(
				`span:${traceId}:${span.spanId}`,
				"span",
				`${traceId}:${span.spanId}`,
				spanRoute(traceId, span.spanId),
				"evidence.bundle.failed_spans",
				0.95,
				`Span ${spanLabel(span)} is marked as failed or has a status message.`,
				[
					{
						label: `trace ${traceId}`,
						entityKind: "trace",
						entityId: traceId,
						route: traceRoute(traceId),
					},
				],
			),
		);
	}

	for (const log of logExemplars.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`log:${log.logId}`,
				"log",
				log.logId,
				logRoute(log.logId),
				"evidence.bundle.log_exemplars",
				log.severity === "ERROR" || log.severity === "FATAL" ? 0.9 : 0.7,
				`${log.severity} log exemplar: ${log.message}`,
				[
					{
						label: `trace ${traceId}`,
						entityKind: "trace",
						entityId: traceId,
						route: traceRoute(traceId),
					},
				],
			),
		);
	}

	for (const profile of profiles.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`profile:${profile.id}`,
				"profile",
				profile.id,
				profileRoute(profile.id, traceId),
				"evidence.bundle.connected_profiles",
				0.85,
				`${profile.profile_type} profile covers trace ${traceId} for ${profile.duration_ms}ms.`,
				[
					{
						label: `trace ${traceId}`,
						entityKind: "trace",
						entityId: traceId,
						route: traceRoute(traceId),
					},
				],
			),
		);
	}

	return refs;
};

const buildTraceBundle = async (
	projectId: string,
	detail: TelemetryTraceDetailResponse,
	logs: LogRecord[],
	profiles: ProfileEvidenceRow[],
	intent: EvidenceBundleIntent,
	targetTokens: number,
	detailLevel: EvidenceBundleDetailLevel,
	hours: number,
): Promise<EvidenceBundle> => {
	const traceId = detail.trace.traceId;
	const traceRefId = encodeRef({ kind: "trace", projectId, traceId });
	const logsRefId = encodeRef({
		kind: "logs",
		projectId,
		traceId,
		hours,
		limit: MAX_LOGS_FOR_RETRIEVAL,
	});
	const { compactions, exemplars } = clusterLogs(traceId, logs, logsRefId);
	const failed = failedSpans(detail.spans);
	const critical = criticalPath(detail.spans);
	const evidenceReferences = traceEvidenceReferences(
		detail,
		exemplars,
		profiles,
	);
	const retrievalRefs: EvidenceRetrievalRef[] = [
		{
			refId: traceRefId,
			kind: "trace",
			anchor: { entityKind: "trace", entityId: traceId },
			source: "evidence.bundle.trace_detail",
			query: { traceId },
			compactedFrom: {
				recordCount: detail.spans.length,
				tokenEstimate: estimateTokens(detail),
			},
			returned: {
				recordCount: critical.length,
				tokenEstimate: estimateTokens(critical),
			},
		},
		{
			refId: logsRefId,
			kind: "logs",
			anchor: { entityKind: "trace", entityId: traceId },
			source: "evidence.bundle.correlated_logs",
			query: { traceId, hours, limit: MAX_LOGS_FOR_RETRIEVAL },
			compactedFrom: {
				recordCount: logs.length,
				tokenEstimate: estimateTokens(logs),
			},
			returned: {
				recordCount: exemplars.length,
				tokenEstimate: estimateTokens(exemplars),
			},
		},
		...profiles.map(
			(profile): EvidenceRetrievalRef => ({
				refId: encodeRef({
					kind: "profile",
					projectId,
					traceId,
					profileId: profile.id,
					profileMode: "metadata",
				}),
				kind: "profile",
				anchor: { entityKind: "trace", entityId: traceId },
				source: "evidence.bundle.connected_profiles",
				query: { profileId: profile.id, traceId },
				compactedFrom: {
					recordCount: 1,
					byteEstimate: profile.blob_size_bytes,
				},
				returned: {
					recordCount: 1,
					tokenEstimate: estimateTokens(profile),
				},
			}),
		),
		...profiles.map(
			(profile): EvidenceRetrievalRef => ({
				refId: encodeRef({
					kind: "profile",
					projectId,
					traceId,
					profileId: profile.id,
					profileMode: "frames",
					limit: DEFAULT_PROFILE_FRAME_LIMIT,
				}),
				kind: "profile",
				anchor: { entityKind: "trace", entityId: traceId },
				source: "evidence.bundle.profile_frames",
				query: {
					profileId: profile.id,
					traceId,
					frameLimit: DEFAULT_PROFILE_FRAME_LIMIT,
				},
				compactedFrom: {
					recordCount: profile.sample_count ?? undefined,
					byteEstimate: profile.blob_size_bytes,
				},
			}),
		),
	];

	const suggestedNextPivots: EvidenceNextPivot[] = [
		{
			label: "Inspect full trace",
			entityKind: "trace",
			entityId: traceId,
			route: traceRoute(traceId),
			reason:
				"Retrieve the complete span tree if the critical path is insufficient.",
		},
	];

	if (failed[0]) {
		suggestedNextPivots.push({
			label: "Inspect failed span",
			entityKind: "span",
			entityId: `${traceId}:${failed[0].spanId}`,
			route: spanRoute(traceId, failed[0].spanId),
			reason: "Start with the failed span before expanding unrelated spans.",
		});
	}

	if (profiles[0]) {
		suggestedNextPivots.push({
			label: "Inspect connected profile",
			entityKind: "profile",
			entityId: profiles[0].id,
			route: profileRoute(profiles[0].id, traceId),
			reason:
				"Use the sampled profile to inspect code-level CPU or runtime hotspots.",
		});
	}

	const derivedSummaries = [
		{
			title: "Trace critical path",
			reason:
				critical.length > 0
					? `Top span by duration is ${spanLabel(critical[0])} at ${critical[0].durationMs}ms.`
					: "Trace has no spans available for critical path computation.",
			confidence: critical.length > 0 ? 0.9 : 0.2,
			evidenceIds: critical.map((span) => `span:${traceId}:${span.spanId}`),
			retrievalRefIds: [traceRefId],
		},
		{
			title: "Correlated logs",
			reason:
				logs.length > exemplars.length
					? `${logs.length} correlated log(s) were reduced to ${exemplars.length} exemplar(s).`
					: `${logs.length} correlated log(s) were included without lossy compaction.`,
			confidence: 0.85,
			evidenceIds: exemplars.map((log) => `log:${log.logId}`),
			retrievalRefIds: [logsRefId],
		},
		{
			title: "Connected profiles",
			reason:
				profiles.length > 0
					? `${profiles.length} profile(s) are indexed to this trace.`
					: "No profile metadata is indexed to this trace.",
			confidence: profiles.length > 0 ? 0.85 : 0.5,
			evidenceIds: profiles.map((profile) => `profile:${profile.id}`),
			retrievalRefIds: retrievalRefs
				.filter((ref) => ref.kind === "profile")
				.map((ref) => ref.refId),
		},
	];

	const findings =
		failed.length > 0
			? [
					{
						title: "Failed span present",
						reason: `Trace contains ${failed.length} failed or status-message span(s).`,
						confidence: 0.9,
						evidenceIds: failed
							.slice(0, 5)
							.map((span) => `span:${traceId}:${span.spanId}`),
						retrievalRefIds: [traceRefId],
					},
				]
			: [];

	const bundle: EvidenceBundle = {
		schemaVersion: BUNDLE_SCHEMA_VERSION,
		intent,
		anchor: { entityKind: "trace", entityId: traceId },
		budget: {
			targetTokens,
			detailLevel,
		},
		summary:
			failed.length > 0
				? `Trace ${traceId} has ${failed.length} failed/status span(s), ${detail.spans.length} total span(s), ${logs.length} correlated log(s), and ${profiles.length} connected profile(s).`
				: `Trace ${traceId} has ${detail.spans.length} span(s), ${logs.length} correlated log(s), and ${profiles.length} connected profile(s); no failed spans were detected.`,
		derivedSummaries,
		findings,
		compactions,
		evidenceReferences,
		retrievalRefs,
		suggestedNextPivots,
	};
	bundle.budget = {
		targetTokens,
		detailLevel,
		estimatedTokens: estimateTokens(bundle),
	};
	return bundle;
};

const actionGraphRouteFor = (
	kind: "action" | "agent_run" | "tool_call",
	id: string,
) => {
	switch (kind) {
		case "action":
			return actionRoute(id);
		case "agent_run":
			return agentRunRoute(id);
		case "tool_call":
			return toolCallRoute(id);
	}
};

const loadManifestForAnchor = async (
	db: SqlDb,
	projectId: string,
	kind: "action" | "agent_run" | "tool_call",
	id: string,
): Promise<{ manifest: EntityManifestExtended; found: boolean }> => {
	const index = new IdentityIndex(db);
	if (kind === "action") {
		const manifest = await index.byAction(projectId, id);
		return {
			manifest,
			found: manifest.actions.some((action) => action.id === id),
		};
	}
	if (kind === "agent_run") {
		const manifest = await index.byAgentRun(projectId, id);
		return {
			manifest,
			found: manifest.agentRuns.some((run) => run.id === id),
		};
	}

	const toolCallRow = await db
		.prepare(
			`SELECT action_id FROM tool_calls
			 WHERE project_id = ? AND id = ? LIMIT 1`,
		)
		.bind(projectId, id)
		.first<{ action_id: string }>();
	if (!toolCallRow) {
		return {
			manifest: await index.byAction(projectId, "__missing__"),
			found: false,
		};
	}
	const manifest = await index.byAction(projectId, toolCallRow.action_id);
	return {
		manifest,
		found: manifest.toolCalls.some((tool) => tool.id === id),
	};
};

const causalPath = (manifest: EntityManifestExtended): ActionRef[] => {
	const byId = new Map(manifest.actions.map((action) => [action.id, action]));
	const roots = manifest.actions.filter(
		(action) => !action.causedByActionId || !byId.has(action.causedByActionId),
	);
	const root = roots[0] ?? manifest.actions[0];
	if (!root) return [];

	const children = new Map<string, ActionRef[]>();
	for (const action of manifest.actions) {
		if (!action.causedByActionId) continue;
		const list = children.get(action.causedByActionId) ?? [];
		list.push(action);
		children.set(action.causedByActionId, list);
	}

	const path: ActionRef[] = [];
	let current: ActionRef | undefined = root;
	while (current) {
		path.push(current);
		const nextChildren: ActionRef[] | undefined = children
			.get(current.id)
			?.sort((a, b) => {
				const status = Number(b.status !== "ok") - Number(a.status !== "ok");
				if (status !== 0) return status;
				return (b.durationMs ?? 0) - (a.durationMs ?? 0);
			});
		current = nextChildren?.[0];
	}
	return path;
};

const actionEvidenceReferences = (
	anchorKind: "action" | "agent_run" | "tool_call",
	anchorId: string,
	manifest: EntityManifestExtended,
	profiles: ProfileEvidenceRow[],
): EvidenceReference[] => {
	const refs: EvidenceReference[] = [
		evidenceRef(
			`${anchorKind}:${anchorId}`,
			anchorKind,
			anchorId,
			actionGraphRouteFor(anchorKind, anchorId),
			"evidence.bundle.action_graph",
			1,
			`Action graph bundle for ${anchorKind} ${anchorId} includes ${manifest.actions.length} action(s), ${manifest.toolCalls.length} tool call(s), and ${manifest.evalResults.length} eval result(s).`,
		),
	];

	for (const tool of manifest.toolCalls.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`tool_call:${tool.id}`,
				"tool_call",
				tool.id,
				toolCallRoute(tool.id),
				"evidence.bundle.tool_calls",
				tool.sideEffect ? 0.95 : 0.8,
				`Tool ${tool.toolName} sideEffect=${Boolean(tool.sideEffect)} approvalState=${tool.approvalState ?? "unknown"}.`,
				[
					{
						label: `action ${tool.actionId}`,
						entityKind: "action",
						entityId: tool.actionId,
						route: actionRoute(tool.actionId),
					},
				],
			),
		);
	}

	for (const aiCall of manifest.aiCalls.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`ai_call:${aiCall.callId}`,
				"ai_call",
				aiCall.callId,
				aiCallRoute(aiCall.callId),
				"evidence.bundle.ai_calls",
				0.85,
				`AI call ${aiCall.provider}/${aiCall.modelName} cost=${(aiCall.totalCostUsd ?? 0).toFixed(6)} USD.`,
				aiCall.traceId
					? [
							{
								label: `trace ${aiCall.traceId}`,
								entityKind: "trace",
								entityId: aiCall.traceId,
								route: traceRoute(aiCall.traceId),
							},
						]
					: [],
			),
		);
	}

	if (manifest.replay) {
		refs.push(
			evidenceRef(
				`replay:${manifest.replay.sessionId}`,
				"replay",
				manifest.replay.sessionId,
				replayRoute(manifest.replay.sessionId),
				"evidence.bundle.session_replay",
				0.8,
				`Session replay has ${manifest.replay.eventsCount} event(s) across ${manifest.replay.chunkCount} chunk(s).`,
			),
		);
	}

	for (const profile of profiles.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`profile:${profile.id}`,
				"profile",
				profile.id,
				profileRoute(profile.id),
				"evidence.bundle.connected_profiles",
				0.8,
				`${profile.profile_type} profile is connected through this action graph's traces.`,
			),
		);
	}

	for (const evalResult of manifest.evalResults.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`eval:${evalResult.id}`,
				"eval",
				evalResult.id,
				`#/evals/${encodeURIComponent(evalResult.id)}`,
				"evidence.bundle.eval_results",
				evalResult.passed ? 0.75 : 0.9,
				`Eval ${evalResult.evaluatorName} ${evalResult.passed ? "passed" : "failed"}${evalResult.score === null ? "" : ` with score ${evalResult.score}`}.`,
				[
					{
						label: `action ${evalResult.actionId}`,
						entityKind: "action",
						entityId: evalResult.actionId,
						route: actionRoute(evalResult.actionId),
					},
				],
			),
		);
	}

	for (const span of manifest.spans.slice(0, 5)) {
		refs.push(
			evidenceRef(
				`span:${span.traceId}:${span.spanId}`,
				"span",
				`${span.traceId}:${span.spanId}`,
				spanRoute(span.traceId, span.spanId),
				"evidence.bundle.connected_spans",
				span.statusCode > 1 ? 0.9 : 0.7,
				`Connected span ${span.serviceName ?? "unknown"}:${span.spanName} status=${span.statusCode}.`,
			),
		);
	}

	return refs;
};

const buildActionGraphBundle = (
	projectId: string,
	anchorKind: "action" | "agent_run" | "tool_call",
	anchorId: string,
	manifest: EntityManifestExtended,
	profiles: ProfileEvidenceRow[],
	intent: EvidenceBundleIntent,
	targetTokens: number,
	detailLevel: EvidenceBundleDetailLevel,
): EvidenceBundle => {
	const graphRefId = encodeRef({
		kind: "action_graph",
		projectId,
		traceId: manifest.spans[0]?.traceId,
		anchorKind,
		anchorId,
	});
	const traceIds = Array.from(
		new Set(
			[
				...manifest.spans.map((span) => span.traceId),
				...manifest.logs.map((log) => log.traceId),
				...manifest.actions.map((action) => action.traceId),
			].filter((id): id is string => Boolean(id)),
		),
	).slice(0, 5);
	const retrievalRefs: EvidenceRetrievalRef[] = [
		{
			refId: graphRefId,
			kind: anchorKind,
			anchor: { entityKind: anchorKind, entityId: anchorId },
			source: "evidence.bundle.action_graph_manifest",
			query: { anchorKind, anchorId },
			compactedFrom: {
				recordCount:
					manifest.actions.length +
					manifest.toolCalls.length +
					manifest.evalResults.length +
					manifest.logs.length +
					manifest.spans.length +
					manifest.aiCalls.length +
					(manifest.replay ? 1 : 0) +
					profiles.length,
				tokenEstimate: estimateTokens(manifest),
			},
			returned: {
				recordCount: causalPath(manifest).length,
				tokenEstimate: estimateTokens(causalPath(manifest)),
			},
		},
		...traceIds.map(
			(traceId): EvidenceRetrievalRef => ({
				refId: encodeRef({ kind: "trace", projectId, traceId }),
				kind: "trace",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.connected_traces",
				query: { traceId },
			}),
		),
		...traceIds.map(
			(traceId): EvidenceRetrievalRef => ({
				refId: encodeRef({
					kind: "logs",
					projectId,
					traceId,
					hours: DEFAULT_HOURS,
					limit: MAX_LOGS_FOR_RETRIEVAL,
				}),
				kind: "logs",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.connected_logs",
				query: { traceId, hours: DEFAULT_HOURS, limit: MAX_LOGS_FOR_RETRIEVAL },
			}),
		),
		...manifest.toolCalls.map(
			(tool): EvidenceRetrievalRef => ({
				refId: encodeRef({ kind: "tool_call", projectId, toolCallId: tool.id }),
				kind: "tool_call",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.tool_call_payloads",
				query: { toolCallId: tool.id },
				compactedFrom: {
					recordCount: 1,
					tokenEstimate: estimateTokens(tool),
				},
				returned: {
					recordCount: 1,
					tokenEstimate: estimateTokens({
						id: tool.id,
						toolName: tool.toolName,
						argsHash: tool.argsHash,
						resultHash: tool.resultHash,
						argsRedacted: tool.argsRedacted,
						resultRedacted: tool.resultRedacted,
					}),
				},
			}),
		),
		...manifest.aiCalls.map(
			(aiCall): EvidenceRetrievalRef => ({
				refId: encodeRef({ kind: "ai_call", projectId, callId: aiCall.callId }),
				kind: "ai_call",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.ai_calls",
				query: { callId: aiCall.callId },
				compactedFrom: {
					recordCount: 1,
					tokenEstimate: estimateTokens(aiCall),
				},
				returned: {
					recordCount: 1,
					tokenEstimate: estimateTokens(aiCall),
				},
			}),
		),
		...(manifest.replay
			? [
					{
						refId: encodeRef({
							kind: "replay" as const,
							projectId,
							sessionId: manifest.replay.sessionId,
							replayMode: "metadata" as const,
						}),
						kind: "replay" as const,
						anchor: { entityKind: anchorKind, entityId: anchorId },
						source: "evidence.bundle.session_replay",
						query: { sessionId: manifest.replay.sessionId },
						compactedFrom: {
							recordCount: manifest.replay.eventsCount,
						},
						returned: {
							recordCount: 1,
							tokenEstimate: estimateTokens(manifest.replay),
						},
					},
				]
			: []),
		...(manifest.replay
			? [
					{
						refId: encodeRef({
							kind: "replay" as const,
							projectId,
							sessionId: manifest.replay.sessionId,
							replayMode: "events" as const,
							chunkOffset: 0,
							limit: DEFAULT_REPLAY_EVENT_CHUNKS,
						}),
						kind: "replay" as const,
						anchor: { entityKind: anchorKind, entityId: anchorId },
						source: "evidence.bundle.replay_event_window",
						query: {
							sessionId: manifest.replay.sessionId,
							chunkOffset: 0,
							chunkLimit: DEFAULT_REPLAY_EVENT_CHUNKS,
						},
						compactedFrom: {
							recordCount: manifest.replay.eventsCount,
						},
					},
				]
			: []),
		...profiles.map(
			(profile): EvidenceRetrievalRef => ({
				refId: encodeRef({
					kind: "profile",
					projectId,
					profileId: profile.id,
					profileMode: "metadata",
				}),
				kind: "profile",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.connected_profiles",
				query: { profileId: profile.id },
				compactedFrom: {
					recordCount: 1,
					byteEstimate: profile.blob_size_bytes,
				},
				returned: {
					recordCount: 1,
					tokenEstimate: estimateTokens(profile),
				},
			}),
		),
		...profiles.map(
			(profile): EvidenceRetrievalRef => ({
				refId: encodeRef({
					kind: "profile",
					projectId,
					profileId: profile.id,
					profileMode: "frames",
					limit: DEFAULT_PROFILE_FRAME_LIMIT,
				}),
				kind: "profile",
				anchor: { entityKind: anchorKind, entityId: anchorId },
				source: "evidence.bundle.profile_frames",
				query: {
					profileId: profile.id,
					frameLimit: DEFAULT_PROFILE_FRAME_LIMIT,
				},
				compactedFrom: {
					recordCount: profile.sample_count ?? undefined,
					byteEstimate: profile.blob_size_bytes,
				},
			}),
		),
	];

	const path = causalPath(manifest);
	const sideEffectTools = manifest.toolCalls.filter((tool) => tool.sideEffect);
	const failedEvals = manifest.evalResults.filter(
		(evalResult) => !evalResult.passed,
	);
	const failedActions = manifest.actions.filter(
		(action) => action.status !== "ok",
	);
	const totalCost = manifest.aiCalls.reduce(
		(sum, call) => sum + (call.totalCostUsd ?? 0),
		manifest.agentRuns.reduce(
			(sum, run) => sum + (run.totalCostUsd ?? 0),
			manifest.actions.reduce(
				(sum, action) => sum + (action.totalCostUsd ?? 0),
				0,
			),
		),
	);
	const evidenceReferences = actionEvidenceReferences(
		anchorKind,
		anchorId,
		manifest,
		profiles,
	);
	const suggestedNextPivots: EvidenceNextPivot[] = [
		{
			label: "Inspect action graph",
			entityKind: anchorKind,
			entityId: anchorId,
			route: actionGraphRouteFor(anchorKind, anchorId),
			reason: "Expand the full causal action graph and connected signals.",
		},
		...traceIds.slice(0, 3).map(
			(traceId): EvidenceNextPivot => ({
				label: "Inspect connected trace",
				entityKind: "trace",
				entityId: traceId,
				route: traceRoute(traceId),
				reason:
					"Inspect backend spans and logs connected to this action graph.",
			}),
		),
	];

	if (manifest.replay) {
		suggestedNextPivots.push({
			label: "Inspect session replay",
			entityKind: "replay",
			entityId: manifest.replay.sessionId,
			route: replayRoute(manifest.replay.sessionId),
			reason: "Inspect the user-visible path that led into the action graph.",
		});
	}

	if (profiles[0]) {
		suggestedNextPivots.push({
			label: "Inspect connected profile",
			entityKind: "profile",
			entityId: profiles[0].id,
			route: profileRoute(profiles[0].id),
			reason: "Inspect runtime hotspots connected through the graph traces.",
		});
	}

	const derivedSummaries = [
		{
			title: "Causal action path",
			reason:
				path.length > 0
					? `Representative causal path has ${path.length} action(s): ${path.map((action) => action.actionKind).join(" -> ")}.`
					: "No actions were available for causal path extraction.",
			confidence: path.length > 0 ? 0.9 : 0.2,
			evidenceIds: path.map((action) => `action:${action.id}`),
			retrievalRefIds: [graphRefId],
		},
		{
			title: "Tool side effects",
			reason:
				sideEffectTools.length > 0
					? `${sideEffectTools.length} side-effecting tool call(s) are connected to this graph.`
					: "No side-effecting tool calls are connected to this graph.",
			confidence: manifest.toolCalls.length > 0 ? 0.9 : 0.6,
			evidenceIds: sideEffectTools.map((tool) => `tool_call:${tool.id}`),
			retrievalRefIds: [graphRefId],
		},
		{
			title: "Cost and model context",
			reason: `Connected agent/action/AI records report total cost ${totalCost.toFixed(6)} USD across ${manifest.agentRuns.length} agent run(s) and ${manifest.aiCalls.length} AI call(s).`,
			confidence:
				manifest.agentRuns.length > 0 || manifest.actions.length > 0
					? 0.8
					: 0.3,
			evidenceIds: [
				...manifest.agentRuns.map((run) => `agent_run:${run.id}`),
				...manifest.aiCalls.map((call) => `ai_call:${call.callId}`),
			],
			retrievalRefIds: [graphRefId],
		},
		{
			title: "Replay and profile pivots",
			reason: `${manifest.replay ? "One session replay" : "No session replay"} and ${profiles.length} connected profile(s) are available for this graph.`,
			confidence: manifest.replay || profiles.length > 0 ? 0.8 : 0.45,
			evidenceIds: [
				...(manifest.replay ? [`replay:${manifest.replay.sessionId}`] : []),
				...profiles.map((profile) => `profile:${profile.id}`),
			],
			retrievalRefIds: retrievalRefs
				.filter((ref) => ref.kind === "replay" || ref.kind === "profile")
				.map((ref) => ref.refId),
		},
	];

	const findings = [
		...sideEffectTools.map((tool) => ({
			title: "Side-effecting tool call present",
			reason: `Tool ${tool.toolName} can mutate state and has approvalState=${tool.approvalState ?? "unknown"}.`,
			confidence: 0.9,
			evidenceIds: [`tool_call:${tool.id}`],
			retrievalRefIds: [graphRefId],
		})),
		...failedEvals.map((evalResult) => ({
			title: "Failed eval present",
			reason: `Eval ${evalResult.evaluatorName} failed${evalResult.reasoning ? `: ${evalResult.reasoning}` : "."}`,
			confidence: 0.9,
			evidenceIds: [`eval:${evalResult.id}`],
			retrievalRefIds: [graphRefId],
		})),
		...failedActions.slice(0, 3).map((action) => ({
			title: "Non-ok action present",
			reason: `Action ${action.id} has status ${action.status}.`,
			confidence: 0.85,
			evidenceIds: [`action:${action.id}`],
			retrievalRefIds: [graphRefId],
		})),
		...manifest.aiCalls
			.filter((call) => (call.totalCostUsd ?? 0) > 0)
			.slice(0, 3)
			.map((call) => ({
				title: "AI call cost present",
				reason: `AI call ${call.callId} reports cost ${(call.totalCostUsd ?? 0).toFixed(6)} USD.`,
				confidence: 0.75,
				evidenceIds: [`ai_call:${call.callId}`],
				retrievalRefIds: retrievalRefs
					.filter((ref) => ref.kind === "ai_call")
					.map((ref) => ref.refId),
			})),
	];

	const bundle: EvidenceBundle = {
		schemaVersion: BUNDLE_SCHEMA_VERSION,
		intent,
		anchor: { entityKind: anchorKind, entityId: anchorId },
		budget: { targetTokens, detailLevel },
		summary: `${anchorKind} ${anchorId} bundle includes ${manifest.actions.length} action(s), ${manifest.toolCalls.length} tool call(s), ${manifest.evalResults.length} eval result(s), ${manifest.spans.length} span(s), ${manifest.logs.length} log(s), ${manifest.aiCalls.length} AI call(s), ${profiles.length} profile(s), and ${manifest.replay ? 1 : 0} replay(s).`,
		derivedSummaries,
		findings,
		compactions: [],
		evidenceReferences,
		retrievalRefs,
		suggestedNextPivots,
	};
	bundle.budget = {
		targetTokens,
		detailLevel,
		estimatedTokens: estimateTokens(bundle),
	};
	return bundle;
};

/**
 * Resolves the trace to enrich an anchor with. Prefers the anchor's own
 * symptom entity (a trace id, or the trace owning a span); only when that
 * cannot be resolved does it fall back to the most recent error span in the
 * environment (a heuristic: it may belong to an unrelated request).
 */
const resolveAnchorTraceId = async (
	db: SqlDb,
	projectId: string,
	environment: string,
	symptom?: { kind: string; id: string } | null,
): Promise<string | null> => {
	if (symptom?.id) {
		if (symptom.kind === "trace") {
			const row = await db
				.prepare(
					`SELECT trace_id FROM telemetry_spans
					 WHERE project_id = ? AND trace_id = ? LIMIT 1`,
				)
				.bind(projectId, symptom.id)
				.first<{ trace_id: string }>();
			if (row?.trace_id) return row.trace_id;
		} else if (symptom.kind === "span") {
			const row = await db
				.prepare(
					`SELECT trace_id FROM telemetry_spans
					 WHERE project_id = ? AND span_id = ? LIMIT 1`,
				)
				.bind(projectId, symptom.id)
				.first<{ trace_id: string }>();
			if (row?.trace_id) return row.trace_id;
		}
	}
	const recent = await db
		.prepare(
			`SELECT trace_id FROM telemetry_spans
			 WHERE project_id = ? AND environment = ? AND status_code = 2
			 ORDER BY start_time DESC LIMIT 1`,
		)
		.bind(projectId, environment)
		.first<{ trace_id: string }>();
	return recent?.trace_id ?? null;
};

const attachAutoSreTriageContext = async (
	db: SqlDb,
	projectId: string,
	traceId: string | null,
	bundle: EvidenceBundle,
	logger?: { warn: (message: string, meta?: Record<string, unknown>) => void },
): Promise<EvidenceBundle> => {
	try {
		const faultLocus = traceId
			? await loadTraceFaultLocusFromDb(db, projectId, traceId)
			: null;
		const environment = (
			faultLocus?.faultLocusSpan?.environment ??
			bundle.environment ??
			"default"
		).toLowerCase();
		const locusService = faultLocus?.faultLocusSpan?.service_name ?? null;
		const allRecentChanges = await listChangeEvents(db, {
			projectId,
			environment,
			limit: locusService ? 25 : 5,
		});
		// When the fault locus service is known, only changes that target it
		// (or its node) are candidates; unrelated deploys are noise.
		const recentChanges = locusService
			? allRecentChanges
					.filter(
						(ch) =>
							ch.serviceName === locusService ||
							(faultLocus?.faultLocusNodeId &&
								ch.targetNodeId === faultLocus.faultLocusNodeId),
					)
					.slice(0, 5)
			: allRecentChanges;
		const blastRadii = (
			await Promise.all(
				recentChanges
					.slice(0, 3)
					.map((ch) =>
						computeChangeBlastRadius(db, projectId, ch.id, { environment }),
					),
			)
		).filter((br): br is NonNullable<typeof br> => Boolean(br));

		const candidateChanges = blastRadii.map((br) => ({
			changeId: br.change.id,
			kind: br.change.kind,
			version: br.change.version,
			previousVersion: br.change.previousVersion,
			occurredAt: br.change.occurredAt,
			cohortVerdict: br.cohortVerdict,
			causalProofTier: br.causalProofTier,
			rateNew: br.newCohort.errorRate,
			rateOld: br.oldCohort.errorRate,
			sampleNew: br.newCohort.requestCount,
			sampleOld: br.oldCohort.requestCount,
			overlappingCodePaths: br.overlappingCodePaths,
		}));
		const contentionCandidates = blastRadii
			.flatMap((br) => br.sharedResourceAggressors)
			.map((ag) => ({
				aggressorTraceId: ag.aggressorTraceId,
				aggressorSpanId: ag.aggressorSpanId,
				aggressorServiceName: ag.aggressorServiceName,
				sharedTargetNodeId: ag.sharedTargetNodeId,
				relationshipCertainty: ag.relationshipCertainty,
				totalResourceTimeMs: ag.totalResourceTimeMs,
			}));
		let priorFindingsList = await searchInvestigationFindings(db, {
			projectId,
			environment,
			rootCauseEntityId:
				faultLocus?.faultLocusNodeId ??
				faultLocus?.faultLocusSpan?.span_id ??
				undefined,
			limit: 5,
		});
		if (priorFindingsList.length === 0 && faultLocus?.faultLocusSpan?.span_id) {
			priorFindingsList = await searchInvestigationFindings(db, {
				projectId,
				environment,
				rootCauseEntityId: faultLocus.faultLocusSpan.span_id,
				limit: 5,
			});
		}
		// No unfiltered fallback: unrelated findings would read as relevant
		// prior art. An empty list is the honest answer.
		const priorFindings = priorFindingsList.map((f) => ({
			findingId: f.id,
			title: f.title,
			causalProofTier: f.causalProofTier,
			causalVerificationStatus: f.causalVerificationStatus,
			recoveryStatus: f.recoveryStatus,
			contributingChangeId: f.contributingChangeId,
			occurredAt: f.createdAt,
		}));

		for (const br of blastRadii) {
			const changeId = br.change.id;
			const changeRoute = `#/changes/${encodeURIComponent(changeId)}`;
			bundle.evidenceReferences.push({
				evidenceId: `change:${changeId}`,
				entityKind: "change",
				entityId: changeId,
				route: changeRoute,
				source: br.overlappingCodePaths.length
					? "stack_frame_overlap"
					: "cohort_comparison",
				confidence: br.cohortVerdict === "isolated_to_new_version" ? 0.9 : 0.65,
				relationshipCertainty: br.relationshipCertainty,
				causalProofTier: br.causalProofTier,
				reason: br.summary,
				citations: [
					{
						label: `change ${changeId} (${br.change.version ?? br.change.kind})`,
						entityKind: "change",
						entityId: changeId,
						route: changeRoute,
					},
				],
				suggestedNextPivots: [
					{
						label: "Inspect change blast radius",
						entityKind: "change",
						entityId: changeId,
						route: changeRoute,
						reason: "Inspect traffic-normalized cohort lift and contention.",
					},
				],
			});
		}

		for (const finding of priorFindingsList) {
			const findingRoute = `#/findings/${encodeURIComponent(finding.id)}`;
			bundle.evidenceReferences.push({
				evidenceId: `finding:${finding.id}`,
				entityKind: "finding",
				entityId: finding.id,
				route: findingRoute,
				source: "incident_memory_fingerprint",
				confidence: finding.confidence,
				relationshipCertainty: "exact",
				causalProofTier: finding.causalProofTier,
				reason: `Prior finding (${finding.causalProofTier}): ${finding.title}`,
				citations: [
					{
						label: finding.title,
						entityKind: "finding",
						entityId: finding.id,
						route: findingRoute,
					},
				],
				suggestedNextPivots: [
					{
						label: "Open prior finding",
						entityKind: "finding",
						entityId: finding.id,
						route: findingRoute,
						reason: "Search incident memory for similar recurring findings.",
					},
				],
			});
		}

		let isBlackoutSuspected = false;
		if (faultLocus?.faultLocusNodeId) {
			try {
				const graph = await getOntologyGraph(db, { projectId, environment });
				isBlackoutSuspected = Boolean(
					graph.nodes.find((n) => n.id === faultLocus.faultLocusNodeId)
						?.isBlackoutSuspected,
				);
			} catch (err) {
				logger?.warn("[evidence-retrieval] blackout check failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		bundle.autosre = {
			faultLocus: faultLocus?.faultLocusNodeId
				? {
						nodeId: faultLocus.faultLocusNodeId,
						spanId: faultLocus.faultLocusSpan?.span_id,
						relationshipCertainty: faultLocus.relationshipCertainty,
						isBlackoutSuspected,
					}
				: undefined,
			candidateChanges,
			contentionCandidates,
			priorFindings,
		};
		if (bundle.budget) {
			// Keep the autosre section inside the caller's token budget by
			// dropping the least-relevant tail entries (and their evidence refs).
			const autosre = bundle.autosre;
			const target = bundle.budget.targetTokens ?? Number.POSITIVE_INFINITY;
			const dropRef = (evidenceId: string) => {
				bundle.evidenceReferences = bundle.evidenceReferences.filter(
					(ref) => ref.evidenceId !== evidenceId,
				);
			};
			while (estimateTokens(bundle) > target) {
				if (autosre.priorFindings.length > 0) {
					const dropped = autosre.priorFindings.pop();
					if (dropped) dropRef(`finding:${dropped.findingId}`);
				} else if (autosre.contentionCandidates.length > 0) {
					autosre.contentionCandidates.pop();
				} else if (autosre.candidateChanges.length > 0) {
					const dropped = autosre.candidateChanges.pop();
					if (dropped) dropRef(`change:${dropped.changeId}`);
				} else {
					break;
				}
			}
			bundle.budget = {
				...bundle.budget,
				estimatedTokens: estimateTokens(bundle),
			};
		}
	} catch (err) {
		// Gracefully degrade if AutoSRE tables are absent in minimal test setups.
		logger?.warn("[evidence-retrieval] autosre triage enrichment skipped", {
			trace_id: traceId,
			error: err instanceof Error ? err.message : String(err),
		});
	}
	return bundle;
};

const parseBundleRequest = async (request: Request) => {
	try {
		const body = await request.json();
		return body && typeof body === "object"
			? (body as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

export const evidenceRetrievalRoutesPlugin: CollectorPlugin = {
	name: "evidence-retrieval-routes",
	register(app, runtime) {
		app.post("/internal/evidence/bundle", async (c) => {
			const projectId = getProjectId(c);
			const body = await parseBundleRequest(c.req.raw);
			const anchor = body.anchor as
				| { entityKind?: unknown; entityId?: unknown }
				| undefined;
			if (!anchor || typeof anchor.entityId !== "string" || !anchor.entityId) {
				return c.json(
					{
						error: "Bad Request",
						message: "anchor.entityKind and anchor.entityId are required.",
					},
					400,
				);
			}

			const intent =
				typeof body.intent === "string" &&
				EVIDENCE_INTENTS.has(body.intent as EvidenceBundleIntent)
					? (body.intent as EvidenceBundleIntent)
					: "debug_failure";
			const budget = body.budget as Record<string, unknown> | undefined;
			const targetTokens = clampInt(
				budget?.targetTokens,
				500,
				30000,
				DEFAULT_TARGET_TOKENS,
			);
			const detailLevel =
				budget?.detailLevel === "brief" ||
				budget?.detailLevel === "standard" ||
				budget?.detailLevel === "deep"
					? budget.detailLevel
					: "standard";
			const hours = clampInt(body.hours, 1, 720, DEFAULT_HOURS);
			const db = runtime.getSqlDb(c.env);
			if (
				anchor.entityKind === "action" ||
				anchor.entityKind === "agent_run" ||
				anchor.entityKind === "tool_call"
			) {
				const { manifest, found } = await loadManifestForAnchor(
					db,
					projectId,
					anchor.entityKind,
					anchor.entityId,
				);
				if (!found) {
					return c.json(
						{
							error: "Not Found",
							message: `${anchor.entityKind} not found`,
						},
						404,
					);
				}
				const traceIds = Array.from(
					new Set(
						[
							...manifest.spans.map((span) => span.traceId),
							...manifest.logs.map((log) => log.traceId),
							...manifest.actions.map((action) => action.traceId),
						].filter((id): id is string => Boolean(id)),
					),
				).slice(0, 5);
				const profiles = (
					await Promise.all(
						traceIds.map((traceId) => profilesForTrace(db, projectId, traceId)),
					)
				)
					.flat()
					.filter(
						(profile, index, all) =>
							all.findIndex((candidate) => candidate.id === profile.id) ===
							index,
					);
				let bundle = buildActionGraphBundle(
					projectId,
					anchor.entityKind,
					anchor.entityId,
					manifest,
					profiles,
					intent,
					targetTokens,
					detailLevel,
				);
				if (intent === "triage_incident") {
					bundle = await attachAutoSreTriageContext(
						db,
						projectId,
						traceIds[0] ?? null,
						bundle,
						runtime.logger,
					);
				}
				return c.json(await materializeBundle(db, projectId, bundle));
			}

			if (anchor.entityKind === "incident") {
				const incident = await getIncidentInvestigation(
					db,
					projectId,
					anchor.entityId,
				);
				if (!incident) {
					return c.json(
						{ error: "Not Found", message: "Incident not found" },
						404,
					);
				}
				const anchorTraceId = await resolveAnchorTraceId(
					db,
					projectId,
					incident.environment,
					{ kind: incident.symptomAnchorKind, id: incident.symptomAnchorId },
				);

				const incRoute = `#/incidents/${encodeURIComponent(incident.id)}`;
				const baseBundle: EvidenceBundle = {
					schemaVersion: BUNDLE_SCHEMA_VERSION,
					intent,
					environment: incident.environment,
					incidentId: incident.id,
					symptomFingerprint: incident.symptomFingerprint ?? undefined,
					anchor: { entityKind: "incident", entityId: incident.id },
					budget: { targetTokens, detailLevel },
					summary: `Incident ${incident.id} (${incident.status}) on ${incident.targetNodeId} in environment ${incident.environment}.`,
					derivedSummaries: [
						{
							title: `Incident ${incident.id}`,
							reason: `Trigger ${incident.symptomAnchorKind}:${incident.symptomAnchorId} on ${incident.targetNodeId} (status=${incident.status}).`,
							confidence: 1.0,
							evidenceIds: [`incident:${incident.id}`],
							retrievalRefIds: [],
						},
					],
					findings: [],
					compactions: [],
					evidenceReferences: [
						{
							evidenceId: `incident:${incident.id}`,
							entityKind: "incident",
							entityId: incident.id,
							route: incRoute,
							source: "incident_investigations",
							confidence: 1.0,
							relationshipCertainty: "exact",
							reason: `Incident triggered by ${incident.symptomAnchorKind}:${incident.symptomAnchorId}.`,
							citations: [
								{
									label: incident.targetNodeId,
									entityKind: "incident",
									entityId: incident.id,
									route: incRoute,
								},
							],
							suggestedNextPivots: [
								{
									label: "Open incident",
									entityKind: "incident",
									entityId: incident.id,
									route: incRoute,
									reason:
										"Inspect incident investigation and candidate changes.",
								},
							],
						},
					],
					retrievalRefs: [],
					suggestedNextPivots: [
						{
							label: "Open incident",
							entityKind: "incident",
							entityId: incident.id,
							route: incRoute,
							reason: "Inspect incident investigation and candidate changes.",
						},
					],
				};
				const enriched = await attachAutoSreTriageContext(
					db,
					projectId,
					anchorTraceId,
					baseBundle,
					runtime.logger,
				);
				return c.json(await materializeBundle(db, projectId, enriched));
			}

			if (anchor.entityKind === "change") {
				const change = await getChangeEvent(db, projectId, anchor.entityId);
				if (!change) {
					return c.json(
						{ error: "Not Found", message: "Change event not found" },
						404,
					);
				}
				const blastRadius = await computeChangeBlastRadius(
					db,
					projectId,
					change.id,
					{ environment: change.environment },
				);
				const anchorTraceId = await resolveAnchorTraceId(
					db,
					projectId,
					change.environment,
					null,
				);

				const changeRoute = `#/changes/${encodeURIComponent(change.id)}`;
				const summary =
					blastRadius?.summary ??
					`Change ${change.id} (${change.kind} ${change.version ?? ""}) in ${change.environment}: ${change.summary}`;
				const baseBundle: EvidenceBundle = {
					schemaVersion: BUNDLE_SCHEMA_VERSION,
					intent,
					environment: change.environment,
					anchor: { entityKind: "change", entityId: change.id },
					budget: { targetTokens, detailLevel },
					summary,
					derivedSummaries: [
						{
							title: `Change ${change.id} (${change.kind})`,
							reason: summary,
							confidence:
								blastRadius?.cohortVerdict === "isolated_to_new_version"
									? 0.9
									: 0.7,
							evidenceIds: [`change:${change.id}`],
							retrievalRefIds: [],
						},
					],
					findings: blastRadius
						? [
								{
									title: `Blast radius (${blastRadius.cohortVerdict})`,
									reason: blastRadius.summary,
									confidence:
										blastRadius.cohortVerdict === "isolated_to_new_version"
											? 0.9
											: 0.65,
									evidenceIds: [`change:${change.id}`],
									retrievalRefIds: [],
								},
							]
						: [],
					compactions: [],
					evidenceReferences: [
						{
							evidenceId: `change:${change.id}`,
							entityKind: "change",
							entityId: change.id,
							route: changeRoute,
							source: "change_events",
							confidence: 1.0,
							relationshipCertainty:
								blastRadius?.relationshipCertainty ??
								change.relationshipCertainty,
							causalProofTier: blastRadius?.causalProofTier,
							reason: summary,
							citations: [
								{
									label: `${change.kind} ${change.version ?? change.id}`,
									entityKind: "change",
									entityId: change.id,
									route: changeRoute,
								},
							],
							suggestedNextPivots: [
								{
									label: "Inspect change blast radius",
									entityKind: "change",
									entityId: change.id,
									route: changeRoute,
									reason:
										"Inspect traffic-normalized cohort lift and contention.",
								},
							],
						},
					],
					retrievalRefs: [],
					suggestedNextPivots: [
						{
							label: "Inspect change blast radius",
							entityKind: "change",
							entityId: change.id,
							route: changeRoute,
							reason: "Inspect traffic-normalized cohort lift and contention.",
						},
					],
				};
				const enriched = await attachAutoSreTriageContext(
					db,
					projectId,
					anchorTraceId,
					baseBundle,
					runtime.logger,
				);
				return c.json(await materializeBundle(db, projectId, enriched));
			}

			if (anchor.entityKind === "finding") {
				const finding = await getInvestigationFinding(
					db,
					projectId,
					anchor.entityId,
				);
				if (!finding) {
					return c.json(
						{ error: "Not Found", message: "Finding not found" },
						404,
					);
				}
				const proposals = await listRemediationProposals(db, {
					projectId,
					environment: finding.environment,
					findingId: finding.id,
					limit: 10,
				});
				const anchorTraceId = await resolveAnchorTraceId(
					db,
					projectId,
					finding.environment,
					{ kind: finding.symptomEntityKind, id: finding.symptomEntityId },
				);

				const findingRoute = `#/findings/${encodeURIComponent(finding.id)}`;
				const summary = `${finding.title} (${finding.causalProofTier}, verification=${finding.causalVerificationStatus}, recovery=${finding.recoveryStatus}): ${finding.summary}`;
				const baseBundle: EvidenceBundle = {
					schemaVersion: BUNDLE_SCHEMA_VERSION,
					intent,
					environment: finding.environment,
					incidentId: finding.incidentId ?? undefined,
					symptomFingerprint: finding.fingerprint,
					anchor: { entityKind: "finding", entityId: finding.id },
					budget: { targetTokens, detailLevel },
					summary,
					derivedSummaries: [
						{
							title: finding.title,
							reason: summary,
							confidence: finding.confidence,
							evidenceIds: [`finding:${finding.id}`],
							retrievalRefIds: [],
						},
					],
					findings: [
						{
							title: finding.title,
							reason: finding.summary,
							confidence: finding.confidence,
							evidenceIds: [
								`finding:${finding.id}`,
								...finding.citedEvidenceIds,
							],
							retrievalRefIds: [],
						},
						...proposals.map((p) => ({
							title: `Remediation proposal ${p.id} (${p.actionKind})`,
							reason: `status=${p.status}, autonomy=${p.effectiveAutonomy} — ${p.policyDecisionReason}`,
							confidence: finding.confidence,
							evidenceIds: [`finding:${finding.id}`],
							retrievalRefIds: [],
						})),
					],
					compactions: [],
					evidenceReferences: [
						{
							evidenceId: `finding:${finding.id}`,
							entityKind: "finding",
							entityId: finding.id,
							route: findingRoute,
							source: "investigation_findings",
							confidence: finding.confidence,
							relationshipCertainty: "exact",
							causalProofTier: finding.causalProofTier,
							reason: summary,
							citations: [
								{
									label: finding.title,
									entityKind: "finding",
									entityId: finding.id,
									route: findingRoute,
								},
							],
							suggestedNextPivots: [
								{
									label: "Open finding",
									entityKind: "finding",
									entityId: finding.id,
									route: findingRoute,
									reason:
										"Inspect causal chain, counterfactual verification, and remediation proposals.",
								},
							],
						},
					],
					retrievalRefs: [],
					suggestedNextPivots: [
						{
							label: "Open finding",
							entityKind: "finding",
							entityId: finding.id,
							route: findingRoute,
							reason:
								"Inspect causal chain, counterfactual verification, and remediation proposals.",
						},
					],
				};
				const enriched = await attachAutoSreTriageContext(
					db,
					projectId,
					anchorTraceId,
					baseBundle,
					runtime.logger,
				);
				return c.json(await materializeBundle(db, projectId, enriched));
			}

			if (anchor.entityKind !== "trace") {
				return c.json(
					{
						error: "Bad Request",
						message:
							"Supported evidence bundle anchors are trace, action, agent_run, tool_call, change, finding, and incident.",
					},
					400,
				);
			}

			const traceId = anchor.entityId;
			const store = runtime.createStore(c.env);
			const detail = await store.getTraceDetail(traceId, projectId);
			if (!detail) {
				return c.json({ error: "Not Found", message: "Trace not found" }, 404);
			}

			const logs = await new LogsStore(db).getLogs({
				projectId,
				traceId,
				hours,
				limit: MAX_LOGS_FOR_BUNDLE,
			});
			const profiles = await profilesForTrace(db, projectId, traceId);
			let bundle = await buildTraceBundle(
				projectId,
				detail,
				logs.logs,
				profiles,
				intent,
				targetTokens,
				detailLevel,
				hours,
			);
			if (intent === "triage_incident") {
				bundle = await attachAutoSreTriageContext(
					db,
					projectId,
					traceId,
					bundle,
					runtime.logger,
				);
			}
			return c.json(await materializeBundle(db, projectId, bundle));
		});

		app.get("/internal/evidence/stats", async (c) => {
			const projectId = getProjectId(c);
			const db = runtime.getSqlDb(c.env);
			const limit = clampInt(c.req.query("limit"), 1, 100, 20);
			try {
				const [byKind, bySource, recentRefs, recentExpansions] =
					await Promise.all([
						db
							.prepare(
								`SELECT
								r.kind AS kind,
								COUNT(DISTINCT r.ref_id) AS issuedCount,
								COUNT(e.id) AS expansionCount
							 FROM evidence_retrieval_refs r
							 LEFT JOIN evidence_ref_expansions e
								ON e.project_id = r.project_id AND e.ref_id = r.ref_id
							 WHERE r.project_id = ?
							 GROUP BY r.kind
							 ORDER BY expansionCount DESC, issuedCount DESC`,
							)
							.bind(projectId)
							.all<{
								kind: string;
								issuedCount: number;
								expansionCount: number;
							}>(),
						db
							.prepare(
								`SELECT
								r.source AS source,
								r.kind AS kind,
								COUNT(DISTINCT r.ref_id) AS issuedCount,
								COUNT(e.id) AS expansionCount
							 FROM evidence_retrieval_refs r
							 LEFT JOIN evidence_ref_expansions e
								ON e.project_id = r.project_id AND e.ref_id = r.ref_id
							 WHERE r.project_id = ?
							 GROUP BY r.source, r.kind
							 ORDER BY expansionCount DESC, issuedCount DESC
							 LIMIT ?`,
							)
							.bind(projectId, limit)
							.all<{
								source: string;
								kind: string;
								issuedCount: number;
								expansionCount: number;
							}>(),
						db
							.prepare(
								`SELECT ref_id, kind, anchor_kind, anchor_id, source,
									last_seen_at, issued_at
							 FROM evidence_retrieval_refs
							 WHERE project_id = ?
							 ORDER BY last_seen_at DESC
							 LIMIT ?`,
							)
							.bind(projectId, limit)
							.all<{
								ref_id: string;
								kind: string;
								anchor_kind: string;
								anchor_id: string;
								source: string;
								last_seen_at: string;
								issued_at: string;
							}>(),
						db
							.prepare(
								`SELECT id, ref_id, kind, source, operation, result_status,
									limit_value, query_text, expanded_at
							 FROM evidence_ref_expansions
							 WHERE project_id = ?
							 ORDER BY expanded_at DESC
							 LIMIT ?`,
							)
							.bind(projectId, limit)
							.all<{
								id: string;
								ref_id: string;
								kind: string;
								source: string | null;
								operation: string;
								result_status: string;
								limit_value: number | null;
								query_text: string | null;
								expanded_at: string;
							}>(),
					]);
				return c.json({
					projectId,
					generatedAt: new Date().toISOString(),
					byKind: byKind.results.map((row) => ({
						kind: row.kind,
						issuedCount: row.issuedCount,
						expansionCount: row.expansionCount,
					})),
					bySource: bySource.results.map((row) => ({
						source: row.source,
						kind: row.kind,
						issuedCount: row.issuedCount,
						expansionCount: row.expansionCount,
					})),
					recentRefs: recentRefs.results.map((row) => ({
						refId: row.ref_id,
						kind: row.kind,
						anchor: {
							entityKind: row.anchor_kind,
							entityId: row.anchor_id,
						},
						source: row.source,
						issuedAt: row.issued_at,
						lastSeenAt: row.last_seen_at,
					})),
					recentExpansions: recentExpansions.results.map((row) => ({
						id: row.id,
						refId: row.ref_id,
						kind: row.kind,
						source: row.source,
						operation: row.operation,
						resultStatus: row.result_status,
						limit: row.limit_value,
						query: row.query_text,
						expandedAt: row.expanded_at,
					})),
				});
			} catch {
				return c.json({
					projectId,
					generatedAt: new Date().toISOString(),
					byKind: [],
					bySource: [],
					recentRefs: [],
					recentExpansions: [],
					warning: "Evidence materialization tables are not available.",
				});
			}
		});

		app.get("/internal/evidence/refs/:refId", async (c) => {
			const projectId = getProjectId(c);
			const refId = c.req.param("refId");
			const db = runtime.getSqlDb(c.env);
			const payload = decodeRef(refId);
			if (
				!isProjectScopedRefPayload(payload) ||
				payload.projectId !== projectId
			) {
				return c.json(
					{ error: "Not Found", message: "Evidence ref not found" },
					404,
				);
			}
			const recordOk = (limit?: number) =>
				recordRefExpansion(db, {
					projectId,
					refId,
					kind: payload.kind,
					operation: "retrieve",
					resultStatus: "ok",
					limit,
				});
			if (payload.kind === "action_graph") {
				if (!payload.anchorKind || !payload.anchorId) {
					return c.json(
						{ error: "Bad Request", message: "Action graph ref is malformed" },
						400,
					);
				}
				const { manifest, found } = await loadManifestForAnchor(
					runtime.getSqlDb(c.env),
					projectId,
					payload.anchorKind,
					payload.anchorId,
				);
				if (!found) {
					return c.json(
						{ error: "Not Found", message: "Action graph not found" },
						404,
					);
				}
				await recordOk();
				return c.json({
					refId,
					kind: payload.anchorKind,
					data: manifest,
				});
			}
			if (payload.kind === "trace") {
				if (!hasTraceId(payload)) {
					return c.json(
						{ error: "Not Found", message: "Evidence ref not found" },
						404,
					);
				}
				const detail = await runtime
					.createStore(c.env)
					.getTraceDetail(payload.traceId, projectId);
				if (!detail) {
					return c.json(
						{ error: "Not Found", message: "Trace not found" },
						404,
					);
				}
				await recordOk();
				return c.json({ refId, kind: "trace", data: detail });
			}
			if (payload.kind === "profile") {
				if (!payload.profileId) {
					return c.json(
						{ error: "Bad Request", message: "Profile ref is malformed" },
						400,
					);
				}
				const profile = await db
					.prepare(
						`SELECT id, service_name, profile_type, start_ts, end_ts,
								duration_ms, blob_size_bytes, blob_url, sample_count,
								agent, received_at, expires_at
						 FROM profile_blobs
						 WHERE project_id = ? AND id = ?
						 LIMIT 1`,
					)
					.bind(projectId, payload.profileId)
					.first<ProfileEvidenceRow>();
				if (!profile) {
					return c.json(
						{ error: "Not Found", message: "Profile not found" },
						404,
					);
				}
				if (payload.profileMode === "frames") {
					if (!c.env.PROFILES_BUCKET) {
						return c.json({ error: "Profile storage not configured" }, 500);
					}
					if (!profile.blob_url) {
						return c.json(
							{ error: "Not Found", message: "Profile blob not found" },
							404,
						);
					}
					const obj = await c.env.PROFILES_BUCKET.get(profile.blob_url);
					if (!obj) {
						return c.json(
							{ error: "Not Found", message: "Profile blob not found" },
							404,
						);
					}
					try {
						const raw = new Uint8Array(await obj.arrayBuffer());
						const decoded = await decodePprofBlob(raw);
						const frameLimit = clampInt(
							c.req.query("limit") ?? payload.limit,
							1,
							MAX_PROFILE_FRAME_LIMIT,
							DEFAULT_PROFILE_FRAME_LIMIT,
						);
						await recordOk(frameLimit);
						return c.json({
							refId,
							kind: "profile",
							data: {
								profile: {
									id: profile.id,
									serviceName: profile.service_name,
									profileType: profile.profile_type,
									durationMs: profile.duration_ms,
									blobSizeBytes: profile.blob_size_bytes,
									sampleCount: profile.sample_count,
								},
								traceIdRequested: payload.traceId ?? null,
								frames: summarizeProfileFrames(decoded, {
									limit: frameLimit,
									traceIdFilter: payload.traceId ?? null,
								}),
								frameLimit,
							},
						});
					} catch (err) {
						runtime.logger.warn(
							"[evidence-retrieval] profile frame decode failed",
							{
								profile_id: profile.id,
								trace_id: payload.traceId ?? null,
								error: err instanceof Error ? err.message : String(err),
							},
						);
						return c.json(
							{
								error: "Profile decode failed",
								message: err instanceof Error ? err.message : String(err),
							},
							422,
						);
					}
				}
				await recordOk();
				return c.json({
					refId,
					kind: "profile",
					data: {
						profile: {
							id: profile.id,
							serviceName: profile.service_name,
							profileType: profile.profile_type,
							startTs: profile.start_ts,
							endTs: profile.end_ts,
							durationMs: profile.duration_ms,
							blobSizeBytes: profile.blob_size_bytes,
							sampleCount: profile.sample_count,
							agent: profile.agent,
							receivedAt: profile.received_at,
							expiresAt: profile.expires_at,
						},
						traceIds: await profileTraceIds(db, projectId, profile.id),
						traceIdRequested: payload.traceId ?? null,
					},
				});
			}
			if (payload.kind === "replay") {
				if (!payload.sessionId) {
					return c.json(
						{ error: "Bad Request", message: "Replay ref is malformed" },
						400,
					);
				}
				const replay = await replayBySession(db, projectId, payload.sessionId);
				if (!replay) {
					return c.json(
						{ error: "Not Found", message: "Replay not found" },
						404,
					);
				}
				if (payload.replayMode === "events") {
					if (!c.env.REPLAYS_BUCKET) {
						return c.json({ error: "Replay storage not configured" }, 500);
					}
					const chunkOffset = clampInt(
						c.req.query("chunkOffset") ?? payload.chunkOffset,
						0,
						Number.MAX_SAFE_INTEGER,
						0,
					);
					const chunkLimit = clampInt(
						c.req.query("limit") ?? payload.limit,
						1,
						MAX_REPLAY_EVENT_CHUNKS,
						DEFAULT_REPLAY_EVENT_CHUNKS,
					);
					const window = await replayEventWindow(
						c.env.REPLAYS_BUCKET,
						projectId,
						payload.sessionId,
						chunkOffset,
						chunkLimit,
					);
					if (window.chunks.total === 0) {
						return c.json(
							{ error: "Not Found", message: "Replay chunks missing" },
							404,
						);
					}
					await recordOk(chunkLimit);
					return c.json({
						refId,
						kind: "replay",
						data: {
							metadata: {
								sessionId: replay.session_id,
								visitorId: replay.visitor_id,
								firstChunkAt: replay.first_chunk_at,
								lastChunkAt: replay.last_chunk_at,
								chunkCount: replay.chunk_count,
								eventsCount: replay.events_count,
								storageBytes: replay.storage_bytes,
							},
							events: window.events,
							chunks: window.chunks,
						},
					});
				}
				await recordOk();
				return c.json({
					refId,
					kind: "replay",
					data: {
						sessionId: replay.session_id,
						visitorId: replay.visitor_id,
						firstChunkAt: replay.first_chunk_at,
						lastChunkAt: replay.last_chunk_at,
						chunkCount: replay.chunk_count,
						eventsCount: replay.events_count,
						storageBytes: replay.storage_bytes,
					},
				});
			}
			if (payload.kind === "ai_call") {
				if (!payload.callId) {
					return c.json(
						{ error: "Bad Request", message: "AI call ref is malformed" },
						400,
					);
				}
				const aiCall = await aiCallById(db, projectId, payload.callId);
				if (!aiCall) {
					return c.json(
						{ error: "Not Found", message: "AI call not found" },
						404,
					);
				}
				await recordOk();
				return c.json({
					refId,
					kind: "ai_call",
					data: {
						callId: aiCall.call_id,
						traceId: aiCall.trace_id,
						spanId: aiCall.span_id,
						serviceName: aiCall.service_name,
						modelName: aiCall.model_name,
						provider: aiCall.provider,
						callType: aiCall.call_type,
						promptTokens: aiCall.prompt_tokens,
						completionTokens: aiCall.completion_tokens,
						totalCostUsd: aiCall.total_cost_usd,
						latencyMs: aiCall.latency_ms,
						isError: Boolean(aiCall.is_error),
						errorMessage: aiCall.error_message,
						occurredAt: aiCall.occurred_at,
						receivedAt: aiCall.received_at,
						expiresAt: aiCall.expires_at,
						interactionId: aiCall.interaction_id,
						sessionId: aiCall.session_id,
						requestJson: "[redacted]",
						responseJson: "[redacted]",
					},
				});
			}
			if (payload.kind === "tool_call") {
				if (!payload.toolCallId) {
					return c.json(
						{ error: "Bad Request", message: "Tool call ref is malformed" },
						400,
					);
				}
				const tool = await toolCallById(db, projectId, payload.toolCallId);
				if (!tool) {
					return c.json(
						{ error: "Not Found", message: "Tool call not found" },
						404,
					);
				}
				await recordOk();
				return c.json({
					refId,
					kind: "tool_call",
					data: {
						id: tool.id,
						actionId: tool.actionId,
						toolName: tool.toolName,
						argsHash: tool.argsHash,
						resultHash: tool.resultHash,
						errorType: tool.errorType,
						sideEffect: Boolean(tool.sideEffect),
						approvalState: tool.approvalState,
						argsRedacted: tool.argsRedacted,
						resultRedacted: tool.resultRedacted,
						mcpAuditJson: tool.mcpAuditJson,
						mutationBeforeJson: tool.mutationBeforeJson,
						mutationAfterJson: tool.mutationAfterJson,
						mutationDiffJson: tool.mutationDiffJson,
						mutationArtifactId: tool.mutationArtifactId,
					},
				});
			}
			if (payload.kind === "logs" && !hasTraceId(payload)) {
				return c.json(
					{ error: "Not Found", message: "Evidence ref not found" },
					404,
				);
			}
			if (payload.kind !== "logs") {
				return c.json(
					{ error: "Bad Request", message: "Evidence ref kind is unsupported" },
					400,
				);
			}

			const limit = clampInt(
				c.req.query("limit"),
				1,
				MAX_LOGS_FOR_RETRIEVAL,
				payload.limit ?? 100,
			);
			const severity = c.req.query("severity");
			if (severity && !LOG_SEVERITIES.has(severity as LogRecord["severity"])) {
				return c.json(
					{ error: "Bad Request", message: "severity is invalid" },
					400,
				);
			}
			const logs = await new LogsStore(db).getLogs({
				projectId,
				traceId: payload.traceId,
				hours: payload.hours ?? DEFAULT_HOURS,
				limit,
				severity: severity as LogRecord["severity"] | undefined,
				search: c.req.query("search"),
			});
			await recordOk(limit);
			return c.json({ refId, kind: "logs", data: logs });
		});

		app.post("/internal/evidence/refs/:refId/search", async (c) => {
			const projectId = getProjectId(c);
			const refId = c.req.param("refId");
			const db = runtime.getSqlDb(c.env);
			const payload = decodeRef(refId);
			if (
				!isProjectScopedRefPayload(payload) ||
				payload.projectId !== projectId
			) {
				return c.json(
					{ error: "Not Found", message: "Evidence ref not found" },
					404,
				);
			}
			if (payload.kind !== "logs") {
				return c.json(
					{
						error: "Bad Request",
						message: "Search is currently supported for log refs only.",
					},
					400,
				);
			}
			if (!hasTraceId(payload)) {
				return c.json(
					{ error: "Not Found", message: "Evidence ref not found" },
					404,
				);
			}
			const body = await parseBundleRequest(c.req.raw);
			const query = typeof body.query === "string" ? body.query.trim() : "";
			if (!query) {
				return c.json(
					{ error: "Bad Request", message: "query is required" },
					400,
				);
			}
			const limit = clampInt(body.limit, 1, 100, 20);
			const logs = await new LogsStore(db).getLogs({
				projectId,
				traceId: payload.traceId,
				hours: payload.hours ?? DEFAULT_HOURS,
				limit,
				search: query,
			});
			await recordRefExpansion(db, {
				projectId,
				refId,
				kind: payload.kind,
				operation: "search",
				resultStatus: "ok",
				limit,
				query,
			});
			return c.json({
				refId,
				kind: "logs",
				query,
				data: logs,
			});
		});
	},
};
