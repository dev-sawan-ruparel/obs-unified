import { buildCanonicalNodeId, buildFindingFingerprint } from "@obsunified/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import {
	computeChangeBlastRadius,
	findCrossTraceContention,
	recordChangeEvent,
} from "../lib/autosre-change-correlation";
import {
	computeTarjanScc,
	extractSpanLineageAndTopology,
	localizeTraceFaultLocus,
	upsertOntologyFromSpans,
} from "../lib/autosre-ontology";
import { evaluateRemediationWatchdogs } from "../lib/autosre-remediation-gate";
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
		const unscopedNodeId = unscopedCtx.targetNode!.id;
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
		const dbNodeId =
			"database:prod:postgresql:pg-primary.internal:5432/orders";
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
					touchedPaths: [
						"src/checkout/inventory.ts",
						"src/checkout/routes.ts",
					],
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
					contributingChangeId: "chg_deploy_241",
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
							predicate: "stackframe_overlaps_changed_file",
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
					"X-Obs-User-Actor": "sawan@obsunified.dev",
				},
				body: JSON.stringify({ environment: "prod" }),
			},
			env,
		);
		expect(humanApproveRes.status).toBe(200);
		const humanApproveBody = (await humanApproveRes.json()) as {
			proposal: { status: string; approvedByUserId: string };
			grantToken: string;
		};
		expect(humanApproveBody.proposal.status).toBe("grant_issued");
		expect(humanApproveBody.proposal.approvedByUserId).toBe(
			"sawan@obsunified.dev",
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
					expectedOutcome: "Checkout completes under 200ms without lock timeout",
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

		const watchdogRecovered = await evaluateRemediationWatchdogs(db, {
			nowIso: new Date(postRollbackBase + 50_000).toISOString(),
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
