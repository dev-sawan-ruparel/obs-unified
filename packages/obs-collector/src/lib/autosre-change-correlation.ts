import type {
	CausalProofTier,
	ChangeBlastRadiusResult,
	ChangeEvent,
	ChangeEventInput,
	ChangeEventKind,
	ChangeEventSource,
	CohortAttributionVerdict,
	CohortMetricsSummary,
	ContentionCandidate,
	OntologyNodeKind,
	RelationshipCertainty,
} from "@obsunified/types";
import { buildCanonicalNodeId } from "@obsunified/types";
import { randomHex } from "./hash";
import { parseJsonArray, parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";

interface ChangeEventRow {
	project_id: string;
	environment: string;
	id: string;
	target_node_id: string;
	kind: string;
	source: string;
	relationship_certainty: string;
	summary: string;
	service_name: string | null;
	version: string | null;
	previous_version: string | null;
	commit_sha: string | null;
	previous_commit_sha: string | null;
	config_digest: string | null;
	repository_url: string | null;
	pull_request_url: string | null;
	actor_id: string | null;
	caused_by_action_id: string | null;
	agent_run_id: string | null;
	touched_paths_json: string | null;
	attributes_json: string | null;
	occurred_at: string;
	received_at: string;
	expires_at: string | null;
}

export const mapChangeEventRow = (row: ChangeEventRow): ChangeEvent => ({
	id: row.id,
	projectId: row.project_id,
	environment: row.environment,
	targetNodeId: row.target_node_id,
	kind: row.kind as ChangeEventKind,
	source: row.source as ChangeEventSource,
	relationshipCertainty: (row.relationship_certainty ||
		"exact") as RelationshipCertainty,
	summary: row.summary,
	serviceName: row.service_name,
	version: row.version,
	previousVersion: row.previous_version,
	commitSha: row.commit_sha,
	previousCommitSha: row.previous_commit_sha,
	configDigest: row.config_digest,
	repositoryUrl: row.repository_url,
	pullRequestUrl: row.pull_request_url,
	actorId: row.actor_id,
	causedByActionId: row.caused_by_action_id,
	agentRunId: row.agent_run_id,
	touchedPaths: parseJsonArray(row.touched_paths_json ?? "[]").filter(
		(p): p is string => typeof p === "string",
	),
	attributes: parseJsonRecord(row.attributes_json ?? "{}"),
	occurredAt: row.occurred_at,
	receivedAt: row.received_at,
	expiresAt: row.expires_at,
});

export async function recordChangeEvent(
	db: SqlDb,
	projectId: string,
	input: ChangeEventInput,
): Promise<ChangeEvent> {
	const nowIso = new Date().toISOString();
	const occurredAt = input.occurredAt || nowIso;
	const environment = (input.environment || "default").trim().toLowerCase();
	const namespace = (input.namespace || "default").trim();
	const serviceName = input.serviceName?.trim() || null;

	const canonicalNode = input.targetNodeId
		? {
				id: input.targetNodeId,
				environment,
				kind: (input.kind === "feature_flag"
					? "feature_flag"
					: "service") as OntologyNodeKind,
				name: serviceName ?? input.targetNodeId,
				namespaceOrEndpoint: namespace,
				isScopedIdentity: true,
			}
		: input.kind === "feature_flag"
			? buildCanonicalNodeId({
					kind: "feature_flag",
					environment,
					flagKey:
						(typeof input.attributes?.flagKey === "string"
							? input.attributes.flagKey
							: serviceName) ?? "flag",
				})
			: buildCanonicalNodeId({
					kind: "service",
					environment,
					namespace,
					serviceName: serviceName ?? "unknown-service",
				});

	const id = input.id?.trim() || `chg_${randomHex(10)}`;
	const source: ChangeEventSource = input.source ?? "explicit_api";
	const certainty: RelationshipCertainty =
		input.relationshipCertainty ??
		(source === "inferred_telemetry" ? "inferred" : "exact");
	const touchedPaths = (input.touchedPaths ?? []).slice(0, 500);
	const expiresAt = new Date(
		Date.parse(occurredAt) + 30 * 24 * 3600_000,
	).toISOString();

	await db.batch([
		db
			.prepare(
				`INSERT INTO ontology_nodes (
					project_id, environment, id, kind, name, namespace_or_endpoint,
					is_scoped_identity, current_version, current_commit_sha,
					current_config_digest, attributes_json, first_seen_at, last_seen_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
				ON CONFLICT (project_id, environment, id) DO UPDATE SET
					current_version = COALESCE(excluded.current_version, ontology_nodes.current_version),
					current_commit_sha = COALESCE(excluded.current_commit_sha, ontology_nodes.current_commit_sha),
					current_config_digest = COALESCE(excluded.current_config_digest, ontology_nodes.current_config_digest),
					last_seen_at = excluded.last_seen_at`,
			)
			.bind(
				projectId,
				environment,
				canonicalNode.id,
				canonicalNode.kind,
				canonicalNode.name,
				canonicalNode.namespaceOrEndpoint,
				canonicalNode.isScopedIdentity ? 1 : 0,
				input.version ?? null,
				input.commitSha ?? null,
				input.configDigest ?? null,
				occurredAt,
				nowIso,
			),
		db
			.prepare(
				`INSERT INTO change_events (
					project_id, environment, id, target_node_id, kind, source,
					relationship_certainty, summary, service_name, version,
					previous_version, commit_sha, previous_commit_sha, config_digest,
					repository_url, pull_request_url, actor_id, caused_by_action_id,
					agent_run_id, touched_paths_json, attributes_json,
					occurred_at, received_at, expires_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (project_id, environment, id) DO UPDATE SET
					summary = excluded.summary,
					version = COALESCE(excluded.version, change_events.version),
					previous_version = COALESCE(excluded.previous_version, change_events.previous_version),
					commit_sha = COALESCE(excluded.commit_sha, change_events.commit_sha),
					touched_paths_json = excluded.touched_paths_json,
					attributes_json = excluded.attributes_json,
					occurred_at = excluded.occurred_at`,
			)
			.bind(
				projectId,
				environment,
				id,
				canonicalNode.id,
				input.kind,
				source,
				certainty,
				input.summary,
				serviceName,
				input.version ?? null,
				input.previousVersion ?? null,
				input.commitSha ?? null,
				input.previousCommitSha ?? null,
				input.configDigest ?? null,
				input.repositoryUrl ?? null,
				input.pullRequestUrl ?? null,
				input.actorId ?? null,
				input.causedByActionId ?? null,
				input.agentRunId ?? null,
				JSON.stringify(touchedPaths),
				JSON.stringify(input.attributes ?? {}),
				occurredAt,
				nowIso,
				expiresAt,
			),
	]);

	return {
		id,
		projectId,
		environment,
		targetNodeId: canonicalNode.id,
		kind: input.kind,
		source,
		relationshipCertainty: certainty,
		summary: input.summary,
		serviceName,
		version: input.version ?? null,
		previousVersion: input.previousVersion ?? null,
		commitSha: input.commitSha ?? null,
		previousCommitSha: input.previousCommitSha ?? null,
		configDigest: input.configDigest ?? null,
		repositoryUrl: input.repositoryUrl ?? null,
		pullRequestUrl: input.pullRequestUrl ?? null,
		actorId: input.actorId ?? null,
		causedByActionId: input.causedByActionId ?? null,
		agentRunId: input.agentRunId ?? null,
		touchedPaths,
		attributes: input.attributes ?? {},
		occurredAt,
		receivedAt: nowIso,
		expiresAt,
	};
}

export async function listChangeEvents(
	db: SqlDb,
	options: {
		projectId: string;
		environment?: string;
		serviceName?: string;
		targetNodeId?: string;
		kind?: string;
		since?: string;
		limit?: number;
	},
): Promise<ChangeEvent[]> {
	const conditions: string[] = ["project_id = ?"];
	const binds: unknown[] = [options.projectId];

	if (options.environment) {
		conditions.push("environment = ?");
		binds.push(options.environment.toLowerCase());
	}
	if (options.serviceName) {
		conditions.push("service_name = ?");
		binds.push(options.serviceName);
	}
	if (options.targetNodeId) {
		conditions.push("target_node_id = ?");
		binds.push(options.targetNodeId);
	}
	if (options.kind) {
		conditions.push("kind = ?");
		binds.push(options.kind);
	}
	if (options.since) {
		conditions.push("occurred_at >= ?");
		binds.push(options.since);
	}

	const limit = Math.max(1, Math.min(200, options.limit ?? 50));
	binds.push(limit);

	const rows = await db
		.prepare(
			`SELECT * FROM change_events
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY occurred_at DESC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<ChangeEventRow>();

	return rows.results.map(mapChangeEventRow);
}

export async function getChangeEvent(
	db: SqlDb,
	projectId: string,
	changeId: string,
	environment?: string,
): Promise<ChangeEvent | null> {
	const row = environment
		? await db
				.prepare(
					`SELECT * FROM change_events
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, environment.toLowerCase(), changeId)
				.first<ChangeEventRow>()
		: await db
				.prepare(
					`SELECT * FROM change_events
					 WHERE project_id = ? AND id = ?
					 ORDER BY occurred_at DESC
					 LIMIT 1`,
				)
				.bind(projectId, changeId)
				.first<ChangeEventRow>();

	return row ? mapChangeEventRow(row) : null;
}

interface SpanCohortSampleRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	span_kind: number;
	status_code: number;
	duration_ms: number;
	service_version: string | null;
	target_node_id: string | null;
	attributes_json: string | null;
	events_json: string | null;
	start_time: string;
	end_time: string;
	received_at: string;
}

const computePercentile = (sorted: number[], p: number): number | null => {
	if (sorted.length === 0) return null;
	const idx = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
	);
	return sorted[idx];
};

const summarizeCohort = (
	cohortKey: string,
	requestSpans: SpanCohortSampleRow[],
	downstreamSpans: SpanCohortSampleRow[],
): CohortMetricsSummary => {
	const requestCount = requestSpans.length;
	const errorCount = requestSpans.filter((s) => s.status_code === 2).length;
	const errorRate = requestCount > 0 ? errorCount / requestCount : 0;
	const durations = requestSpans
		.map((s) => Number(s.duration_ms ?? 0))
		.sort((a, b) => a - b);
	const p95DurationMs = computePercentile(durations, 95);

	const downstreamCount = downstreamSpans.length;
	const avgDownstreamCallsPerRequest =
		requestCount > 0 ? downstreamCount / requestCount : 0;
	const avgDownstreamDurationMs =
		downstreamCount > 0
			? downstreamSpans.reduce((acc, s) => acc + Number(s.duration_ms ?? 0), 0) /
				downstreamCount
			: null;

	return {
		cohortKey,
		requestCount,
		errorCount,
		errorRate,
		p95DurationMs,
		avgDownstreamCallsPerRequest,
		avgDownstreamDurationMs,
	};
};

/**
 * Indexed cross-trace contention lookup (RFC 0013 § 4.B).
 * Uses `idx_spans_contention_lookup` (`project_id, environment, target_node_id, start_time, end_time`).
 * Enforces P1 #5: if the target node is unscoped (`is_scoped_identity = 0`), caps
 * `relationshipCertainty` at `"inferred"`.
 */
export async function findCrossTraceContention(
	db: SqlDb,
	options: {
		projectId: string;
		environment: string;
		targetNodeId: string;
		excludeTraceId: string;
		startTime: string;
		endTime: string;
		limit?: number;
	},
): Promise<ContentionCandidate[]> {
	const env = options.environment.toLowerCase();
	const limit = Math.max(1, Math.min(20, options.limit ?? 5));

	const [nodeRow, contentionRows] = await Promise.all([
		db
			.prepare(
				`SELECT is_scoped_identity FROM ontology_nodes
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(options.projectId, env, options.targetNodeId)
			.first<{ is_scoped_identity: number }>(),
		db
			.prepare(
				`SELECT
					trace_id,
					span_id,
					service_name,
					service_version,
					span_name,
					COUNT(*) AS concurrent_calls,
					MAX(duration_ms) AS max_duration_ms,
					SUM(duration_ms) AS total_resource_time_ms
				 FROM telemetry_spans
				 WHERE project_id = ?
				   AND environment = ?
				   AND target_node_id = ?
				   AND trace_id <> ?
				   AND start_time <= ?
				   AND end_time >= ?
				 GROUP BY trace_id, span_id, service_name, service_version, span_name
				 ORDER BY total_resource_time_ms DESC
				 LIMIT ?`,
			)
			.bind(
				options.projectId,
				env,
				options.targetNodeId,
				options.excludeTraceId,
				options.endTime,
				options.startTime,
				limit,
			)
			.all<{
				trace_id: string;
				span_id: string;
				service_name: string | null;
				service_version: string | null;
				span_name: string;
				concurrent_calls: number;
				max_duration_ms: number;
				total_resource_time_ms: number;
			}>(),
	]);

	const isScoped = nodeRow ? nodeRow.is_scoped_identity === 1 : !options.targetNodeId.includes(":unscoped/");
	const relationshipCertainty: RelationshipCertainty = isScoped
		? "exact"
		: "inferred";

	return contentionRows.results.map((r) => ({
		aggressorTraceId: r.trace_id,
		aggressorSpanId: r.span_id,
		aggressorServiceName: r.service_name,
		aggressorServiceVersion: r.service_version,
		aggressorSpanName: r.span_name,
		sharedTargetNodeId: options.targetNodeId,
		relationshipCertainty,
		concurrentCalls: Number(r.concurrent_calls ?? 1),
		maxDurationMs: Number(r.max_duration_ms ?? 0),
		totalResourceTimeMs: Number(r.total_resource_time_ms ?? 0),
	}));
}

const extractFilePathsFromSpan = (span: SpanCohortSampleRow): string[] => {
	const found: string[] = [];
	const attrs = parseJsonRecord(span.attributes_json ?? "{}");
	for (const key of ["code.filepath", "obs.code.filepath", "exception.stacktrace"]) {
		const val = attrs[key];
		if (typeof val === "string") {
			found.push(val);
		}
	}
	if (span.events_json) {
		const events = parseJsonArray(span.events_json);
		for (const ev of events) {
			if (ev && typeof ev === "object" && !Array.isArray(ev)) {
				const evAttrs = parseJsonRecord(
					JSON.stringify((ev as Record<string, unknown>).attributes ?? {}),
				);
				for (const key of ["code.filepath", "exception.stacktrace"]) {
					if (typeof evAttrs[key] === "string") {
						found.push(evAttrs[key] as string);
					}
				}
			}
		}
	}
	return found;
};

/**
 * Computes traffic-normalized cohort rate lift, minimum sample gates, shared-degradation
 * noisy-neighbor contention checks, and code-path overlap for a `change_event`
 * (RFC 0013 § 4.A, P1 #1, P1 #2).
 */
export async function computeChangeBlastRadius(
	db: SqlDb,
	projectId: string,
	changeId: string,
	options: {
		environment?: string;
		minComparableSample?: number;
	} = {},
): Promise<ChangeBlastRadiusResult | null> {
	const change = await getChangeEvent(
		db,
		projectId,
		changeId,
		options.environment,
	);
	if (!change) return null;

	const minSample = options.minComparableSample ?? 50;
	const preWindowStart = new Date(
		Date.parse(change.occurredAt) - 30 * 60_000,
	).toISOString();

	// Load spans for the service across [occurredAt - 30m, now] using idx_spans_cohort_attribution
	const serviceFilter = change.serviceName;
	const spansResult = serviceFilter
		? await db
				.prepare(
					`SELECT
						trace_id, span_id, parent_span_id, span_kind, status_code,
						duration_ms, service_version, target_node_id, attributes_json,
						events_json, start_time, end_time, received_at
					 FROM telemetry_spans
					 WHERE project_id = ?
					   AND environment = ?
					   AND service_name = ?
					   AND received_at >= ?
					 ORDER BY received_at DESC
					 LIMIT 5000`,
				)
				.bind(projectId, change.environment, serviceFilter, preWindowStart)
				.all<SpanCohortSampleRow>()
		: await db
				.prepare(
					`SELECT
						trace_id, span_id, parent_span_id, span_kind, status_code,
						duration_ms, service_version, target_node_id, attributes_json,
						events_json, start_time, end_time, received_at
					 FROM telemetry_spans
					 WHERE project_id = ?
					   AND environment = ?
					   AND received_at >= ?
					 ORDER BY received_at DESC
					 LIMIT 5000`,
				)
				.bind(projectId, change.environment, preWindowStart)
				.all<SpanCohortSampleRow>();

	const allSpans = spansResult.results;
	const postSpans = allSpans.filter(
		(s) => (s.start_time || s.received_at) >= change.occurredAt,
	);
	const preSpans = allSpans.filter(
		(s) => (s.start_time || s.received_at) < change.occurredAt,
	);

	const isRootOrServer = (s: SpanCohortSampleRow) =>
		s.parent_span_id === null || s.span_kind === 1;
	const isDownstreamCall = (s: SpanCohortSampleRow) =>
		Boolean(s.target_node_id) || s.span_kind === 2 || s.span_kind === 4;

	const flagKey =
		change.kind === "feature_flag"
			? (typeof change.attributes.flagKey === "string"
					? change.attributes.flagKey
					: change.serviceName) ?? "flag"
			: null;

	const newCohortKey =
		change.version ??
		(typeof change.attributes.newVariant === "string"
			? change.attributes.newVariant
			: "true");
	const oldCohortKey =
		change.previousVersion ??
		(typeof change.attributes.previousVariant === "string"
			? change.attributes.previousVariant
			: "false");

	const getCohortOfSpan = (s: SpanCohortSampleRow): string | null => {
		if (flagKey) {
			const attrs = parseJsonRecord(s.attributes_json ?? "{}");
			const direct = attrs[`obs.feature_flags.${flagKey}`];
			if (direct !== undefined && direct !== null) return String(direct);
			if (attrs["feature_flag.key"] === flagKey && attrs["feature_flag.variant"] !== undefined) {
				return String(attrs["feature_flag.variant"]);
			}
			const nested = attrs["obs.feature_flags"];
			if (nested && typeof nested === "object" && !Array.isArray(nested)) {
				const v = (nested as Record<string, unknown>)[flagKey];
				if (v !== undefined && v !== null) return String(v);
			}
			return null;
		}
		return s.service_version;
	};

	const postNewReq = postSpans.filter(
		(s) => isRootOrServer(s) && getCohortOfSpan(s) === newCohortKey,
	);
	const postNewDown = postSpans.filter(
		(s) => isDownstreamCall(s) && getCohortOfSpan(s) === newCohortKey,
	);

	const postOldReq = postSpans.filter(
		(s) =>
			isRootOrServer(s) &&
			(oldCohortKey
				? getCohortOfSpan(s) === oldCohortKey
				: getCohortOfSpan(s) !== null && getCohortOfSpan(s) !== newCohortKey),
	);
	const postOldDown = postSpans.filter(
		(s) =>
			isDownstreamCall(s) &&
			(oldCohortKey
				? getCohortOfSpan(s) === oldCohortKey
				: getCohortOfSpan(s) !== null && getCohortOfSpan(s) !== newCohortKey),
	);

	const preOldReq = preSpans.filter(
		(s) =>
			isRootOrServer(s) &&
			(!oldCohortKey || getCohortOfSpan(s) === oldCohortKey),
	);
	const preOldDown = preSpans.filter(
		(s) =>
			isDownstreamCall(s) &&
			(!oldCohortKey || getCohortOfSpan(s) === oldCohortKey),
	);

	const newCohort = summarizeCohort(newCohortKey, postNewReq, postNewDown);
	const oldCohort = summarizeCohort(oldCohortKey, postOldReq, postOldDown);
	const preBaseline = summarizeCohort(
		`${oldCohortKey}:pre`,
		preOldReq,
		preOldDown,
	);

	// Check code-path overlap between change.touchedPaths and error spans in new cohort
	const overlappingSet = new Set<string>();
	const matchingErrorSpanIds: string[] = [];
	if (change.touchedPaths.length > 0) {
		for (const s of postNewReq.filter((sp) => sp.status_code === 2)) {
			const rawPaths = extractFilePathsFromSpan(s);
			let matchedSpan = false;
			for (const touched of change.touchedPaths) {
				if (rawPaths.some((raw) => raw.includes(touched))) {
					overlappingSet.add(touched);
					matchedSpan = true;
				}
			}
			if (matchedSpan) {
				matchingErrorSpanIds.push(s.span_id);
			}
		}
	}
	const overlappingCodePaths = Array.from(overlappingSet);

	// Evaluate Traffic-Normalized Cohort Verdict (P1 #2)
	let cohortVerdict: CohortAttributionVerdict = "insufficient_sample";
	let causalProofTier: CausalProofTier = "unverified_locus";
	let rateDifference = 0;
	let relativeRisk = 1;
	const sharedResourceAggressors: ContentionCandidate[] = [];

	if (newCohort.requestCount < minSample) {
		cohortVerdict = "insufficient_sample";
		causalProofTier =
			overlappingCodePaths.length > 0
				? "corroborated_candidate"
				: "unverified_locus";
	} else if (oldCohort.requestCount >= minSample) {
		rateDifference = newCohort.errorRate - oldCohort.errorRate;
		relativeRisk = newCohort.errorRate / Math.max(oldCohort.errorRate, 0.001);

		const fanoutRatio =
			newCohort.avgDownstreamCallsPerRequest /
			Math.max(oldCohort.avgDownstreamCallsPerRequest, 0.25);
		const durationRatio =
			(newCohort.avgDownstreamDurationMs ?? 0) /
			Math.max(oldCohort.avgDownstreamDurationMs ?? 1, 1);
		const hasNewVersionAggressorSignal =
			fanoutRatio >= 3.0 || durationRatio >= 3.0;
		const hasPreChangeDegradationSignal =
			preBaseline.requestCount >= 10 &&
			oldCohort.errorRate > 1.5 * Math.max(preBaseline.errorRate, 0.01);

		const bothDegraded =
			newCohort.errorRate >= 0.05 &&
			oldCohort.errorRate >= 0.05 &&
			(hasNewVersionAggressorSignal || hasPreChangeDegradationSignal);

		if (bothDegraded) {
			if (hasNewVersionAggressorSignal) {
				cohortVerdict = "shared_degradation_new_version_aggressor";
				causalProofTier = "corroborated_candidate";
				// Populate top contention aggressors from postNewDown
				const sampleTarget = postNewDown.find(
					(d) => d.target_node_id,
				)?.target_node_id;
				if (sampleTarget) {
					const victimTrace =
						postOldReq.find((r) => r.status_code === 2)?.trace_id ?? "victim";
					const candidates = await findCrossTraceContention(db, {
						projectId,
						environment: change.environment,
						targetNodeId: sampleTarget,
						excludeTraceId: victimTrace,
						startTime: change.occurredAt,
						endTime: new Date().toISOString(),
					});
					sharedResourceAggressors.push(...candidates);
				}
			} else {
				cohortVerdict = "shared_degradation_external_cause";
				causalProofTier = "unverified_locus";
			}
		} else {
			const p95Ratio =
				newCohort.p95DurationMs !== null &&
				oldCohort.p95DurationMs !== null &&
				oldCohort.p95DurationMs > 0
					? newCohort.p95DurationMs / oldCohort.p95DurationMs
					: 1;

			if (
				(rateDifference >= 0.05 || p95Ratio >= 2.5) &&
				(relativeRisk >= 5.0 || p95Ratio >= 2.5)
			) {
				cohortVerdict = "isolated_to_new_version";
				causalProofTier = "cohort_rate_isolated";
			} else {
				cohortVerdict = "no_regression_detected";
				causalProofTier = "unverified_locus";
			}
		}
	} else if (preBaseline.requestCount >= minSample) {
		// Instant 100% cutover: compare post-change v_new vs pre-change baseline
		rateDifference = newCohort.errorRate - preBaseline.errorRate;
		relativeRisk =
			newCohort.errorRate / Math.max(preBaseline.errorRate, 0.001);
		const p95Ratio =
			newCohort.p95DurationMs !== null &&
			preBaseline.p95DurationMs !== null &&
			preBaseline.p95DurationMs > 0
				? newCohort.p95DurationMs / preBaseline.p95DurationMs
				: 1;

		if (
			(rateDifference >= 0.05 || p95Ratio >= 2.5) &&
			(relativeRisk >= 5.0 || p95Ratio >= 2.5)
		) {
			cohortVerdict = "sequential_post_cutover_regression";
			causalProofTier = "corroborated_candidate";
		} else {
			cohortVerdict = "no_regression_detected";
			causalProofTier = "unverified_locus";
		}
	} else if (overlappingCodePaths.length > 0) {
		cohortVerdict = "insufficient_sample";
		causalProofTier = "corroborated_candidate";
	}

	const relationshipCertainty: RelationshipCertainty =
		overlappingCodePaths.length > 0 ? "exact" : change.relationshipCertainty;

	const summary = `Change ${change.id} (${change.kind} ${newCohortKey} in ${change.environment}): verdict=${cohortVerdict}, proofTier=${causalProofTier}, newErrorRate=${(newCohort.errorRate * 100).toFixed(1)}% (N=${newCohort.requestCount}), oldErrorRate=${(oldCohort.errorRate * 100).toFixed(1)}% (N=${oldCohort.requestCount})`;

	return {
		change,
		cohortVerdict,
		causalProofTier,
		relationshipCertainty,
		minComparableSample: minSample,
		newCohort,
		oldCohort,
		preChangeBaselineCohort: preBaseline,
		rateDifference,
		relativeRisk,
		overlappingCodePaths,
		matchingErrorSpanIds,
		sharedResourceAggressors,
		summary,
	};
}
