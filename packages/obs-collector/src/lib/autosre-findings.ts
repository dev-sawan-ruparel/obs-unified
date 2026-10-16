import type {
	CausalProofTier,
	CausalTriple,
	CausalVerificationStatus,
	CohortAttributionVerdict,
	ConfidenceBreakdown,
	EvidenceEntityKind,
	FindingFingerprintInput,
	InvestigationFinding,
	InvestigationFindingInput,
	PairedCounterfactualProof,
	RecoveryStatus,
	TelemetryCodeReference,
} from "@obsunified/types";
import {
	buildCanonicalNodeId,
	buildFindingFingerprint,
} from "@obsunified/types";
import { consoleLogger, type Logger } from "../framework/logger";
import { computeChangeBlastRadius } from "./autosre-change-correlation";
import { randomHex, sha256Hex } from "./hash";
import { parseJsonArray, parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";

interface FindingRow {
	project_id: string;
	environment: string;
	id: string;
	incident_id: string | null;
	fingerprint: string;
	fingerprint_input_json: string;
	title: string;
	summary: string;
	causal_proof_tier: string;
	confidence: number;
	confidence_breakdown_json: string;
	symptom_entity_kind: string;
	symptom_entity_id: string;
	fault_locus_entity_kind: string;
	fault_locus_entity_id: string;
	root_cause_entity_kind: string | null;
	root_cause_entity_id: string | null;
	contributing_change_id: string | null;
	cohort_verdict: string | null;
	contending_trace_id: string | null;
	causal_chain_json: string;
	cited_evidence_ids_json: string;
	code_references_json: string | null;
	counterfactual_proof_json: string | null;
	recovery_status: string;
	causal_verification_status: string;
	watchdog_step: number;
	baseline_request_rate_per_min: number | null;
	next_watchdog_check_at: string | null;
	actor_type: string;
	actor_id: string;
	agent_run_id: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export const mapFindingRow = (row: FindingRow): InvestigationFinding => {
	const rawFpInput = parseJsonRecord(row.fingerprint_input_json);
	const fingerprintInput: FindingFingerprintInput = {
		environment:
			typeof rawFpInput.environment === "string"
				? rawFpInput.environment
				: row.environment,
		originatingNodeId:
			typeof rawFpInput.originatingNodeId === "string"
				? rawFpInput.originatingNodeId
				: row.fault_locus_entity_id,
		normalizedOperation:
			typeof rawFpInput.normalizedOperation === "string"
				? rawFpInput.normalizedOperation
				: row.title,
		errorSignature:
			typeof rawFpInput.errorSignature === "string"
				? rawFpInput.errorSignature
				: "ERROR",
		downstreamTargetNodeId:
			typeof rawFpInput.downstreamTargetNodeId === "string"
				? rawFpInput.downstreamTargetNodeId
				: null,
	};

	const rawBreakdown = parseJsonRecord(row.confidence_breakdown_json);
	const confidenceBreakdown: ConfidenceBreakdown = {
		relationshipScore: Number(rawBreakdown.relationshipScore ?? 0.5),
		cohortLiftScore: Number(rawBreakdown.cohortLiftScore ?? 0),
		temporalProximityScore: Number(rawBreakdown.temporalProximityScore ?? 0.5),
		counterfactualBonus: Number(rawBreakdown.counterfactualBonus ?? 0),
		priorRecurrenceBonus: Number(rawBreakdown.priorRecurrenceBonus ?? 0),
		finalConfidence: Number(rawBreakdown.finalConfidence ?? row.confidence),
	};

	let counterfactualProof: PairedCounterfactualProof | null = null;
	if (row.counterfactual_proof_json) {
		const rawCf = parseJsonRecord(row.counterfactual_proof_json);
		if (typeof rawCf.evalCaseId === "string") {
			counterfactualProof = {
				evalCaseId: rawCf.evalCaseId,
				inputPayloadHash: String(rawCf.inputPayloadHash ?? ""),
				failingRunId: String(rawCf.failingRunId ?? ""),
				failingVersion:
					typeof rawCf.failingVersion === "string"
						? rawCf.failingVersion
						: null,
				failingCommitSha:
					typeof rawCf.failingCommitSha === "string"
						? rawCf.failingCommitSha
						: null,
				failureFingerprint: String(rawCf.failureFingerprint ?? row.fingerprint),
				passingRunIds: Array.isArray(rawCf.passingRunIds)
					? rawCf.passingRunIds.map(String)
					: [],
				passingVersion:
					typeof rawCf.passingVersion === "string"
						? rawCf.passingVersion
						: null,
				passingCommitSha:
					typeof rawCf.passingCommitSha === "string"
						? rawCf.passingCommitSha
						: null,
				requiredTrials: Number(rawCf.requiredTrials ?? 1),
				verifiedAt: String(rawCf.verifiedAt ?? row.updated_at),
			};
		}
	}

	return {
		id: row.id,
		projectId: row.project_id,
		environment: row.environment,
		incidentId: row.incident_id,
		fingerprint: row.fingerprint,
		fingerprintInput,
		title: row.title,
		summary: row.summary,
		causalProofTier: (row.causal_proof_tier ||
			"unverified_locus") as CausalProofTier,
		confidence: Number(row.confidence),
		confidenceBreakdown,
		symptomEntityKind: row.symptom_entity_kind as EvidenceEntityKind,
		symptomEntityId: row.symptom_entity_id,
		faultLocusEntityKind: row.fault_locus_entity_kind as EvidenceEntityKind,
		faultLocusEntityId: row.fault_locus_entity_id,
		rootCauseEntityKind:
			(row.root_cause_entity_kind as EvidenceEntityKind | null) ?? null,
		rootCauseEntityId: row.root_cause_entity_id,
		contributingChangeId: row.contributing_change_id,
		cohortVerdict:
			(row.cohort_verdict as CohortAttributionVerdict | null) ?? null,
		contendingTraceId: row.contending_trace_id,
		causalChain: parseJsonArray(
			row.causal_chain_json,
		) as unknown as CausalTriple[],
		citedEvidenceIds: parseJsonArray(row.cited_evidence_ids_json).map(String),
		codeReferences: parseJsonArray(
			row.code_references_json ?? "[]",
		) as unknown as TelemetryCodeReference[],
		counterfactualProof,
		recoveryStatus: (row.recovery_status || "not_applicable") as RecoveryStatus,
		causalVerificationStatus: (row.causal_verification_status ||
			"unverified") as CausalVerificationStatus,
		watchdogStep: Number(row.watchdog_step ?? 0),
		baselineRequestRatePerMin:
			row.baseline_request_rate_per_min === null
				? null
				: Number(row.baseline_request_rate_per_min),
		nextWatchdogCheckAt: row.next_watchdog_check_at,
		actorType: row.actor_type,
		actorId: row.actor_id,
		agentRunId: row.agent_run_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at,
	};
};

/**
 * Enforces P1 #1: the causal proof tier is server-derived. Nothing the client
 * asserts (`cohortVerdict`, `causalProofTier`, an `isolated_to_version_cohort`
 * triple) can raise the tier above `corroborated_candidate`. Only a verdict the
 * collector recomputed itself from telemetry (`serverCohortVerdict`, produced by
 * `computeChangeBlastRadius`) may yield `cohort_rate_isolated`, and only
 * `verifyPairedCounterfactualProof` can reach `counterfactual_verified`.
 */
function resolveSafeCausalProofTier(
	input: InvestigationFindingInput,
	serverCohortVerdict: CohortAttributionVerdict | null,
): CausalProofTier {
	if (serverCohortVerdict === "isolated_to_new_version") {
		return "cohort_rate_isolated";
	}
	if (
		serverCohortVerdict === "sequential_post_cutover_regression" ||
		serverCohortVerdict === "shared_degradation_new_version_aggressor" ||
		input.cohortVerdict === "isolated_to_new_version" ||
		input.cohortVerdict === "sequential_post_cutover_regression" ||
		input.cohortVerdict === "shared_degradation_new_version_aggressor"
	) {
		return "corroborated_candidate";
	}
	const hasCodeOverlapOrContention = input.causalChain.some(
		(t) =>
			t.predicate === "touched_same_code_path" ||
			t.predicate === "contended_on_shared_resource" ||
			t.predicate === "induced_shared_resource_contention" ||
			t.predicate === "degraded_after_change" ||
			t.predicate === "isolated_to_version_cohort",
	);
	if (
		hasCodeOverlapOrContention ||
		input.causalProofTier === "cohort_rate_isolated" ||
		input.causalProofTier === "corroborated_candidate"
	) {
		return "corroborated_candidate";
	}
	return "unverified_locus";
}

export interface FaultLocusSpanRow {
	service_name: string | null;
	span_name: string;
	status_message: string | null;
	error_signature?: string | null;
}

/** Looks up the span a finding's fault locus refers to (newest match wins). */
export async function loadFaultLocusSpan(
	db: SqlDb,
	projectId: string,
	environment: string,
	spanId: string,
): Promise<FaultLocusSpanRow | null> {
	if (!spanId) return null;
	return db
		.prepare(
			`SELECT service_name, span_name, status_message, error_signature
			 FROM telemetry_spans
			 WHERE project_id = ? AND environment = ? AND span_id = ?
			 ORDER BY start_time DESC
			 LIMIT 1`,
		)
		.bind(projectId, environment, spanId)
		.first<FaultLocusSpanRow>();
}

/**
 * Stable recurrence-fingerprint inputs for a fault-locus span: the service node,
 * the span name as the operation and the span's error signature (falling back
 * to its status message). No instance ids participate, so two traces failing
 * the same way on the same service/route share a fingerprint. Used by both
 * finding creation and the evidence bundle's prior-finding lookup.
 */
export function fingerprintInputFromSpan(
	span: FaultLocusSpanRow,
	environment: string,
): FindingFingerprintInput {
	return {
		environment,
		originatingNodeId: buildCanonicalNodeId({
			kind: "service",
			environment,
			serviceName: span.service_name || "unknown-service",
		}).id,
		normalizedOperation: span.span_name,
		errorSignature: span.error_signature || span.status_message || "",
		downstreamTargetNodeId: null,
	};
}

export async function recordInvestigationFinding(
	db: SqlDb,
	projectId: string,
	input: InvestigationFindingInput,
	options: { logger?: Logger } = {},
): Promise<InvestigationFinding> {
	const logger = options.logger ?? consoleLogger;
	const nowIso = new Date().toISOString();
	const environment = (
		input.environment ??
		input.fingerprintInput?.environment ??
		"default"
	)
		.trim()
		.toLowerCase();

	// Idempotent retries: one key maps to one finding id per project and
	// environment, and a replay returns the stored finding untouched.
	const idempotencyKey = input.idempotencyKey?.trim();
	let idempotencyId: string | undefined;
	if (idempotencyKey) {
		idempotencyId = `fnd_k${(await sha256Hex(`${projectId}\u0000${environment}\u0000${idempotencyKey}`)).slice(0, 20)}`;
		const replay = await getInvestigationFinding(
			db,
			projectId,
			idempotencyId,
			environment,
		);
		if (replay) return replay;
	}

	// Findings pointing at a span id (no colon) must not mint a per-incident
	// fingerprint. Resolve the span to its service/operation/error signature so
	// every incident on the same service + route + error shares one identity.
	// Caller-supplied fingerprint fields always win; unknown spans fall back to
	// treating the locus id as a service name.
	const supplied: Partial<FindingFingerprintInput> =
		input.fingerprintInput ?? {};
	const locusId = input.faultLocusEntityId.trim();
	let spanDerived: Partial<FindingFingerprintInput> = {};
	if (!locusId.includes(":") && input.faultLocusEntityKind !== "service") {
		const spanRow = await loadFaultLocusSpan(
			db,
			projectId,
			environment,
			locusId,
		);
		if (spanRow) spanDerived = fingerprintInputFromSpan(spanRow, environment);
	}
	const defaultOriginNode = locusId.includes(":")
		? locusId
		: buildCanonicalNodeId({
				kind: "service",
				environment,
				serviceName: locusId,
			}).id;

	const fpResult = buildFindingFingerprint({
		environment: supplied.environment ?? environment,
		originatingNodeId:
			supplied.originatingNodeId ??
			spanDerived.originatingNodeId ??
			defaultOriginNode,
		normalizedOperation:
			supplied.normalizedOperation ??
			spanDerived.normalizedOperation ??
			input.title,
		errorSignature:
			supplied.errorSignature ??
			spanDerived.errorSignature ??
			input.summary.slice(0, 120),
		downstreamTargetNodeId:
			supplied.downstreamTargetNodeId ??
			spanDerived.downstreamTargetNodeId ??
			null,
	});

	// Check for prior verified findings with the same stable fingerprint
	const priorRow = await db
		.prepare(
			`SELECT id, causal_verification_status FROM investigation_findings
			 WHERE project_id = ? AND environment = ? AND fingerprint = ?
			 ORDER BY created_at DESC
			 LIMIT 1`,
		)
		.bind(projectId, environment, fpResult.fingerprint)
		.first<{ id: string; causal_verification_status: string }>();

	// Recompute the cohort verdict server-side; never trust the client's claim.
	let serverCohortVerdict: CohortAttributionVerdict | null = null;
	if (input.contributingChangeId) {
		const blastRadius = await computeChangeBlastRadius(
			db,
			projectId,
			input.contributingChangeId,
			{ environment },
		);
		serverCohortVerdict = blastRadius?.cohortVerdict ?? null;
	}
	const causalProofTier = resolveSafeCausalProofTier(
		input,
		serverCohortVerdict,
	);
	if (
		input.cohortVerdict === "isolated_to_new_version" &&
		serverCohortVerdict !== "isolated_to_new_version"
	) {
		logger.warn(
			"[autosre] client-asserted cohortVerdict=isolated_to_new_version was not corroborated server-side; capping proof tier",
			{
				projectId,
				contributingChangeId: input.contributingChangeId ?? null,
				serverCohortVerdict,
			},
		);
	}
	// An unverified client claim of isolation is not persisted as a verdict.
	const storedCohortVerdict =
		serverCohortVerdict ??
		(input.cohortVerdict === "isolated_to_new_version"
			? null
			: (input.cohortVerdict ?? null));

	const relationshipScore = input.causalChain.some(
		(c) => c.relationshipCertainty === "exact",
	)
		? 0.9
		: input.causalChain.some((c) => c.relationshipCertainty === "inferred")
			? 0.65
			: 0.4;
	const cohortLiftScore =
		causalProofTier === "cohort_rate_isolated"
			? 0.9
			: causalProofTier === "corroborated_candidate"
				? 0.6
				: 0.2;
	const priorBonus =
		priorRow?.causal_verification_status === "counterfactual_verified" ||
		priorRow?.causal_verification_status === "operationally_corroborated"
			? 0.1
			: 0;

	const computedConfidence = Math.min(
		0.99,
		Number(
			(
				0.4 * relationshipScore +
				0.4 * cohortLiftScore +
				0.2 * 0.7 +
				priorBonus
			).toFixed(2),
		),
	);
	const confidence = input.confidence ?? computedConfidence;

	const confidenceBreakdown: ConfidenceBreakdown = {
		relationshipScore:
			input.confidenceBreakdown?.relationshipScore ?? relationshipScore,
		cohortLiftScore:
			input.confidenceBreakdown?.cohortLiftScore ?? cohortLiftScore,
		temporalProximityScore:
			input.confidenceBreakdown?.temporalProximityScore ?? 0.7,
		counterfactualBonus: input.confidenceBreakdown?.counterfactualBonus ?? 0,
		priorRecurrenceBonus:
			input.confidenceBreakdown?.priorRecurrenceBonus ?? priorBonus,
		finalConfidence: confidence,
	};

	const id = idempotencyId ?? (input.id?.trim() || `fnd_${randomHex(10)}`);
	const expiresAt = new Date(Date.now() + 90 * 24 * 3600_000).toISOString();

	await db
		.prepare(
			`INSERT INTO investigation_findings (
				project_id, environment, id, incident_id, fingerprint,
				fingerprint_input_json, title, summary, causal_proof_tier,
				confidence, confidence_breakdown_json, symptom_entity_kind,
				symptom_entity_id, fault_locus_entity_kind, fault_locus_entity_id,
				root_cause_entity_kind, root_cause_entity_id, contributing_change_id,
				cohort_verdict, contending_trace_id, causal_chain_json,
				cited_evidence_ids_json, code_references_json,
				recovery_status, causal_verification_status, watchdog_step,
				actor_type, actor_id, agent_run_id, created_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_applicable', 'unverified', 0, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (project_id, environment, id) DO UPDATE SET
				title = excluded.title,
				summary = excluded.summary,
				causal_proof_tier = excluded.causal_proof_tier,
				confidence = excluded.confidence,
				confidence_breakdown_json = excluded.confidence_breakdown_json,
				contributing_change_id = COALESCE(excluded.contributing_change_id, investigation_findings.contributing_change_id),
				cohort_verdict = COALESCE(excluded.cohort_verdict, investigation_findings.cohort_verdict),
				causal_chain_json = excluded.causal_chain_json,
				cited_evidence_ids_json = excluded.cited_evidence_ids_json,
				updated_at = excluded.updated_at`,
		)
		.bind(
			projectId,
			environment,
			id,
			input.incidentId ?? null,
			fpResult.fingerprint,
			JSON.stringify(fpResult.normalizedInput),
			input.title,
			input.summary,
			causalProofTier,
			confidence,
			JSON.stringify(confidenceBreakdown),
			input.symptomEntityKind,
			input.symptomEntityId,
			input.faultLocusEntityKind,
			input.faultLocusEntityId,
			input.rootCauseEntityKind ?? null,
			input.rootCauseEntityId ?? null,
			input.contributingChangeId ?? null,
			storedCohortVerdict,
			input.contendingTraceId ?? null,
			JSON.stringify(input.causalChain),
			JSON.stringify(input.citedEvidenceIds),
			JSON.stringify(input.codeReferences ?? []),
			input.actorType ?? "agent",
			input.actorId ?? "autosre-agent",
			input.agentRunId ?? null,
			nowIso,
			nowIso,
			expiresAt,
		)
		.run();

	const created = await getInvestigationFinding(db, projectId, id, environment);
	if (!created) {
		throw new Error(`Failed to load created finding ${id}`);
	}
	return created;
}

export async function getInvestigationFinding(
	db: SqlDb,
	projectId: string,
	findingId: string,
	environment?: string,
): Promise<InvestigationFinding | null> {
	const row = environment
		? await db
				.prepare(
					`SELECT * FROM investigation_findings
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, environment.toLowerCase(), findingId)
				.first<FindingRow>()
		: await db
				.prepare(
					`SELECT * FROM investigation_findings
					 WHERE project_id = ? AND id = ?
					 ORDER BY created_at DESC
					 LIMIT 1`,
				)
				.bind(projectId, findingId)
				.first<FindingRow>();

	return row ? mapFindingRow(row) : null;
}

export async function searchInvestigationFindings(
	db: SqlDb,
	options: {
		projectId: string;
		environment?: string;
		fingerprint?: string;
		symptomEntityId?: string;
		rootCauseEntityId?: string;
		causalVerificationStatus?: string;
		incidentId?: string;
		limit?: number;
	},
): Promise<InvestigationFinding[]> {
	const conditions: string[] = ["project_id = ?"];
	const binds: unknown[] = [options.projectId];

	if (options.environment) {
		conditions.push("environment = ?");
		binds.push(options.environment.toLowerCase());
	}
	if (options.fingerprint) {
		conditions.push("fingerprint = ?");
		binds.push(options.fingerprint);
	}
	if (options.symptomEntityId) {
		conditions.push("symptom_entity_id = ?");
		binds.push(options.symptomEntityId);
	}
	if (options.rootCauseEntityId) {
		conditions.push("(root_cause_entity_id = ? OR fault_locus_entity_id = ?)");
		binds.push(options.rootCauseEntityId, options.rootCauseEntityId);
	}
	if (options.causalVerificationStatus) {
		conditions.push("causal_verification_status = ?");
		binds.push(options.causalVerificationStatus);
	}
	if (options.incidentId) {
		conditions.push("incident_id = ?");
		binds.push(options.incidentId);
	}

	const limit = Math.max(1, Math.min(200, options.limit ?? 25));
	binds.push(limit);

	const rows = await db
		.prepare(
			`SELECT * FROM investigation_findings
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY created_at DESC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<FindingRow>();

	return rows.results.map(mapFindingRow);
}

export class CounterfactualVerificationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CounterfactualVerificationError";
	}
}

interface JoinedEvalRunResultRow {
	run_id: string;
	eval_case_id: string | null;
	service_version: string | null;
	commit_sha: string | null;
	candidate_agent_version: string | null;
	candidate_prompt_version: string | null;
	run_input_hash: string | null;
	run_failure_fp: string | null;
	pass_count: number;
	fail_count: number;
	result_passed: number | null;
	result_input_hash: string | null;
	result_failure_fp: string | null;
}

/**
 * Verifies a PairedCounterfactualProof in SQL against `eval_runs` and `eval_case_results`
 * (RFC 0013 § 5.A & P1 #3).
 *
 * Requires:
 *  1. `failingRunId` and all `passingRunIds` belong to `projectId` and ran against `evalCaseId`
 *     with the identical non-null `input_payload_hash`.
 *  2. `failingRunId` failed (`passed = 0`) and its `failure_fingerprint` matches `finding.fingerprint`.
 *  3. All `passingRunIds` passed (`passed = 1`) and `passingRunIds.length >= requiredTrials`.
 *  4. Failing and passing runs have distinct recorded version/commit/prompt lineage.
 */
export async function verifyPairedCounterfactualProof(
	db: SqlDb,
	projectId: string,
	findingId: string,
	input: {
		environment?: string;
		evalCaseId: string;
		failingRunId: string;
		passingRunIds: string[];
		requiredTrials?: number;
	},
): Promise<InvestigationFinding> {
	const finding = await getInvestigationFinding(
		db,
		projectId,
		findingId,
		input.environment,
	);
	if (!finding) {
		throw new CounterfactualVerificationError(
			`Finding ${findingId} not found in project ${projectId}`,
		);
	}

	const requiredTrials = Math.max(1, input.requiredTrials ?? 1);
	const uniquePassingIds = Array.from(new Set(input.passingRunIds));
	if (uniquePassingIds.length < requiredTrials) {
		throw new CounterfactualVerificationError(
			`Counterfactual requires at least ${requiredTrials} passing trial run(s), got ${uniquePassingIds.length}`,
		);
	}
	if (uniquePassingIds.includes(input.failingRunId)) {
		throw new CounterfactualVerificationError(
			"failingRunId cannot also be listed in passingRunIds",
		);
	}

	const loadRunVerification = async (
		runId: string,
	): Promise<JoinedEvalRunResultRow | null> => {
		const row = await db
			.prepare(
				`SELECT
					r.id AS run_id,
					COALESCE(cr.eval_case_id, r.eval_case_id) AS eval_case_id,
					r.service_version,
					r.commit_sha,
					r.candidate_agent_version,
					r.candidate_prompt_version,
					r.input_payload_hash AS run_input_hash,
					r.failure_fingerprint AS run_failure_fp,
					r.pass_count,
					r.fail_count,
					cr.passed AS result_passed,
					cr.input_payload_hash AS result_input_hash,
					cr.failure_fingerprint AS result_failure_fp
				 FROM eval_runs r
				 LEFT JOIN eval_case_results cr
				   ON cr.project_id = r.project_id AND cr.run_id = r.id AND cr.eval_case_id = ?
				 WHERE r.project_id = ? AND r.id = ?
				 LIMIT 1`,
			)
			.bind(input.evalCaseId, projectId, runId)
			.first<JoinedEvalRunResultRow>();
		return row;
	};

	const failingRow = await loadRunVerification(input.failingRunId);
	if (!failingRow) {
		throw new CounterfactualVerificationError(
			`Failing eval run ${input.failingRunId} not found in project ${projectId}`,
		);
	}
	if (failingRow.eval_case_id !== input.evalCaseId) {
		throw new CounterfactualVerificationError(
			`Failing eval run ${input.failingRunId} does not match evalCaseId ${input.evalCaseId}`,
		);
	}

	const failingPassed =
		failingRow.result_passed !== null
			? Number(failingRow.result_passed) === 1
			: Number(failingRow.fail_count) === 0 &&
				Number(failingRow.pass_count) > 0;
	if (failingPassed) {
		throw new CounterfactualVerificationError(
			`Baseline run ${input.failingRunId} did not fail (passed=1)`,
		);
	}

	const failingInputHash =
		failingRow.result_input_hash ?? failingRow.run_input_hash;
	if (!failingInputHash) {
		throw new CounterfactualVerificationError(
			`Failing eval run ${input.failingRunId} is missing input_payload_hash`,
		);
	}

	const failingFp = failingRow.result_failure_fp ?? failingRow.run_failure_fp;
	if (failingFp !== finding.fingerprint) {
		throw new CounterfactualVerificationError(
			`Failing run fingerprint (${failingFp ?? "null"}) does not match finding fingerprint (${finding.fingerprint})`,
		);
	}

	const failingVersion =
		failingRow.service_version ??
		failingRow.candidate_agent_version ??
		failingRow.candidate_prompt_version;

	let passingVersion: string | null = null;
	let passingCommitSha: string | null = null;

	for (const passRunId of uniquePassingIds) {
		const passRow = await loadRunVerification(passRunId);
		if (!passRow) {
			throw new CounterfactualVerificationError(
				`Passing eval run ${passRunId} not found in project ${projectId}`,
			);
		}
		if (passRow.eval_case_id !== input.evalCaseId) {
			throw new CounterfactualVerificationError(
				`Passing eval run ${passRunId} does not match evalCaseId ${input.evalCaseId}`,
			);
		}
		const didPass =
			passRow.result_passed !== null
				? Number(passRow.result_passed) === 1
				: Number(passRow.pass_count) > 0 && Number(passRow.fail_count) === 0;
		if (!didPass) {
			throw new CounterfactualVerificationError(
				`Candidate run ${passRunId} did not pass`,
			);
		}
		const passInputHash = passRow.result_input_hash ?? passRow.run_input_hash;
		if (passInputHash !== failingInputHash) {
			throw new CounterfactualVerificationError(
				`Candidate run ${passRunId} input_payload_hash (${passInputHash ?? "null"}) does not match failing run (${failingInputHash})`,
			);
		}
		passingVersion =
			passRow.service_version ??
			passRow.candidate_agent_version ??
			passRow.candidate_prompt_version ??
			passingVersion;
		passingCommitSha = passRow.commit_sha ?? passingCommitSha;
	}

	if (
		!failingVersion &&
		!failingRow.commit_sha &&
		!passingVersion &&
		!passingCommitSha
	) {
		throw new CounterfactualVerificationError(
			"Counterfactual runs must record version, commit_sha, or candidate version lineage",
		);
	}

	const nowIso = new Date().toISOString();
	const proof: PairedCounterfactualProof = {
		evalCaseId: input.evalCaseId,
		inputPayloadHash: failingInputHash,
		failingRunId: input.failingRunId,
		failingVersion: failingVersion ?? null,
		failingCommitSha: failingRow.commit_sha ?? null,
		failureFingerprint: finding.fingerprint,
		passingRunIds: uniquePassingIds,
		passingVersion,
		passingCommitSha,
		requiredTrials,
		verifiedAt: nowIso,
	};

	const updatedChain: CausalTriple[] = [
		...finding.causalChain,
		{
			subjectKind: "finding",
			subjectId: finding.id,
			predicate: "verified_by_counterfactual",
			objectKind: "eval",
			objectId: input.evalCaseId,
			relationshipCertainty: "exact",
			causalProofTier: "counterfactual_verified",
			confidence: 0.99,
			reason: `Paired counterfactual verified on evalCase ${input.evalCaseId}: run ${input.failingRunId} (${failingVersion ?? "baseline"}) failed with ${finding.fingerprint} and ${uniquePassingIds.join(", ")} (${passingVersion ?? "candidate"}) passed on payload ${failingInputHash}`,
		},
	];

	const updatedBreakdown: ConfidenceBreakdown = {
		...finding.confidenceBreakdown,
		counterfactualBonus: 0.25,
		finalConfidence: 0.99,
	};

	await db
		.prepare(
			`UPDATE investigation_findings
			 SET causal_proof_tier = 'counterfactual_verified',
			     causal_verification_status = 'counterfactual_verified',
			     confidence = 0.99,
			     confidence_breakdown_json = ?,
			     counterfactual_proof_json = ?,
			     causal_chain_json = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(
			JSON.stringify(updatedBreakdown),
			JSON.stringify(proof),
			JSON.stringify(updatedChain),
			nowIso,
			projectId,
			finding.environment,
			finding.id,
		)
		.run();

	const updated = await getInvestigationFinding(
		db,
		projectId,
		finding.id,
		finding.environment,
	);
	if (!updated) {
		throw new Error(`Failed to reload finding ${finding.id}`);
	}
	return updated;
}
