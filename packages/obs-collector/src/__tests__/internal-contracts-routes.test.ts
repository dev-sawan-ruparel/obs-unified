import {
	ContractMismatchError,
	createInternalClient,
	InternalClientHttpError,
	type InternalEndpoints,
} from "@obsunified/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { upsertOntologyFromSpans } from "../lib/autosre-ontology";
import {
	createMigratedSqliteDb,
	type NodeSqliteDb,
} from "../lib/test-utils/node-sqlite-db";
import { aiReceiverPlugin } from "../plugins/ai-receiver";
import {
	autosreRoutesPlugin,
	respondWithContract,
} from "../plugins/autosre-routes";
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
	aiReceiverPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
	};
	return { app, env };
};

describe("Collector internal HTTP contract integration (RFC 0014 WS5)", () => {
	it("respondWithContract throws ContractMismatchError if a handler attempts to return a mistyped payload", () => {
		const fakeContext = {
			json: (data: unknown, status = 200) =>
				new Response(JSON.stringify(data), { status }),
		};
		expect(() =>
			respondWithContract(
				fakeContext,
				"GET /internal/incidents",
				// Intentionally mistyped payload
				{
					incidents: "not-an-array",
				} as unknown as InternalEndpoints["GET /internal/incidents"]["response"],
			),
		).toThrow(ContractMismatchError);
	});

	it("createInternalClient round-trips changes, incidents, findings, counterfactuals, remediations, evals, connected, AI calls, and evidence against collector routes", async () => {
		const db = createMigratedSqliteDb();
		const { app, env } = createTestApp(db);

		const makeClient = (defaultHeaders?: Record<string, string>) =>
			createInternalClient({
				baseUrl: "http://localhost",
				defaultHeaders,
				fetchImpl: (input, init) => app.request(input, init, env),
			});

		const client = makeClient();

		// Seed a trace + span so eval cases and ontology have a source entity
		db.raw
			.prepare(
				`INSERT INTO telemetry_spans (
					project_id, trace_id, span_id, parent_span_id, service_name,
					span_name, span_kind, start_time, end_time, duration_ms,
					status_code, status_message, attributes_json, resource_attributes_json,
					events_json, links_json, received_at, expires_at,
					environment, service_version, commit_sha, target_node_id, error_signature
				) VALUES (
					'default', 'trace-ws5', 'span-ws5', NULL, 'checkout',
					'POST /charge', 2, '2026-04-16T00:00:00.000Z', '2026-04-16T00:00:00.500Z', 500,
					2, 'Timeout', '{}', '{}',
					'[]', '[]', '2026-04-16T00:00:00.500Z', '2099-01-01T00:00:00.000Z',
					'production', '2.1.0', 'abc1234', 'service:default:checkout', 'Timeout'
				)`,
			)
			.run();
		await upsertOntologyFromSpans(db, [
			{
				projectId: "default",
				traceId: "trace-ws5",
				spanId: "span-ws5",
				parentSpanId: null,
				traceState: null,
				serviceName: "checkout",
				spanName: "POST /charge",
				spanKind: 2,
				statusCode: 2,
				statusMessage: "Timeout",
				startTime: "2026-04-16T00:00:00.000Z",
				endTime: "2026-04-16T00:00:00.500Z",
				durationMs: 500,
				environment: "prod",
				scopeName: null,
				scopeVersion: null,
				attributesJson: "{}",
				resourceAttributesJson: "{}",
				eventsJson: "[]",
				linksJson: "[]",
				droppedAttributesCount: 0,
				droppedEventsCount: 0,
				droppedLinksCount: 0,
				receivedAt: "2026-04-16T00:00:00.500Z",
				expiresAt: "2099-01-01T00:00:00.000Z",
			},
		]);

		// 1. Changes
		const createdChange = await client.request("POST /v1/changes", {
			body: {
				environment: "prod",
				kind: "deploy",
				serviceName: "checkout",
				version: "2.1.0",
				previousVersion: "2.0.0",
				commitSha: "abc1234",
				summary: "Deploy checkout 2.1.0",
			},
		});
		expect(createdChange.id).toBeTruthy();
		expect(createdChange.change.id).toBe(createdChange.id);
		expect(createdChange.changeEvent?.id).toBe(createdChange.id);

		const listedChanges = await client.request("GET /internal/changes", {
			query: { environment: "prod", serviceName: "checkout" },
		});
		expect(listedChanges.changes.some((c) => c.id === createdChange.id)).toBe(
			true,
		);

		const fetchedChange = await client.request("GET /internal/changes/:id", {
			params: { id: createdChange.id },
		});
		expect(fetchedChange.change.id).toBe(createdChange.id);

		const blastRadius = await client.request(
			"GET /internal/changes/:id/blast-radius",
			{
				params: { id: createdChange.id },
			},
		);
		expect(blastRadius.change.id).toBe(createdChange.id);
		expect(blastRadius.blastRadius.change.id).toBe(createdChange.id);

		// 2. Ontology
		const ontology = await client.request("GET /internal/ontology", {
			query: { environment: "prod", traceId: "trace-ws5" },
		});
		expect(Array.isArray(ontology.nodes)).toBe(true);

		// 3. Incidents (both /internal/incidents and /internal/incidents/open)
		const openedIncident = await client.request("POST /internal/incidents", {
			body: {
				environment: "prod",
				targetNodeId: "service:default:checkout",
				symptomAnchorKind: "trace",
				symptomAnchorId: "trace-ws5",
				symptomFingerprint: "fp-checkout-timeout",
			},
		});
		expect(openedIncident.deduplicated).toBe(false);

		const dedupedIncident = await client.request(
			"POST /internal/incidents/open",
			{
				body: {
					environment: "prod",
					targetNodeId: "service:default:checkout",
					symptomAnchorKind: "trace",
					symptomAnchorId: "trace-ws5",
					symptomFingerprint: "fp-checkout-timeout",
				},
			},
		);
		expect(dedupedIncident.deduplicated).toBe(true);
		expect(dedupedIncident.incident.id).toBe(openedIncident.incident.id);

		const leaseResult = await client.request(
			"POST /internal/incidents/:id/lease",
			{
				params: { id: openedIncident.incident.id },
				body: {
					runnerId: "runner-ws5",
					leaseDurationSeconds: 120,
				},
			},
		);
		expect(leaseResult.acquired).toBe(true);

		const incidentsList = await client.request("GET /internal/incidents", {
			query: { environment: "prod" },
		});
		expect(
			incidentsList.incidents.some((i) => i.id === openedIncident.incident.id),
		).toBe(true);

		// 4. Findings & Counterfactuals
		const createdFinding = await client.request("POST /internal/findings", {
			body: {
				environment: "prod",
				incidentId: openedIncident.incident.id,
				title: "Checkout timeout after 2.1.0 deploy",
				summary: "Cohort isolated to version 2.1.0",
				symptomEntityKind: "trace",
				symptomEntityId: "trace-ws5",
				faultLocusEntityKind: "span",
				faultLocusEntityId: "trace-ws5:span-ws5",
				rootCauseEntityKind: "change",
				rootCauseEntityId: createdChange.id,
				contributingChangeId: createdChange.id,
				causalChain: [
					{
						subjectKind: "change",
						subjectId: createdChange.id,
						predicate: "degraded_after_change",
						objectKind: "span",
						objectId: "trace-ws5:span-ws5",
						relationshipCertainty: "exact",
						causalProofTier: "corroborated_candidate",
						confidence: 0.9,
						reason: "Version 2.1.0 deployed immediately before errors",
					},
				],
				citedEvidenceIds: [`change:${createdChange.id}`, "trace:trace-ws5"],
			},
		});
		expect(createdFinding.finding.id).toBe(createdFinding.id);

		const fetchedFinding = await client.request("GET /internal/findings/:id", {
			params: { id: createdFinding.id },
		});
		expect(fetchedFinding.finding.id).toBe(createdFinding.id);

		const findingsList = await client.request("GET /internal/findings", {
			query: { incidentId: openedIncident.incident.id },
		});
		expect(findingsList.findings.some((f) => f.id === createdFinding.id)).toBe(
			true,
		);

		// Eval case + runs for counterfactual verification
		const createdCase = await client.request("POST /internal/eval-cases", {
			body: {
				sourceEntityType: "trace",
				sourceEntityId: "trace-ws5",
				name: "Checkout timeout regression case",
			},
		});
		expect(createdCase.evalCase.id).toBeTruthy();

		const listedCases = await client.request("GET /internal/eval-cases", {
			query: { sourceEntityType: "trace" },
		});
		expect(
			listedCases.evalCases.some((ec) => ec.id === createdCase.evalCase.id),
		).toBe(true);

		const failingRun = await client.request("POST /internal/eval-runs", {
			body: {
				evalCaseId: createdCase.evalCase.id,
				status: "failed",
				environment: "prod",
				serviceVersion: "2.1.0",
				commitSha: "abc1234",
				inputPayloadHash: "hash-ws5",
				failureFingerprint: createdFinding.finding.fingerprint,
				totalCount: 1,
				passCount: 0,
				failCount: 1,
			},
		});
		await client.request("POST /internal/eval-cases/:id/results", {
			params: { id: createdCase.evalCase.id },
			body: {
				runId: failingRun.evalRun.id,
				passed: false,
				inputPayloadHash: "hash-ws5",
				failureFingerprint: createdFinding.finding.fingerprint,
			},
		});

		const passingRunIds: string[] = [];
		for (let i = 0; i < 3; i += 1) {
			const passRun = await client.request("POST /internal/eval-runs", {
				body: {
					evalCaseId: createdCase.evalCase.id,
					status: "completed",
					environment: "prod",
					serviceVersion: "2.0.0",
					commitSha: "prev000",
					inputPayloadHash: "hash-ws5",
					totalCount: 1,
					passCount: 1,
					failCount: 0,
				},
			});
			await client.request("POST /internal/eval-cases/:id/results", {
				params: { id: createdCase.evalCase.id },
				body: {
					runId: passRun.evalRun.id,
					passed: true,
					inputPayloadHash: "hash-ws5",
				},
			});
			passingRunIds.push(passRun.evalRun.id);
		}

		const evalRunSummary = await client.request(
			"GET /internal/evals/runs/:id",
			{
				params: { id: failingRun.evalRun.id },
			},
		);
		expect(evalRunSummary.run.id).toBe(failingRun.evalRun.id);

		const counterfactual = await client.request(
			"POST /internal/findings/:id/counterfactual",
			{
				params: { id: createdFinding.id },
				body: {
					environment: "prod",
					evalCaseId: createdCase.evalCase.id,
					failingRunId: failingRun.evalRun.id,
					passingRunIds,
				},
			},
		);
		expect(counterfactual.verified).toBe(true);
		expect(counterfactual.finding.causalProofTier).toBe(
			"counterfactual_verified",
		);

		// 5. Remediations
		const proposedHuman = await client.request(
			"POST /internal/remediations/propose",
			{
				body: {
					environment: "prod",
					incidentId: openedIncident.incident.id,
					findingId: createdFinding.id,
					idempotencyKey: "idem-ws5-human",
					actionKind: "rollback_deploy",
					targetNodeId: "service:default:checkout",
					expectedCurrentState: { version: "2.1.0" },
					desiredTargetState: { version: "2.0.0" },
					requestedAutonomy: "human_approved_write",
				},
			},
		);
		expect(proposedHuman.proposal.status).toBe("pending_human_approval");

		// Bearer token approval must fail with 403 InternalClientHttpError
		const bearerClient = makeClient({
			Authorization: "Bearer obs_secret_agent_token",
		});
		await expect(
			bearerClient.request("POST /internal/remediations/:id/approve", {
				params: { id: proposedHuman.proposal.id },
				body: {},
			}),
		).rejects.toThrow(InternalClientHttpError);

		// Cookie session approval succeeds and mints grantToken
		const humanSessionClient = makeClient({
			Cookie: "obs_session=valid_human_session_cookie",
		});
		const approved = await humanSessionClient.request(
			"POST /internal/remediations/:id/approve",
			{
				params: { id: proposedHuman.proposal.id },
				body: {},
			},
		);
		expect(approved.proposal.status).toBe("grant_issued");
		expect(typeof approved.grantToken).toBe("string");

		const claimed = await client.request(
			"POST /internal/remediations/:id/claim",
			{
				params: { id: proposedHuman.proposal.id },
				body: {
					grantToken: approved.grantToken as string,
					runnerId: "runner-ws5",
				},
			},
		);
		expect(claimed.claimed).toBe(true);
		expect(claimed.proposal.status).toBe("claimed_executing");

		const completed = await client.request(
			"POST /internal/remediations/:id/complete",
			{
				params: { id: proposedHuman.proposal.id },
				body: {
					runnerId: "runner-ws5",
					resultingChangeId: createdChange.id,
				},
			},
		);
		expect(completed.proposal.status).toBe("completed");

		const watchdog = await client.request(
			"POST /internal/remediations/watchdog",
			{
				body: {},
			},
		);
		expect(typeof watchdog.summary.evaluated).toBe("number");

		const incidentDetail = await client.request("GET /internal/incidents/:id", {
			params: { id: openedIncident.incident.id },
		});
		expect(incidentDetail.incident.id).toBe(openedIncident.incident.id);
		expect(incidentDetail.findings.length).toBeGreaterThanOrEqual(1);
		expect(incidentDetail.proposals.length).toBeGreaterThanOrEqual(1);

		// 6. Connected, Evidence Bundle, Evidence Stats
		const connected = await client.request(
			"GET /internal/connected/:kind/:id",
			{
				params: { kind: "incident", id: openedIncident.incident.id },
			},
		);
		expect(connected.entity.id).toBe(openedIncident.incident.id);

		const bundle = await client.request("POST /internal/evidence/bundle", {
			body: {
				anchor: {
					entityKind: "incident",
					entityId: openedIncident.incident.id,
				},
			},
		});
		expect(bundle.schemaVersion).toBe("obs-unified.evidence-bundle.v1");

		const stats = await client.request("GET /internal/evidence/stats", {
			query: { limit: 10 },
		});
		expect(stats.projectId).toBe("default");
	});
});
