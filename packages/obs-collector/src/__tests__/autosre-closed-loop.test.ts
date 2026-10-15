import {
	buildCanonicalNodeId,
	buildFindingFingerprint,
} from "@obsunified/types";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import {
	computeChangeBlastRadius,
	findCrossTraceContention,
	recordChangeEvent,
} from "../lib/autosre-change-correlation";
import { recordInvestigationFinding } from "../lib/autosre-findings";
import {
	computeTarjanScc,
	extractSpanLineageAndTopology,
	localizeTraceFaultLocus,
	upsertOntologyFromSpans,
} from "../lib/autosre-ontology";
import {
	acquireIncidentLease,
	claimRemediationGrant,
	completeRemediationProposal,
	dispatchIncidentWebhook,
	evaluateRemediationWatchdogs,
	failRemediationProposal,
	openOrDeduplicateIncident,
	proposeRemediationAction,
	RemediationGateError,
	rejectRemediationProposal,
} from "../lib/autosre-remediation-gate";
import {
	createMigratedSqliteDb,
	type NodeSqliteDb,
} from "../lib/test-utils/node-sqlite-db";
import { autosreRoutesPlugin } from "../plugins/autosre-routes";
import { connectedRoutesPlugin } from "../plugins/connected-routes";
import { evalCasesRoutesPlugin } from "../plugins/eval-cases-routes";
import { evidenceRetrievalRoutesPlugin } from "../plugins/evidence-retrieval-routes";

const createTestApp = (db: NodeSqliteDb) => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime();
	autosreRoutesPlugin.register(app, runtime);
	evalCasesRoutesPlugin.register(app, runtime);
	connectedRoutesPlugin.register(app, runtime);
	evidenceRetrievalRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
	};
	return { app, env };
};

const insertSpan = (
	db: NodeSqliteDb,
	opts: {
		traceId: string;
		spanId: string;
		parentSpanId?: string | null;
		serviceName: string;
		spanName: string;
		spanKind?: number;
		statusCode?: number;
		statusMessage?: string | null;
		startTime: string;
		endTime: string;
		durationMs: number;
		environment?: string;
		serviceVersion?: string | null;
		commitSha?: string | null;
		targetNodeId?: string | null;
		errorSignature?: string | null;
		attributes?: Record<string, unknown>;
		resourceAttributes?: Record<string, unknown>;
		events?: unknown[];
	},
) => {
	db.raw
		.prepare(
			`INSERT INTO telemetry_spans (
				project_id, trace_id, span_id, parent_span_id, service_name,
				span_name, span_kind, start_time, end_time, duration_ms,
				status_code, status_message, attributes_json, resource_attributes_json,
				events_json, links_json, received_at, expires_at,
				environment, service_version, commit_sha, target_node_id, error_signature
			) VALUES (
				'default', ?, ?, ?, ?,
				?, ?, ?, ?, ?,
				?, ?, ?, ?,
				?, '[]', ?, ?,
				?, ?, ?, ?, ?
			)`,
		)
		.run(
			opts.traceId,
			opts.spanId,
			opts.parentSpanId ?? null,
			opts.serviceName,
			opts.spanName,
			opts.spanKind ?? 1,
			opts.startTime,
			opts.endTime,
			opts.durationMs,
			opts.statusCode ?? 1,
			opts.statusMessage ?? null,
			JSON.stringify(opts.attributes ?? {}),
			JSON.stringify(opts.resourceAttributes ?? {}),
			JSON.stringify(opts.events ?? []),
			opts.startTime,
			new Date(Date.parse(opts.startTime) + 72 * 3600_000).toISOString(),
			opts.environment ?? "prod",
			opts.serviceVersion ?? null,
			opts.commitSha ?? null,
			opts.targetNodeId ?? null,
			opts.errorSignature ?? null,
		);
};

describe("RFC 0013 — AutoSRE Causal Ontology, Change Correlation & Closed-Loop Incident Memory", () => {
	it("Criterion 1 (P1 #5): isolates environment and host:port in canonical node IDs and caps unscoped DB contention at inferred certainty", async () => {
		const db = createMigratedSqliteDb();

		const prodCheckout = buildCanonicalNodeId({
			kind: "service",
			environment: "prod",
			namespace: "default",
			serviceName: "checkout-api",
		});
		const stagingCheckout = buildCanonicalNodeId({
			kind: "service",
			environment: "staging",
			namespace: "default",
			serviceName: "checkout-api",
		});
		expect(prodCheckout.id).toBe("service:prod:default:checkout-api");
		expect(stagingCheckout.id).toBe("service:staging:default:checkout-api");
		expect(prodCheckout.id).not.toBe(stagingCheckout.id);

		// Two DBs named 'orders' on different hosts must not collide
		const primarySpan = {
			projectId: "default",
			traceId: "tr_db_1",
			spanId: "sp_db_1",
			parentSpanId: null,
			traceState: null,
			serviceName: "checkout-api",
			scopeName: "db-client",
			scopeVersion: "1.0.0",
			spanName: "SELECT orders",
			spanKind: 3,
			startTime: "2026-10-15T01:00:00.000Z",
			endTime: "2026-10-15T01:00:00.050Z",
			durationMs: 50,
			statusCode: 1,
			statusMessage: null,
			attributesJson: JSON.stringify({
				"db.system": "postgresql",
				"db.name": "orders",
				"server.address": "pg-primary.internal",
				"server.port": 5432,
			}),
			resourceAttributesJson: JSON.stringify({
				"deployment.environment.name": "prod",
				"service.version": "v2.4.1",
			}),
			eventsJson: "[]",
			linksJson: "[]",
			droppedAttributesCount: 0,
			droppedEventsCount: 0,
			droppedLinksCount: 0,
			receivedAt: "2026-10-15T01:00:00.050Z",
			expiresAt: "2026-10-18T01:00:00.050Z",
		};
		const replicaSpan = {
			...primarySpan,
			traceId: "tr_db_2",
			spanId: "sp_db_2",
			serviceName: "analytics-worker",
			attributesJson: JSON.stringify({
				"db.system": "postgresql",
				"db.name": "orders",
				"server.address": "pg-replica.internal",
				"server.port": 5432,
			}),
		};
		const unscopedSpan = {
			...primarySpan,
			traceId: "tr_db_unscoped",
			spanId: "sp_db_unscoped",
			serviceName: "legacy-worker",
			attributesJson: JSON.stringify({
				"db.system": "postgresql",
				"db.name": "orders",
			}),
		};

		const primaryCtx = extractSpanLineageAndTopology(primarySpan);
		const replicaCtx = extractSpanLineageAndTopology(replicaSpan);
		const unscopedCtx = extractSpanLineageAndTopology(unscopedSpan);

		expect(primaryCtx.targetNode?.id).toBe(
			"database:prod:postgresql:pg-primary.internal:5432/orders",
		);
		expect(primaryCtx.targetNode?.isScopedIdentity).toBe(true);
		expect(replicaCtx.targetNode?.id).toBe(
			"database:prod:postgresql:pg-replica.internal:5432/orders",
		);
		expect(replicaCtx.targetNode?.isScopedIdentity).toBe(true);
		expect(primaryCtx.targetNode?.id).not.toBe(replicaCtx.targetNode?.id);

		expect(unscopedCtx.targetNode?.id).toBe(
			"database:prod:unscoped/postgresql:orders",
		);
		expect(unscopedCtx.targetNode?.isScopedIdentity).toBe(false);

		await upsertOntologyFromSpans(
			db,
			[primarySpan, replicaSpan, unscopedSpan],
			{ bypassCache: true },
		);

		// Verify unscoped DB contention caps relationshipCertainty at "inferred"
		const baseMs = Date.parse("2026-10-15T01:10:00.000Z");
		const unscopedNodeId = unscopedCtx.targetNode?.id;
		if (!unscopedNodeId) throw new Error("expected an unscoped target node");
		for (let i = 0; i < 6; i++) {
			insertSpan(db, {
				traceId: "tr_aggressor_unscoped",
				spanId: `sp_agg_${i}`,
				serviceName: "checkout-api",
				spanName: "UPDATE orders",
				spanKind: 3,
				statusCode: 1,
				startTime: new Date(baseMs + i * 50).toISOString(),
				endTime: new Date(baseMs + i * 50 + 400).toISOString(),
				durationMs: 400,
				environment: "prod",
				serviceVersion: "v2.4.1",
				targetNodeId: unscopedNodeId,
			});
		}
		insertSpan(db, {
			traceId: "tr_victim_unscoped",
			spanId: "sp_victim_1",
			serviceName: "checkout-api",
			spanName: "SELECT orders",
			spanKind: 3,
			statusCode: 2,
			statusMessage: "Lock wait timeout",
			startTime: new Date(baseMs + 100).toISOString(),
			endTime: new Date(baseMs + 900).toISOString(),
			durationMs: 800,
			environment: "prod",
			serviceVersion: "v2.4.0",
			targetNodeId: unscopedNodeId,
		});

		const contention = await findCrossTraceContention(db, {
			projectId: "default",
			environment: "prod",
			targetNodeId: unscopedNodeId,
			excludeTraceId: "tr_victim_unscoped",
			startTime: new Date(baseMs - 1000).toISOString(),
			endTime: new Date(baseMs + 5000).toISOString(),
		});
		expect(contention.length).toBeGreaterThan(0);
		expect(contention[0]?.aggressorTraceId).toBe("tr_aggressor_unscoped");
		expect(contention[0]?.relationshipCertainty).toBe("inferred");

		db.close();
	});

	it("Criterion 2 (P2 #6 & P1 #1): condenses cyclic service topology via Tarjan SCC and separates exact structural locus from unverified_locus causal proof", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);

		// Cyclic graph: service A -> service B -> service A
		const sccResult = computeTarjanScc(
			[
				{
					id: "service:prod:default:svc-a",
					projectId: "default",
					environment: "prod",
					kind: "service",
					name: "svc-a",
					namespaceOrEndpoint: "default",
					isScopedIdentity: true,
					currentVersion: "v1",
					currentCommitSha: null,
					currentConfigDigest: null,
					attributes: {},
					firstSeenAt: "2026-10-15T01:00:00.000Z",
					lastSeenAt: "2026-10-15T01:00:00.000Z",
				},
				{
					id: "service:prod:default:svc-b",
					projectId: "default",
					environment: "prod",
					kind: "service",
					name: "svc-b",
					namespaceOrEndpoint: "default",
					isScopedIdentity: true,
					currentVersion: "v1",
					currentCommitSha: null,
					currentConfigDigest: null,
					attributes: {},
					firstSeenAt: "2026-10-15T01:00:00.000Z",
					lastSeenAt: "2026-10-15T01:00:00.000Z",
				},
			],
			[
				{
					id: "e1",
					projectId: "default",
					environment: "prod",
					sourceNodeId: "service:prod:default:svc-a",
					predicate: "calls",
					targetNodeId: "service:prod:default:svc-b",
					relationshipCertainty: "exact",
					callCount: 10,
					errorCount: 2,
					lastDurationMs: 100,
					firstSeenAt: "2026-10-15T01:00:00.000Z",
					lastSeenAt: "2026-10-15T01:00:00.000Z",
				},
				{
					id: "e2",
					projectId: "default",
					environment: "prod",
					sourceNodeId: "service:prod:default:svc-b",
					predicate: "calls",
					targetNodeId: "service:prod:default:svc-a",
					relationshipCertainty: "exact",
					callCount: 10,
					errorCount: 2,
					lastDurationMs: 90,
					firstSeenAt: "2026-10-15T01:00:00.000Z",
					lastSeenAt: "2026-10-15T01:00:00.000Z",
				},
			],
		);

		expect(sccResult.components).toHaveLength(1);
		expect(sccResult.components[0]?.isCyclic).toBe(true);
		expect(sccResult.annotatedNodes.every((n) => n.inCycle === true)).toBe(
			true,
		);

		// Cyclic span tree within a trace must also terminate deterministically
		const locus = localizeTraceFaultLocus("tr_cyclic", [
			{
				span_id: "sp_root",
				parent_span_id: "sp_leaf", // cycle in span parent pointers
				service_name: "svc-a",
				span_name: "POST /checkout",
				span_kind: 1,
				status_code: 2,
				status_message: "500 Internal Error",
				start_time: "2026-10-15T01:00:00.000Z",
				end_time: "2026-10-15T01:00:01.000Z",
				duration_ms: 1000,
				environment: "prod",
			},
			{
				span_id: "sp_leaf",
				parent_span_id: "sp_root",
				service_name: "svc-b",
				span_name: "SELECT inventory",
				span_kind: 3,
				status_code: 2,
				status_message: "Deadlock detected",
				start_time: "2026-10-15T01:00:00.100Z",
				end_time: "2026-10-15T01:00:00.900Z",
				duration_ms: 800,
				environment: "prod",
			},
		]);

		expect(locus.faultLocusSpan?.span_id).toBe("sp_leaf");
		expect(locus.relationshipCertainty).toBe("exact");
		expect(locus.causalProofTier).toBe("unverified_locus");

		// Record an unverified_locus finding and verify rollback_deploy is blocked_by_policy (P1 #1)
		const incRes = await app.request(
			"/internal/incidents",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					targetNodeId: "service:prod:default:svc-a",
					symptomAnchorKind: "trace",
					symptomAnchorId: "tr_cyclic",
				}),
			},
			env,
		);
		expect(incRes.status).toBe(201);
		const { incident } = (await incRes.json()) as {
			incident: { id: string };
		};

		const findingRes = await app.request(
			"/internal/findings",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					incidentId: incident.id,
					title: "Fault locus at sp_leaf",
					summary: "Error surfaced at sp_leaf without change correlation",
					causalProofTier: "unverified_locus",
					symptomEntityKind: "trace",
					symptomEntityId: "tr_cyclic",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp_leaf",
					causalChain: locus.causalTriples,
					citedEvidenceIds: ["tr_cyclic", "sp_leaf"],
				}),
			},
			env,
		);
		expect(findingRes.status).toBe(201);
		const { finding } = (await findingRes.json()) as {
			finding: { id: string; causalProofTier: string };
		};
		expect(finding.causalProofTier).toBe("unverified_locus");

		const proposeRes = await app.request(
			"/internal/remediations/propose",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					incidentId: incident.id,
					findingId: finding.id,
					idempotencyKey: "idem_unverified_rollback",
					actionKind: "rollback_deploy",
					targetNodeId: "service:prod:default:svc-a",
					expectedCurrentState: { version: "v1" },
					desiredTargetState: { version: "v0" },
					requestedAutonomy: "autonomous_write",
				}),
			},
			env,
		);
		expect(proposeRes.status).toBe(201);
		const { proposal, grantToken } = (await proposeRes.json()) as {
			proposal: { effectiveAutonomy: string; status: string };
			grantToken: string | null;
		};
		expect(proposal.effectiveAutonomy).toBe("blocked_by_policy");
		expect(proposal.status).toBe("rejected");
		expect(grantToken).toBeNull();

		db.close();
	});

	it("Criterion 3 (P1 #2): computes traffic-normalized cohort error rate lift and handles equal error rates, low sample sizes, and shared DB degradation", async () => {
		const db = createMigratedSqliteDb();

		const t0 = Date.parse("2026-10-15T02:00:00.000Z");
		const insertCohortSpans = (
			serviceName: string,
			version: string,
			total: number,
			errors: number,
			dbCallsPerTrace = 0,
			offsetMs = 1000,
		) => {
			for (let i = 0; i < total; i++) {
				const traceId = `tr_${serviceName}_${version}_${i}`;
				const isError = i < errors;
				const startIso = new Date(t0 + offsetMs + i * 50).toISOString();
				const endIso = new Date(t0 + offsetMs + i * 50 + 40).toISOString();
				insertSpan(db, {
					traceId,
					spanId: `sp_root_${serviceName}_${version}_${i}`,
					serviceName,
					spanName: "POST /checkout",
					spanKind: 1, // SERVER span
					statusCode: isError ? 2 : 1,
					statusMessage: isError ? "Error" : null,
					startTime: startIso,
					endTime: endIso,
					durationMs: 40,
					environment: "prod",
					serviceVersion: version,
				});
				for (let d = 0; d < dbCallsPerTrace; d++) {
					insertSpan(db, {
						traceId,
						spanId: `sp_db_${serviceName}_${version}_${i}_${d}`,
						parentSpanId: `sp_root_${serviceName}_${version}_${i}`,
						serviceName,
						spanName: "SELECT inventory",
						spanKind: 2, // CLIENT span
						statusCode: 1,
						startTime: startIso,
						endTime: endIso,
						durationMs: 20,
						environment: "prod",
						serviceVersion: version,
						targetNodeId: "database:prod:postgresql:pg.internal:5432/orders",
					});
				}
			}
		};

		// Case A: 95% traffic on v2.4.1 (950 spans, 95 errors = 10%) vs 5% traffic on v2.4.0 (50 spans, 5 errors = 10%)
		// Must NOT blame v2.4.1 just because it has 95% of raw errors!
		await recordChangeEvent(db, "default", {
			id: "chg_equal_rate",
			environment: "prod",
			kind: "deploy",
			serviceName: "svc-equal-rate",
			version: "v2.4.1",
			previousVersion: "v2.4.0",
			summary: "Deploy svc-equal-rate v2.4.1",
			occurredAt: new Date(t0).toISOString(),
		});
		insertCohortSpans("svc-equal-rate", "v2.4.1", 950, 95);
		insertCohortSpans("svc-equal-rate", "v2.4.0", 50, 5);

		const equalRateResult = await computeChangeBlastRadius(
			db,
			"default",
			"chg_equal_rate",
			{ environment: "prod" },
		);
		expect(equalRateResult?.cohortVerdict).toBe("no_regression_detected");
		expect(equalRateResult?.relativeRisk).toBeCloseTo(1.0, 2);
		expect(equalRateResult?.causalProofTier).toBe("unverified_locus");

		// Case B: Insufficient sample size (N < 50)
		await recordChangeEvent(db, "default", {
			id: "chg_small_sample",
			environment: "prod",
			kind: "deploy",
			serviceName: "svc-small-sample",
			version: "v2.4.1",
			previousVersion: "v2.4.0",
			summary: "Deploy svc-small-sample v2.4.1",
			occurredAt: new Date(t0).toISOString(),
		});
		insertCohortSpans("svc-small-sample", "v2.4.1", 20, 10);
		insertCohortSpans("svc-small-sample", "v2.4.0", 20, 0);

		const smallSampleResult = await computeChangeBlastRadius(
			db,
			"default",
			"chg_small_sample",
			{ environment: "prod" },
		);
		expect(smallSampleResult?.cohortVerdict).toBe("insufficient_sample");

		// Case C: Shared downstream degradation where BOTH v2.4.1 and v2.4.0 fail at 20%,
		// but v2.4.1 has 5x downstream DB call fanout per trace (noisy-neighbor aggressor!)
		await recordChangeEvent(db, "default", {
			id: "chg_noisy",
			environment: "prod",
			kind: "deploy",
			serviceName: "svc-noisy",
			version: "v2.4.1",
			previousVersion: "v2.4.0",
			summary: "Deploy svc-noisy v2.4.1",
			occurredAt: new Date(t0).toISOString(),
		});
		insertCohortSpans("svc-noisy", "v2.4.1", 60, 12, 5);
		insertCohortSpans("svc-noisy", "v2.4.0", 60, 12, 1);

		const noisyResult = await computeChangeBlastRadius(
			db,
			"default",
			"chg_noisy",
			{ environment: "prod" },
		);
		expect(noisyResult?.cohortVerdict).toBe(
			"shared_degradation_new_version_aggressor",
		);
		expect(noisyResult?.causalProofTier).toBe("corroborated_candidate");
		expect(noisyResult?.sharedResourceAggressors.length).toBeGreaterThan(0);

		// Case D: Isolated regression on v2.4.1 (20% error rate vs 1.6% on v2.4.0, N >= 50)
		await recordChangeEvent(db, "default", {
			id: "chg_isolated",
			environment: "prod",
			kind: "deploy",
			serviceName: "svc-isolated",
			version: "v2.4.1",
			previousVersion: "v2.4.0",
			summary: "Deploy svc-isolated v2.4.1",
			occurredAt: new Date(t0).toISOString(),
		});
		insertCohortSpans("svc-isolated", "v2.4.1", 60, 12);
		insertCohortSpans("svc-isolated", "v2.4.0", 60, 1);

		const isolatedResult = await computeChangeBlastRadius(
			db,
			"default",
			"chg_isolated",
			{ environment: "prod" },
		);
		expect(isolatedResult?.cohortVerdict).toBe("isolated_to_new_version");
		expect(isolatedResult?.causalProofTier).toBe("cohort_rate_isolated");

		db.close();
	});

	it("Criterion 6 (P2 #8): normalizes dynamic IDs in buildFindingFingerprint so recurring incidents produce the exact same fingerprint", () => {
		const fp1 = buildFindingFingerprint({
			environment: "prod",
			originatingNodeId: "service:prod:default:checkout-api",
			normalizedOperation:
				"POST /v1/orders/123e4567-e89b-12d3-a456-426614174000",
			errorSignature:
				"LockWaitTimeoutError: Lock wait timeout 5012ms for order 123e4567-e89b-12d3-a456-426614174000 at 2026-10-15T01:00:00Z",
			downstreamTargetNodeId:
				"database:prod:postgresql:pg-primary.internal:5432/orders",
		});

		const fp2 = buildFindingFingerprint({
			environment: "prod",
			originatingNodeId: "service:prod:default:checkout-api",
			normalizedOperation:
				"POST /v1/orders/987fcdeb-51a2-43d7-9012-345678901234",
			errorSignature:
				"LockWaitTimeoutError: Lock wait timeout 5489ms for order 987fcdeb-51a2-43d7-9012-345678901234 at 2026-10-15T03:15:22Z",
			downstreamTargetNodeId:
				"database:prod:postgresql:pg-primary.internal:5432/orders",
		});

		expect(fp1.fingerprint).toBe(fp2.fingerprint);
		expect(fp1.normalizedInput).toEqual(fp2.normalizedInput);
	});

	it("Criteria 4, 5 & End-to-End 6-Hop Closed-Loop Flow (P1 #1-#5, P2 #6-#8): executes full symptom -> fault locus -> cohort & contention -> paired counterfactual -> governed remediation -> post-remediation watchdog & recurrence memory", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);

		const deployTime = Date.parse("2026-10-15T03:00:00.000Z");

		// 1. Seed concurrent v2.4.0 traffic (60 spans, 1 error = 1.67% error rate)
		// and canary v2.4.1 traffic (60 spans, 15 errors = 25% error rate) with code stackframe in src/checkout/inventory.ts
		const dbNodeId = "database:prod:postgresql:pg-primary.internal:5432/orders";
		const serviceNodeId = "service:prod:default:checkout-api";

		for (let i = 0; i < 60; i++) {
			const startIso = new Date(deployTime + (i + 1) * 1000).toISOString();
			const endIso = new Date(deployTime + (i + 1) * 1000 + 40).toISOString();
			insertSpan(db, {
				traceId: `tr_base_${i}`,
				spanId: `sp_base_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				spanKind: 1,
				statusCode: i === 0 ? 2 : 1,
				statusMessage: i === 0 ? "Transient error" : null,
				startTime: startIso,
				endTime: endIso,
				durationMs: 40,
				environment: "prod",
				serviceVersion: "v2.4.0",
				commitSha: "1111111",
				targetNodeId: dbNodeId,
			});
		}

		for (let i = 0; i < 60; i++) {
			const isError = i < 15;
			const startIso = new Date(deployTime + (i + 1) * 1000).toISOString();
			const endIso = new Date(deployTime + (i + 1) * 1000 + 850).toISOString();
			insertSpan(db, {
				traceId: `tr_new_${i}`,
				spanId: `sp_new_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				spanKind: 1,
				statusCode: isError ? 2 : 1,
				statusMessage: isError
					? `LockWaitTimeoutError: timeout 5000ms on order 123e4567-e89b-12d3-a456-426614174000`
					: null,
				startTime: startIso,
				endTime: endIso,
				durationMs: isError ? 850 : 45,
				environment: "prod",
				serviceVersion: "v2.4.1",
				commitSha: "8f3a1b2",
				targetNodeId: dbNodeId,
				errorSignature: isError
					? "LockWaitTimeoutError: timeout <num> on order <uuid>"
					: null,
				attributes: isError
					? {
							"code.filepath": "src/checkout/inventory.ts",
							"code.function": "reserveInventoryBatch",
						}
					: {},
			});
		}

		// Record explicit deploy ChangeEvent via POST /v1/changes
		const changeRes = await app.request(
			"/v1/changes",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: "chg_deploy_241",
					environment: "prod",
					kind: "deploy",
					source: "ci_webhook",
					serviceName: "checkout-api",
					version: "v2.4.1",
					previousVersion: "v2.4.0",
					commitSha: "8f3a1b2",
					previousCommitSha: "1111111",
					summary: "Deploy checkout-api v2.4.1 (batch inventory lock)",
					touchedPaths: ["src/checkout/inventory.ts", "src/checkout/routes.ts"],
					occurredAt: new Date(deployTime).toISOString(),
				}),
			},
			env,
		);
		expect(changeRes.status).toBe(201);

		// Verify GET /internal/changes/:id/blast-radius computes cohort lift + code-path overlap
		const blastRes = await app.request(
			"/internal/changes/chg_deploy_241/blast-radius?environment=prod",
			{ method: "GET" },
			env,
		);
		expect(blastRes.status).toBe(200);
		const { blastRadius } = (await blastRes.json()) as {
			blastRadius: NonNullable<
				Awaited<ReturnType<typeof computeChangeBlastRadius>>
			>;
		};
		expect(blastRadius.cohortVerdict).toBe("isolated_to_new_version");
		expect(blastRadius.causalProofTier).toBe("cohort_rate_isolated");
		expect(blastRadius.overlappingCodePaths).toContain(
			"src/checkout/inventory.ts",
		);

		// 2. Incident deduplication & runner lease coordination (P2 #7)
		const inc1Res = await app.request(
			"/internal/incidents",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					targetNodeId: serviceNodeId,
					symptomAnchorKind: "trace",
					symptomAnchorId: "tr_new_0",
					symptomFingerprint: "fp_checkout_lock_timeout",
				}),
			},
			env,
		);
		expect(inc1Res.status).toBe(201);
		const inc1Body = (await inc1Res.json()) as {
			incident: { id: string; alertCount: number };
			deduplicated: boolean;
		};
		expect(inc1Body.deduplicated).toBe(false);
		expect(inc1Body.incident.alertCount).toBe(1);

		// Second identical alert coalesces into the same active incident
		const inc2Res = await app.request(
			"/internal/incidents",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					targetNodeId: serviceNodeId,
					symptomAnchorKind: "trace",
					symptomAnchorId: "tr_new_1",
					symptomFingerprint: "fp_checkout_lock_timeout",
				}),
			},
			env,
		);
		expect(inc2Res.status).toBe(200);
		const inc2Body = (await inc2Res.json()) as {
			incident: { id: string; alertCount: number };
			deduplicated: boolean;
		};
		expect(inc2Body.deduplicated).toBe(true);
		expect(inc2Body.incident.id).toBe(inc1Body.incident.id);
		expect(inc2Body.incident.alertCount).toBe(2);

		const incidentId = inc1Body.incident.id;

		// Runner 1 acquires lease; Runner 2 gets 409 Conflict
		const lease1 = await app.request(
			`/internal/incidents/${incidentId}/lease`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					runnerId: "runner-alpha",
					ttlSeconds: 300,
				}),
			},
			env,
		);
		expect(lease1.status).toBe(200);

		const lease2 = await app.request(
			`/internal/incidents/${incidentId}/lease`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					runnerId: "runner-beta",
					ttlSeconds: 300,
				}),
			},
			env,
		);
		expect(lease2.status).toBe(409);

		// 3. Record InvestigationFinding at corroborated_candidate first to test human approval gate (P1 #4)
		const findingRes = await app.request(
			"/internal/findings",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					incidentId,
					title:
						"Checkout lock timeout caused by v2.4.1 batch lock in inventory.ts",
					summary:
						"Deploy v2.4.1 introduced batch lock contention in reserveInventoryBatch",
					causalProofTier: "corroborated_candidate",
					symptomEntityKind: "trace",
					symptomEntityId: "tr_new_0",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp_new_0",
					rootCauseEntityKind: "change",
					rootCauseEntityId: "chg_deploy_241",
					// No contributingChangeId: the server cannot recompute a cohort
					// verdict, so the proof tier stays corroborated_candidate.
					cohortVerdict: "shared_degradation_new_version_aggressor",
					causalChain: [
						{
							subjectKind: "trace",
							subjectId: "tr_new_0",
							predicate: "originated_fault_in_span",
							objectKind: "span",
							objectId: "sp_new_0",
							relationshipCertainty: "exact",
							causalProofTier: "unverified_locus",
							confidence: 0.9,
							reason: "Fault locus",
						},
						{
							subjectKind: "span",
							subjectId: "sp_new_0",
							predicate: "touched_same_code_path",
							objectKind: "change",
							objectId: "chg_deploy_241",
							relationshipCertainty: "exact",
							causalProofTier: "corroborated_candidate",
							confidence: 0.85,
							reason: "Stackframe overlaps src/checkout/inventory.ts",
						},
					],
					citedEvidenceIds: ["tr_new_0", "sp_new_0", "chg_deploy_241"],
				}),
			},
			env,
		);
		expect(findingRes.status).toBe(201);
		const { finding } = (await findingRes.json()) as {
			finding: { id: string; fingerprint: string; causalProofTier: string };
		};
		expect(finding.causalProofTier).toBe("corroborated_candidate");

		// Proposing rollback_deploy on corroborated_candidate must require human_approved_write
		const propHumanRes = await app.request(
			"/internal/remediations/propose",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					incidentId,
					findingId: finding.id,
					idempotencyKey: "idem_human_rollback_1",
					actionKind: "rollback_deploy",
					targetNodeId: serviceNodeId,
					expectedCurrentState: { version: "v2.4.1" },
					desiredTargetState: { version: "v2.4.0" },
					requestedAutonomy: "autonomous_write",
				}),
			},
			env,
		);
		expect(propHumanRes.status).toBe(201);
		const propHumanBody = (await propHumanRes.json()) as {
			proposal: { id: string; effectiveAutonomy: string; status: string };
			grantToken: string | null;
		};
		expect(propHumanBody.proposal.effectiveAutonomy).toBe(
			"human_approved_write",
		);
		expect(propHumanBody.proposal.status).toBe("pending_human_approval");
		expect(propHumanBody.grantToken).toBeNull();

		// Agent attempting to self-approve with Authorization: Bearer must get 403 Forbidden (P1 #4)
		const agentApproveRes = await app.request(
			`/internal/remediations/${propHumanBody.proposal.id}/approve`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer obs_tok_agent_secret",
				},
				body: JSON.stringify({ environment: "prod" }),
			},
			env,
		);
		expect(agentApproveRes.status).toBe(403);

		// Human session with obs_session cookie approves -> mints grantToken
		const humanApproveRes = await app.request(
			`/internal/remediations/${propHumanBody.proposal.id}/approve`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: "obs_session=sess_human_operator_123",
					// Client-supplied identities must be ignored (B15).
					"X-Obs-User-Actor": "sawan@obsunified.dev",
				},
				body: JSON.stringify({
					environment: "prod",
					approvedByUserId: "ceo@example.com",
				}),
			},
			env,
		);
		expect(humanApproveRes.status).toBe(200);
		const humanApproveBody = (await humanApproveRes.json()) as {
			proposal: { status: string; approvedByUserId: string };
			grantToken: string;
		};
		expect(humanApproveBody.proposal.status).toBe("grant_issued");
		expect(humanApproveBody.proposal.approvedByUserId).toMatch(
			/^dashboard_session:[0-9a-f]{16}$/,
		);
		expect(humanApproveBody.proposal.approvedByUserId).not.toContain(
			"sess_human_operator_123",
		);
		expect(humanApproveBody.grantToken).toMatch(/^rgt_/);

		// 4. Paired Counterfactual Gate (P1 #3)
		// Create EvalCase from failing trace tr_new_0
		const evalCaseRes = await app.request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "trace",
					sourceEntityId: "tr_new_0",
					name: "Reproduce checkout lock timeout",
					expectedOutcome:
						"Checkout completes under 200ms without lock timeout",
				}),
			},
			env,
		);
		expect(evalCaseRes.status).toBe(201);
		const { evalCase } = (await evalCaseRes.json()) as {
			evalCase: { id: string };
		};

		// Create failing baseline EvalRun (v2.4.1) and passing candidate EvalRun (v2.4.0)
		const failRunRes = await app.request(
			"/internal/eval-runs",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: "run_baseline_fail_241",
					evalCaseId: evalCase.id,
					status: "failed",
					environment: "prod",
					serviceVersion: "v2.4.1",
					commitSha: "8f3a1b2",
					inputPayloadHash: "sha256_payload_checkout_99",
					failureFingerprint: finding.fingerprint,
					totalCount: 1,
					passCount: 0,
					failCount: 1,
				}),
			},
			env,
		);
		expect(failRunRes.status).toBe(201);

		const passRunRes = await app.request(
			"/internal/eval-runs",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: "run_candidate_pass_240",
					evalCaseId: evalCase.id,
					status: "completed",
					environment: "prod",
					serviceVersion: "v2.4.0",
					commitSha: "1111111",
					inputPayloadHash: "sha256_payload_checkout_99",
					totalCount: 1,
					passCount: 1,
					failCount: 0,
				}),
			},
			env,
		);
		expect(passRunRes.status).toBe(201);

		// Attempting to verify counterfactual when baseline also passed (or same run passed for both) must fail with 422
		const invalidCfRes = await app.request(
			`/internal/findings/${finding.id}/counterfactual`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					evalCaseId: evalCase.id,
					failingRunId: "run_candidate_pass_240", // passing run used as baseline -> must fail!
					passingRunIds: ["run_candidate_pass_240"],
				}),
			},
			env,
		);
		expect(invalidCfRes.status).toBe(422);

		// Valid paired counterfactual verification upgrades finding to counterfactual_verified
		const validCfRes = await app.request(
			`/internal/findings/${finding.id}/counterfactual`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					evalCaseId: evalCase.id,
					failingRunId: "run_baseline_fail_241",
					passingRunIds: ["run_candidate_pass_240"],
				}),
			},
			env,
		);
		expect(validCfRes.status).toBe(200);
		const validCfBody = (await validCfRes.json()) as {
			finding: {
				causalProofTier: string;
				causalVerificationStatus: string;
				confidence: number;
			};
		};
		expect(validCfBody.finding.causalProofTier).toBe("counterfactual_verified");
		expect(validCfBody.finding.causalVerificationStatus).toBe(
			"counterfactual_verified",
		);
		expect(validCfBody.finding.confidence).toBeGreaterThanOrEqual(0.95);

		// 5. Autonomous Remediation Proposal, State-Mismatch Check, Single-Use Claim & Complete
		const autoPropRes = await app.request(
			"/internal/remediations/propose",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					incidentId,
					findingId: finding.id,
					idempotencyKey: "idem_auto_rollback_241",
					actionKind: "rollback_deploy",
					targetNodeId: serviceNodeId,
					expectedCurrentState: { version: "v2.4.1" },
					desiredTargetState: { version: "v2.4.0" },
					requestedAutonomy: "autonomous_write",
				}),
			},
			env,
		);
		expect(autoPropRes.status).toBe(201);
		const autoPropBody = (await autoPropRes.json()) as {
			proposal: { id: string; effectiveAutonomy: string; status: string };
			grantToken: string;
		};
		expect(autoPropBody.proposal.effectiveAutonomy).toBe("autonomous_write");
		expect(autoPropBody.proposal.status).toBe("grant_issued");
		expect(autoPropBody.grantToken).toMatch(/^rgt_/);

		// Claiming with single-use grantToken succeeds once and fails on replay
		const claim1Res = await app.request(
			`/internal/remediations/${autoPropBody.proposal.id}/claim`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					grantToken: autoPropBody.grantToken,
					runnerId: "runner-alpha",
				}),
			},
			env,
		);
		expect(claim1Res.status).toBe(200);

		const claimReplayRes = await app.request(
			`/internal/remediations/${autoPropBody.proposal.id}/claim`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					grantToken: autoPropBody.grantToken,
					runnerId: "runner-alpha",
				}),
			},
			env,
		);
		expect(claimReplayRes.status).toBe(409);

		// Record the rollback change event and complete remediation
		const rollbackChange = await recordChangeEvent(db, "default", {
			id: "chg_rollback_240",
			environment: "prod",
			kind: "rollback",
			source: "autosre_remediation",
			serviceName: "checkout-api",
			version: "v2.4.0",
			previousVersion: "v2.4.1",
			summary: "Autonomous rollback checkout-api v2.4.1 -> v2.4.0",
			occurredAt: new Date(deployTime + 120_000).toISOString(),
		});

		const completeRes = await app.request(
			`/internal/remediations/${autoPropBody.proposal.id}/complete`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					runnerId: "runner-alpha",
					resultingChangeId: rollbackChange.id,
					remediationAgentRunId: "arun_autosre_1",
				}),
			},
			env,
		);
		expect(completeRes.status).toBe(200);

		// 6. Post-Remediation Watchdog: Low Traffic vs Normal Recovery (P1 #3)
		// First force watchdog_step = 3 (+15m check) due when < 50 post-remediation spans exist -> inconclusive_low_traffic
		db.raw
			.prepare(
				`UPDATE investigation_findings SET watchdog_step = 3, next_watchdog_check_at = ? WHERE id = ?`,
			)
			.run(new Date(deployTime + 200_000).toISOString(), finding.id);

		const watchdogLow = await evaluateRemediationWatchdogs(db, {
			nowIso: new Date(deployTime + 300_000).toISOString(),
		});
		expect(watchdogLow.evaluated).toBe(1);
		expect(watchdogLow.inconclusiveLowTraffic).toBe(1);

		// Now seed 60 healthy post-rollback spans on v2.4.0 and advance watchdog
		const postRollbackBase = deployTime + 600_000;
		for (let i = 0; i < 60; i++) {
			const sIso = new Date(postRollbackBase + i * 500).toISOString();
			const eIso = new Date(postRollbackBase + i * 500 + 35).toISOString();
			insertSpan(db, {
				traceId: `tr_recovered_${i}`,
				spanId: `sp_recovered_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				spanKind: 1,
				statusCode: 1,
				startTime: sIso,
				endTime: eIso,
				durationMs: 35,
				environment: "prod",
				serviceVersion: "v2.4.0",
			});
		}

		// Force next_watchdog_check_at due and evaluate
		db.raw
			.prepare(
				`UPDATE investigation_findings SET recovery_status = 'monitoring', watchdog_step = 3, next_watchdog_check_at = ? WHERE id = ?`,
			)
			.run(new Date(postRollbackBase + 40_000).toISOString(), finding.id);

		// A single healthy checkpoint is not enough (B11): two consecutive
		// sufficient-traffic ok checkpoints are required before `recovered`.
		const watchdogFirstOk = await evaluateRemediationWatchdogs(db, {
			nowIso: new Date(postRollbackBase + 50_000).toISOString(),
		});
		expect(watchdogFirstOk.recovered).toBe(0);
		db.raw
			.prepare(
				`UPDATE investigation_findings SET next_watchdog_check_at = ? WHERE id = ?`,
			)
			.run(new Date(postRollbackBase + 60_000).toISOString(), finding.id);
		const watchdogRecovered = await evaluateRemediationWatchdogs(db, {
			nowIso: new Date(postRollbackBase + 70_000).toISOString(),
		});
		expect(watchdogRecovered.recovered).toBe(1);

		// Verify incident is now resolved and finding recoveryStatus === 'recovered'
		const incCheckRes = await app.request(
			`/internal/incidents/${incidentId}?environment=prod`,
			{ method: "GET" },
			env,
		);
		expect(incCheckRes.status).toBe(200);
		const incCheckBody = (await incCheckRes.json()) as {
			incident: { status: string };
			findings: Array<{
				id: string;
				recoveryStatus: string;
				causalVerificationStatus: string;
			}>;
		};
		expect(incCheckBody.incident.status).toBe("resolved");
		expect(incCheckBody.findings[0]?.recoveryStatus).toBe("recovered");

		// 7. Connected Signals & Evidence Bundle (triage_incident)
		const connectedRes = await app.request(
			`/internal/connected/incident/${incidentId}`,
			{ method: "GET" },
			env,
		);
		expect(connectedRes.status).toBe(200);
		const connectedBody = (await connectedRes.json()) as {
			across: Array<{
				label: string;
				links: Array<{
					entityKind?: string;
					entityId?: string;
					relationshipCertainty?: string;
					causalProofTier?: string;
				}>;
			}>;
		};
		const allAcrossLinks = connectedBody.across.flatMap((s) => s.links);
		const findingLink = allAcrossLinks.find((l) => l.entityKind === "finding");
		expect(findingLink).toBeDefined();
		expect(findingLink?.entityId).toBe(finding.id);
		expect(findingLink?.relationshipCertainty).toBe("exact");
		expect(findingLink?.causalProofTier).toBe("counterfactual_verified");

		const bundleRes = await app.request(
			`/internal/evidence/bundle`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					intent: "triage_incident",
					anchor: {
						entityKind: "incident",
						entityId: incidentId,
					},
				}),
			},
			env,
		);
		expect(bundleRes.status).toBe(200);
		const bundleBody = (await bundleRes.json()) as {
			intent: string;
			autosre?: {
				faultLocus?: { nodeId: string; spanId?: string };
				candidateChanges?: Array<{ changeId: string }>;
				priorFindings?: Array<{ findingId: string }>;
			};
		};
		expect(bundleBody.intent).toBe("triage_incident");
		expect(bundleBody.autosre).toBeDefined();
		expect(
			bundleBody.autosre?.candidateChanges?.some(
				(c) => c.changeId === "chg_deploy_241",
			),
		).toBe(true);
		expect(
			bundleBody.autosre?.priorFindings?.some(
				(f) => f.findingId === finding.id,
			),
		).toBe(true);

		const changeBundleRes = await app.request(
			`/internal/evidence/bundle`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					intent: "triage_incident",
					anchor: {
						entityKind: "change",
						entityId: "chg_deploy_241",
					},
				}),
			},
			env,
		);
		expect(changeBundleRes.status).toBe(200);
		const changeBundleBody = (await changeBundleRes.json()) as {
			anchor: { entityKind: string; entityId: string };
			summary: string;
		};
		expect(changeBundleBody.anchor).toEqual({
			entityKind: "change",
			entityId: "chg_deploy_241",
		});
		expect(changeBundleBody.summary).toContain("chg_deploy_241");

		const findingBundleRes = await app.request(
			`/internal/evidence/bundle`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					intent: "triage_incident",
					anchor: {
						entityKind: "finding",
						entityId: finding.id,
					},
				}),
			},
			env,
		);
		expect(findingBundleRes.status).toBe(200);
		const findingBundleBody = (await findingBundleRes.json()) as {
			anchor: { entityKind: string; entityId: string };
			findings: Array<{ title: string }>;
		};
		expect(findingBundleBody.anchor).toEqual({
			entityKind: "finding",
			entityId: finding.id,
		});
		expect(
			findingBundleBody.findings.some((f) =>
				f.title.includes("Remediation proposal"),
			),
		).toBe(true);

		db.close();
	});
});

describe("AutoSRE governance hardening", () => {
	const DEPLOY = Date.parse("2026-10-15T03:00:00.000Z");
	const SERVICE_NODE = "service:prod:default:checkout-api";

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** v2.4.0 healthy, v2.4.1 at 25% errors, plus the deploy change event. */
	const seedIsolatedCohort = async (db: NodeSqliteDb) => {
		for (let i = 0; i < 60; i++) {
			const t = new Date(DEPLOY + (i + 1) * 1000).toISOString();
			const end = new Date(DEPLOY + (i + 1) * 1000 + 40).toISOString();
			insertSpan(db, {
				traceId: `g_base_${i}`,
				spanId: `g_base_sp_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				statusCode: i === 0 ? 2 : 1,
				startTime: t,
				endTime: end,
				durationMs: 40,
				serviceVersion: "v2.4.0",
			});
			insertSpan(db, {
				traceId: `g_new_${i}`,
				spanId: `g_new_sp_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				statusCode: i < 15 ? 2 : 1,
				startTime: t,
				endTime: end,
				durationMs: 40,
				serviceVersion: "v2.4.1",
			});
		}
		await recordChangeEvent(db, "default", {
			id: "chg_gov",
			environment: "prod",
			kind: "deploy",
			serviceName: "checkout-api",
			version: "v2.4.1",
			previousVersion: "v2.4.0",
			summary: "Deploy v2.4.1",
			occurredAt: new Date(DEPLOY).toISOString(),
		});
	};

	const newIncident = async (db: NodeSqliteDb, fingerprint = "fp_gov") =>
		(
			await openOrDeduplicateIncident(db, "default", {
				environment: "prod",
				targetNodeId: SERVICE_NODE,
				symptomAnchorKind: "trace",
				symptomAnchorId: "t1",
				symptomFingerprint: fingerprint,
				symptomCategory: fingerprint,
			})
		).incident;

	const newFinding = (
		db: NodeSqliteDb,
		incidentId: string,
		extra: Partial<Parameters<typeof recordInvestigationFinding>[2]> = {},
	) =>
		recordInvestigationFinding(db, "default", {
			environment: "prod",
			incidentId,
			title: "Checkout regression",
			summary: "Errors after deploy",
			causalProofTier: "corroborated_candidate",
			symptomEntityKind: "trace",
			symptomEntityId: "t1",
			faultLocusEntityKind: "service",
			faultLocusEntityId: SERVICE_NODE,
			causalChain: [],
			citedEvidenceIds: [],
			...extra,
		});

	const propose = (
		db: NodeSqliteDb,
		incidentId: string,
		findingId: string,
		key: string,
		extra: Record<string, unknown> = {},
	) =>
		proposeRemediationAction(db, "default", {
			environment: "prod",
			incidentId,
			findingId,
			idempotencyKey: key,
			actionKind: "rollback_deploy",
			targetNodeId: SERVICE_NODE,
			expectedCurrentState: {},
			desiredTargetState: { version: "v2.4.0" },
			requestedAutonomy: "autonomous_write",
			...extra,
		} as Parameters<typeof proposeRemediationAction>[2]);

	const grantedProposal = async (db: NodeSqliteDb, key = "idem_granted") => {
		await seedIsolatedCohort(db);
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id, {
			contributingChangeId: "chg_gov",
		});
		const proposal = await propose(db, incident.id, finding.id, key);
		return { incident, finding, proposal };
	};

	it("B1: a client-asserted isolated_to_new_version verdict cannot buy an autonomous rollback grant", async () => {
		const db = createMigratedSqliteDb();
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id, {
			cohortVerdict: "isolated_to_new_version",
			causalProofTier: "cohort_rate_isolated",
			causalChain: [
				{
					subjectKind: "service",
					subjectId: SERVICE_NODE,
					predicate: "isolated_to_version_cohort",
					objectKind: "change",
					objectId: "chg_missing",
					relationshipCertainty: "exact",
					causalProofTier: "cohort_rate_isolated",
					confidence: 0.99,
					reason: "asserted by client",
				},
			],
		});
		expect(finding.causalProofTier).toBe("corroborated_candidate");
		expect(finding.cohortVerdict).toBeNull();

		const proposal = await propose(db, incident.id, finding.id, "idem_b1");
		expect(proposal.status).toBe("pending_human_approval");
		expect(proposal.grantToken).toBeUndefined();

		// Pointing at a real change whose telemetry does not show isolation
		// (no spans at all) does not help either.
		await recordChangeEvent(db, "default", {
			id: "chg_empty",
			environment: "prod",
			kind: "deploy",
			serviceName: "checkout-api",
			version: "v9",
			summary: "no telemetry",
		});
		const f2 = await newFinding(db, incident.id, {
			cohortVerdict: "isolated_to_new_version",
			contributingChangeId: "chg_empty",
		});
		expect(f2.causalProofTier).toBe("corroborated_candidate");
		db.close();
	});

	it("B1: the server-recomputed isolated verdict is what yields cohort_rate_isolated and an autonomous grant", async () => {
		const db = createMigratedSqliteDb();
		const { finding, proposal } = await grantedProposal(db);
		expect(finding.causalProofTier).toBe("cohort_rate_isolated");
		expect(finding.cohortVerdict).toBe("isolated_to_new_version");
		expect(proposal.status).toBe("grant_issued");
		expect(proposal.grantToken).toMatch(/^rgt_/);
		db.close();
	});

	it("B2: a grant token is single-use, sequentially and under concurrent claims", async () => {
		const db = createMigratedSqliteDb();
		const { proposal } = await grantedProposal(db);
		const token = proposal.grantToken as string;

		await claimRemediationGrant(db, "default", proposal.id, {
			environment: "prod",
			grantToken: token,
			runnerId: "r1",
		});
		await expect(
			claimRemediationGrant(db, "default", proposal.id, {
				environment: "prod",
				grantToken: token,
				runnerId: "r2",
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		// Concurrent claims on a fresh grant: exactly one wins.
		const second = await propose(
			db,
			proposal.incidentId,
			proposal.findingId,
			"idem_b2_conc",
			{ actionKind: "toggle_feature_flag" },
		);
		const results = await Promise.allSettled(
			["a", "b", "c", "d"].map((runnerId) =>
				claimRemediationGrant(db, "default", second.id, {
					environment: "prod",
					grantToken: second.grantToken as string,
					runnerId,
				}),
			),
		);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		for (const r of results) {
			if (r.status === "rejected") {
				expect(r.reason).toBeInstanceOf(RemediationGateError);
				expect((r.reason as RemediationGateError).statusCode).toBe(409);
			}
		}
		db.close();
	});

	it("B2: a wrong token is rejected with 403 and does not consume the grant", async () => {
		const db = createMigratedSqliteDb();
		const { proposal } = await grantedProposal(db);
		await expect(
			claimRemediationGrant(db, "default", proposal.id, {
				environment: "prod",
				grantToken: "rgt_wrong",
			}),
		).rejects.toMatchObject({ statusCode: 403 });
		const ok = await claimRemediationGrant(db, "default", proposal.id, {
			environment: "prod",
			grantToken: proposal.grantToken as string,
		});
		expect(ok.status).toBe("claimed_executing");
		db.close();
	});

	it("B3: concurrent lease acquisition has exactly one winner; expired leases can be taken over", async () => {
		const db = createMigratedSqliteDb();
		const incident = await newIncident(db);
		const results = await Promise.all(
			["a", "b", "c"].map((runnerId) =>
				acquireIncidentLease(db, "default", incident.id, {
					environment: "prod",
					runnerId,
				}),
			),
		);
		const winners = results.filter((r) => r.acquired);
		expect(winners).toHaveLength(1);
		const owner = (winners[0] as { incident: { leaseOwnerId: string } })
			.incident.leaseOwnerId;
		// The owner can renew; a rival cannot until expiry.
		expect(
			(
				await acquireIncidentLease(db, "default", incident.id, {
					environment: "prod",
					runnerId: owner,
				})
			).acquired,
		).toBe(true);
		const rival = owner === "a" ? "b" : "a";
		expect(
			(
				await acquireIncidentLease(db, "default", incident.id, {
					environment: "prod",
					runnerId: rival,
				})
			).acquired,
		).toBe(false);
		const later = new Date(Date.now() + 3600_000).toISOString();
		const takeover = await acquireIncidentLease(db, "default", incident.id, {
			environment: "prod",
			runnerId: rival,
			nowIso: later,
		});
		expect(takeover.acquired).toBe(true);
		db.close();
	});

	it("B4: concurrent alerts for one symptom open exactly one active incident", async () => {
		const db = createMigratedSqliteDb();
		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				openOrDeduplicateIncident(db, "default", {
					environment: "prod",
					targetNodeId: SERVICE_NODE,
					symptomAnchorKind: "alert",
					symptomAnchorId: "a1",
					symptomCategory: "race",
				}),
			),
		);
		expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
		expect(new Set(results.map((r) => r.incident.id)).size).toBe(1);
		const count = db.raw
			.prepare(`SELECT COUNT(*) AS n FROM incident_investigations`)
			.get() as { n: number };
		expect(count.n).toBe(1);
		expect(results[0].incident.alertCount).toBeGreaterThanOrEqual(1);

		// The database itself refuses a second active row for the same key.
		expect(() =>
			db.raw
				.prepare(
					`INSERT INTO incident_investigations (project_id, environment, id, dedup_key, status, target_node_id, symptom_anchor_kind, symptom_anchor_id, opened_at, updated_at)
					 SELECT project_id, environment, 'dupe', dedup_key, 'open', target_node_id, symptom_anchor_kind, symptom_anchor_id, opened_at, updated_at FROM incident_investigations`,
				)
				.run(),
		).toThrow(/UNIQUE/i);
		// Once resolved, a new incident for the same symptom is allowed.
		db.raw
			.prepare(`UPDATE incident_investigations SET status = 'resolved'`)
			.run();
		const reopened = await openOrDeduplicateIncident(db, "default", {
			environment: "prod",
			targetNodeId: SERVICE_NODE,
			symptomAnchorKind: "alert",
			symptomAnchorId: "a1",
			symptomCategory: "race",
		});
		expect(reopened.deduplicated).toBe(false);
		db.close();
	});

	it("B5: concurrent proposals with one idempotency key return the same row instead of a DB error", async () => {
		const db = createMigratedSqliteDb();
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id);
		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				propose(db, incident.id, finding.id, "idem_same"),
			),
		);
		expect(new Set(results.map((r) => r.id)).size).toBe(1);
		await expect(
			propose(db, incident.id, finding.id, "idem_same", {
				actionKind: "apply_config",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		db.close();
	});

	it("B6: the watchdog route ignores a client clock and only evaluates the caller's project", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);
		db.raw
			.prepare(
				`INSERT INTO investigation_findings (id, project_id, environment, fingerprint, fingerprint_input_json, title, summary, causal_proof_tier, causal_verification_status, confidence, confidence_breakdown_json, symptom_entity_kind, symptom_entity_id, fault_locus_entity_kind, fault_locus_entity_id, causal_chain_json, cited_evidence_ids_json, actor_type, actor_id, created_at, updated_at, recovery_status, watchdog_step, next_watchdog_check_at)
				 VALUES ('fnd_other', 'other-project', 'prod', 'fp', '{}', 't', 's', 'corroborated_candidate', 'unverified', 0.5, '{}', 'trace', 't', 'service', 'service:prod:default:x', '[]', '[]', 'agent', 'a', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'monitoring', 1, '2026-01-01T00:02:00.000Z')`,
			)
			.run();
		const res = await app.request(
			"/internal/remediations/watchdog",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					nowIso: "2099-01-01T00:00:00.000Z",
					minComparableRequests: 0,
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { evaluated: number }).evaluated).toBe(0);
		const row = db.raw
			.prepare(
				`SELECT recovery_status FROM investigation_findings WHERE id = 'fnd_other'`,
			)
			.get() as { recovery_status: string };
		expect(row.recovery_status).toBe("monitoring");
		db.close();
	});

	it("B7: only the claiming runner can complete or fail, and only while claimed (and, for complete, unexpired)", async () => {
		const db = createMigratedSqliteDb();
		const { proposal } = await grantedProposal(db);
		// Not yet claimed.
		await expect(
			completeRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "r1",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		await expect(
			failRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "r1",
				failureReason: "x",
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		const t0 = new Date().toISOString();
		await claimRemediationGrant(db, "default", proposal.id, {
			environment: "prod",
			grantToken: proposal.grantToken as string,
			runnerId: "r1",
			nowIso: t0,
		});
		await expect(
			completeRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "someone-else",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		await expect(
			completeRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		await expect(
			failRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "someone-else",
				failureReason: "x",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		await expect(
			completeRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "r1",
				nowIso: new Date(Date.parse(t0) + 6 * 60_000).toISOString(),
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		const failed = await failRemediationProposal(db, "default", proposal.id, {
			environment: "prod",
			runnerId: "r1",
			failureReason: "boom",
		});
		expect(failed.status).toBe("failed_execution");
		// Terminal: cannot be failed or completed again.
		await expect(
			failRemediationProposal(db, "default", proposal.id, {
				environment: "prod",
				runnerId: "r1",
				failureReason: "again",
			}),
		).rejects.toMatchObject({ statusCode: 409 });
		db.close();
	});

	it("B8: incident webhooks refuse private targets and redirects, never follow redirects, and time out", async () => {
		const db = createMigratedSqliteDb();
		const incident = await newIncident(db);
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const okFetch = (async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response("ok", { status: 200 });
		}) as unknown as typeof fetch;

		const privateLookup = vi.fn(async () => ["10.0.0.5"]);
		const refused = await dispatchIncidentWebhook(db, "default", incident.id, {
			environment: "prod",
			url: "https://internal.example.com/hook",
			hostLookup: privateLookup,
			fetchImpl: okFetch,
		});
		expect(refused.delivered).toBe(false);
		expect(refused.error).toMatch(/private/);
		const literal = await dispatchIncidentWebhook(db, "default", incident.id, {
			environment: "prod",
			url: "http://127.0.0.1:8080/hook",
			fetchImpl: okFetch,
		});
		expect(literal.delivered).toBe(false);
		const unresolvable = await dispatchIncidentWebhook(
			db,
			"default",
			incident.id,
			{
				environment: "prod",
				url: "https://nowhere.example.com/hook",
				hostLookup: async () => {
					throw new Error("ENOTFOUND");
				},
				fetchImpl: okFetch,
			},
		);
		expect(unresolvable.delivered).toBe(false);
		expect(calls).toHaveLength(0);

		const delivered = await dispatchIncidentWebhook(
			db,
			"default",
			incident.id,
			{
				environment: "prod",
				url: "https://hooks.example.com/hook",
				secret: "s3cret",
				hostLookup: async () => ["93.184.216.34"],
				fetchImpl: okFetch,
			},
		);
		expect(delivered.delivered).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].init.redirect).toBe("manual");
		expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
		expect(
			(calls[0].init.headers as Record<string, string>)["X-Obs-Signature-256"],
		).toMatch(/^sha256=[0-9a-f]{64}$/);

		const redirected = await dispatchIncidentWebhook(
			db,
			"default",
			incident.id,
			{
				environment: "prod",
				url: "https://hooks.example.com/hook",
				hostLookup: async () => ["93.184.216.34"],
				fetchImpl: (async () =>
					new Response(null, {
						status: 302,
						headers: { Location: "http://169.254.169.254/" },
					})) as unknown as typeof fetch,
			},
		);
		expect(redirected.delivered).toBe(false);
		expect(redirected.error).toMatch(/Redirect/);
		db.close();
	});

	it("B8: the dispatch route cannot disable the SSRF guard from the request body", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);
		const incident = await newIncident(db);
		const fetchSpy = vi.fn(async () => new Response("ok"));
		vi.stubGlobal("fetch", fetchSpy);
		const res = await app.request(
			`/internal/incidents/${incident.id}/dispatch`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					webhookUrl: "http://127.0.0.1:9/hook",
					allowPrivateNetworks: true,
					allowPrivateWebhookTargets: true,
				}),
			},
			env,
		);
		expect(res.status).toBe(502);
		expect(fetchSpy).not.toHaveBeenCalled();

		// The operator-level env flag is the only way to allow private targets.
		const allowed = await app.request(
			`/internal/incidents/${incident.id}/dispatch`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					environment: "prod",
					webhookUrl: "http://127.0.0.1:9/hook",
				}),
			},
			{ ...env, ALERT_WEBHOOK_ALLOW_PRIVATE: "true" },
		);
		expect(allowed.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		db.close();
	});

	it("B9: approve -> grant token pushed over the webhook -> claim succeeds once -> second claim 409", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id); // corroborated: needs a human
		const proposal = await propose(db, incident.id, finding.id, "idem_b9");
		expect(proposal.status).toBe("pending_human_approval");

		const bodies: Array<Record<string, unknown>> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				bodies.push(JSON.parse(String(init.body)));
				return new Response("ok", { status: 200 });
			}),
		);
		const approveEnv = { ...env, ALERT_WEBHOOK_ALLOW_PRIVATE: "true" };
		const approve = await app.request(
			`/internal/remediations/${proposal.id}/approve`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: "obs_session=sess_b9",
				},
				body: JSON.stringify({
					environment: "prod",
					webhookUrl: "https://runner.example.com/grants",
					secret: "hmac-secret",
				}),
			},
			approveEnv,
		);
		expect(approve.status).toBe(200);
		const approved = (await approve.json()) as {
			grantToken: string;
			webhookDelivery?: { delivered: boolean };
		};
		expect(approved.grantToken).toMatch(/^rgt_/);
		expect(approved.webhookDelivery?.delivered).toBe(true);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toMatchObject({
			event: "autosre.remediation.grant_issued",
			proposalId: proposal.id,
			status: "grant_issued",
			grantToken: approved.grantToken,
			incidentId: incident.id,
		});

		const claim = (runnerId: string) =>
			app.request(
				`/internal/remediations/${proposal.id}/claim`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						environment: "prod",
						grantToken: approved.grantToken,
						runnerId,
					}),
				},
				env,
			);
		expect((await claim("runner-x")).status).toBe(200);
		expect((await claim("runner-y")).status).toBe(409);
		db.close();
	});

	it("B12: the circuit breaker is scoped to fingerprint + action kind and ignores rejected proposals", async () => {
		const db = createMigratedSqliteDb();
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id);
		const mk = (key: string, extra: Record<string, unknown> = {}) =>
			propose(db, incident.id, finding.id, key, extra);

		const a = await mk("k1");
		await mk("k2");
		await mk("k3");
		// A different action kind has its own budget.
		expect(
			(await mk("k_other", { actionKind: "apply_config" })).status,
		).not.toBe("rejected");
		// Rejecting one frees a slot, so the next proposal is not blocked.
		await rejectRemediationProposal(db, "default", a.id, {
			environment: "prod",
			rejectedByUserId: "tester",
		});
		expect((await mk("k4")).status).toBe("pending_human_approval");
		// Three live ones now exist: the next is blocked by policy.
		const blocked = await mk("k5");
		expect(blocked.status).toBe("rejected");
		expect(blocked.policyDecisionReason).toMatch(/Circuit breaker/);
		db.close();
	});

	it("B18: unknown incidents 404 and read_only/suggested_action requests never become grants", async () => {
		const db = createMigratedSqliteDb();
		const { incident, finding } = await (async () => {
			await seedIsolatedCohort(db);
			const incident = await newIncident(db);
			const finding = await newFinding(db, incident.id, {
				contributingChangeId: "chg_gov",
			});
			return { incident, finding };
		})();
		await expect(
			propose(db, "inc_missing", finding.id, "idem_404"),
		).rejects.toMatchObject({ statusCode: 404 });
		for (const level of ["read_only", "suggested_action"]) {
			const p = await propose(db, incident.id, finding.id, `idem_${level}`, {
				requestedAutonomy: level,
			});
			expect(p.status).toBe("pending_human_approval");
			expect(p.effectiveAutonomy).toBe(level);
			expect(p.grantToken).toBeUndefined();
		}
		db.close();
	});

	it("B11: watchdog checkpoints are anchored to completion time and recovery needs two consecutive healthy checkpoints", async () => {
		const db = createMigratedSqliteDb();
		const { proposal, incident, finding } = await grantedProposal(db);
		const t0 = Date.now();
		const at = (offsetMs: number) => new Date(t0 + offsetMs).toISOString();
		await claimRemediationGrant(db, "default", proposal.id, {
			environment: "prod",
			grantToken: proposal.grantToken as string,
			runnerId: "r1",
			nowIso: at(0),
		});
		await completeRemediationProposal(db, "default", proposal.id, {
			environment: "prod",
			runnerId: "r1",
			nowIso: at(60_000),
		});
		const completedAt = t0 + 60_000;
		const state = () =>
			db.raw
				.prepare(
					`SELECT recovery_status, watchdog_step, consecutive_ok_checks, next_watchdog_check_at FROM investigation_findings WHERE id = ?`,
				)
				.get(finding.id) as {
				recovery_status: string;
				watchdog_step: number;
				consecutive_ok_checks: number;
				next_watchdog_check_at: string | null;
			};
		expect(state().next_watchdog_check_at).toBe(
			new Date(completedAt + 2 * 60_000).toISOString(),
		);

		for (let i = 0; i < 60; i++) {
			const t = new Date(completedAt + 30_000 + i * 100).toISOString();
			insertSpan(db, {
				traceId: `g_ok_${i}`,
				spanId: `g_ok_sp_${i}`,
				serviceName: "checkout-api",
				spanName: "POST /checkout",
				statusCode: 1,
				startTime: t,
				endTime: t,
				durationMs: 20,
				serviceVersion: "v2.4.0",
			});
		}

		// Checkpoint 1 runs late (+10m): next checkpoint is still anchored on
		// completion (+5m), not on "now + offset".
		const first = await evaluateRemediationWatchdogs(db, {
			projectId: "default",
			nowIso: at(60_000 + 10 * 60_000),
		});
		expect(first.recovered).toBe(0);
		expect(state()).toMatchObject({
			recovery_status: "monitoring",
			watchdog_step: 2,
			consecutive_ok_checks: 1,
			next_watchdog_check_at: new Date(completedAt + 5 * 60_000).toISOString(),
		});

		const second = await evaluateRemediationWatchdogs(db, {
			projectId: "default",
			nowIso: at(60_000 + 11 * 60_000),
		});
		expect(second.recovered).toBe(1);
		expect(state().recovery_status).toBe("recovered");
		const inc = db.raw
			.prepare(`SELECT status FROM incident_investigations WHERE id = ?`)
			.get(incident.id) as { status: string };
		expect(inc.status).toBe("resolved");
		db.close();
	});

	it("B14/B17: routes reject unknown predicates and invalid timestamps", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);
		const post = (path: string, body: unknown) =>
			app.request(
				path,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				},
				env,
			);

		const badPredicate = await post("/internal/findings", {
			title: "t",
			summary: "s",
			symptomEntityKind: "trace",
			symptomEntityId: "t1",
			faultLocusEntityKind: "service",
			faultLocusEntityId: SERVICE_NODE,
			causalChain: [
				{
					subjectKind: "trace",
					subjectId: "t1",
					predicate: "made_up_predicate",
					objectKind: "span",
					objectId: "s1",
				},
			],
		});
		expect(badPredicate.status).toBe(400);

		const badDate = await post("/v1/changes", {
			kind: "deploy",
			summary: "x",
			serviceName: "checkout-api",
			occurredAt: "yesterday-ish",
		});
		expect(badDate.status).toBe(400);
		const badKind = await post("/v1/changes", { kind: "nope", summary: "x" });
		expect(badKind.status).toBe(400);

		const offset = await post("/v1/changes", {
			id: "chg_tz",
			kind: "deploy",
			summary: "x",
			serviceName: "checkout-api",
			environment: "prod",
			source: "ci_webhook",
			occurredAt: "2026-10-15T05:00:00+02:00",
		});
		expect(offset.status).toBe(201);
		const created = (await offset.json()) as {
			changeEvent: { occurredAt: string; source: string };
		};
		expect(created.changeEvent.occurredAt).toBe("2026-10-15T03:00:00.000Z");
		expect(created.changeEvent.source).toBe("ci_webhook");

		const badSince = await app.request(
			"/internal/changes?since=garbage",
			{},
			env,
		);
		expect(badSince.status).toBe(400);
		const okSince = await app.request(
			"/internal/changes?since=2026-10-15T04:30:00%2B02:00",
			{},
			env,
		);
		expect(okSince.status).toBe(200);
		expect(
			((await okSince.json()) as { changes: unknown[] }).changes,
		).toHaveLength(1);
		db.close();
	});

	it("B15: the approver is derived from the session, never from client-supplied identity", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);
		const incident = await newIncident(db);
		const finding = await newFinding(db, incident.id);
		const proposal = await propose(db, incident.id, finding.id, "idem_b15");
		const res = await app.request(
			`/internal/remediations/${proposal.id}/approve`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: "obs_session=sess_secret_cookie_value",
					"X-Obs-User-Actor": "vp-of-engineering",
				},
				body: JSON.stringify({
					environment: "prod",
					approvedByUserId: "cto",
					approvedBySession: "cfo",
				}),
			},
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			proposal: { approvedByUserId: string };
		};
		expect(body.proposal.approvedByUserId).toMatch(
			/^dashboard_session:[0-9a-f]{16}$/,
		);
		db.close();
	});
});
