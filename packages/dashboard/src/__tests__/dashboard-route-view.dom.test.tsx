// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardRouteView } from "../components/DashboardRouteView";
import { ObsDashboardProvider } from "../provider";
import {
	type DashboardRoute,
	dashboardRouteToHref,
	hashRoutes,
	hrefForEntity,
	KNOWN_TABS,
	parseDashboardRouteHash,
	resolveDashboardRoute,
} from "../routes";

if (typeof globalThis.ResizeObserver === "undefined") {
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}

afterEach(() => {
	cleanup();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function createMockFetcher() {
	const requests: Array<{ url: string; method: string; body?: string }> = [];

	const fetcher: typeof fetch = async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? init.body : undefined;
		requests.push({ url, method, body });

		if (url.includes("/telemetry/overview")) {
			return jsonResponse({
				summary: {
					totalTraces: 1,
					errorTraces: 0,
					errorRate: 0,
					p95DurationMs: 18,
					averageDurationMs: 18,
				},
				services: [
					{
						serviceName: "checkout",
						traceCount: 1,
						errorTraceCount: 0,
						averageDurationMs: 18,
					},
				],
				traces: [
					{
						traceId: "t1",
						rootSpanId: "s1",
						spanName: "POST /checkout",
						serviceName: "checkout",
						durationMs: 18,
						statusCode: 1,
						statusMessage: null,
						startTime: "2026-10-16T00:00:00.000Z",
						spanCount: 2,
					},
				],
			});
		}

		if (url.includes("/telemetry/issues/detail")) {
			return jsonResponse({
				issue: {
					issueId: "iss_1",
					title: "Checkout timeout spike",
					routeLabel: "POST /checkout",
					serviceName: "checkout",
					category: "latency",
					severity: "critical",
					affectedTraceCount: 12,
					culpritSpanName: "db.query",
					lastSeen: "2026-10-16T00:00:00.000Z",
					latestStatusMessage: "Deadline exceeded",
				},
				culpritSpans: [],
				traces: [],
			});
		}

		if (url.includes("/telemetry/issues")) {
			return jsonResponse({
				summary: { totalIssues: 1 },
				services: [{ serviceName: "checkout", issueCount: 1 }],
				issues: [
					{
						issueId: "iss_1",
						title: "Checkout timeout spike",
						routeLabel: "POST /checkout",
						serviceName: "checkout",
						category: "latency",
						severity: "critical",
						affectedTraceCount: 12,
						culpritSpanName: "db.query",
						lastSeen: "2026-10-16T00:00:00.000Z",
						latestStatusMessage: "Deadline exceeded",
					},
				],
			});
		}

		if (url.includes("/telemetry/traces/t1")) {
			return jsonResponse({
				trace: {
					traceId: "t1",
					serviceName: "checkout",
					durationMs: 18,
					errorSpanCount: 0,
					startTime: "2026-10-16T00:00:00.000Z",
				},
				spans: [
					{
						traceId: "t1",
						spanId: "s1",
						parentSpanId: null,
						spanName: "POST /checkout",
						serviceName: "checkout",
						spanKind: 2,
						startTime: "2026-10-16T00:00:00.000Z",
						endTime: "2026-10-16T00:00:00.018Z",
						durationMs: 18,
						statusCode: 1,
						statusMessage: null,
						attributes: {
							"http.route": "/checkout",
							"span.marker": "span_s1_attr",
						},
						resourceAttributes: { "service.name": "checkout" },
						events: [],
					},
				],
			});
		}

		if (url.includes("/profiles/prof_1/flame")) {
			return jsonResponse({
				profile: {
					id: "prof_1",
					serviceName: "checkout",
					profileType: "cpu",
					sampleType: "samples",
					sampleUnit: "count",
					periodType: "cpu",
					periodUnit: "nanoseconds",
					durationMs: 1000,
					totalSamples: 10,
					totalValue: 100,
					startTime: "2026-10-16T00:00:00.000Z",
					endTime: "2026-10-16T00:00:01.000Z",
				},
				root: {
					name: "root",
					file: "",
					line: 0,
					self: 0,
					total: 100,
					children: [
						{
							name: "checkoutHandler",
							file: "checkout.ts",
							line: 42,
							self: 100,
							total: 100,
							children: [],
						},
					],
				},
				filteredByTraceId: "t1",
			});
		}

		if (url.includes("/profiles")) {
			return jsonResponse({ profiles: [] });
		}

		if (url.includes("/alerts/rules")) {
			return jsonResponse({
				rules: [
					{
						id: "rule_1",
						name: "Checkout High Error Rate",
						enabled: true,
						signal: "error_rate",
						comparison: "gt",
						threshold: 0.05,
						windowMins: 5,
						cooldownMins: 15,
						query: { serviceName: "checkout" },
						channels: [],
						currentState: "firing",
						lastEvaluatedAt: "2026-10-16T00:00:00.000Z",
						createdAt: "2026-10-16T00:00:00.000Z",
						updatedAt: "2026-10-16T00:00:00.000Z",
					},
				],
			});
		}

		if (url.includes("/alerts/evaluations")) {
			return jsonResponse({ evaluations: [] });
		}

		if (url.includes("/logs/overview")) {
			return jsonResponse({
				summary: { totalLogs: 1, errorLogs: 1, warnLogs: 0 },
				logs: [
					{
						logId: "log_1",
						traceId: "t1",
						spanId: "s1",
						serviceName: "checkout",
						severity: "ERROR",
						loggerName: "payment",
						message: "Payment gateway declined log_1",
						attributesJson: '{"decline_code":"insufficient_funds"}',
						occurredAt: "2026-10-16T00:00:00.000Z",
						receivedAt: "2026-10-16T00:00:00.000Z",
					},
				],
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/usage/overview")) {
			return jsonResponse({
				summary: {
					totalEvents: 1,
					uniqueSessions: 1,
					uniqueVisitors: 1,
					pageViews: 1,
					frontendErrors: 1,
					interactions: 0,
				},
				pages: [],
				events: [],
				recentSessions: [],
				frontendErrors: [
					{
						eventId: "ev_1",
						sessionId: "sess_1",
						pagePath: "/checkout",
						errorName: "TypeError",
						errorMessage: "Cannot read cart item",
						component: "CheckoutButton",
						occurredAt: "2026-10-16T00:00:00.000Z",
					},
				],
				browsers: [],
				operatingSystems: [],
				devices: [],
				countries: [],
				utmSources: [],
				utmMediums: [],
				utmCampaigns: [],
				hourlyPageViews: [],
				botsFiltered: 0,
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/actions/aggregates/autonomous-review")) {
			return jsonResponse({
				rows: [],
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/actions/aggregates/cost-attribution")) {
			return jsonResponse({
				byWorkflow: [],
				byAgentVersion: [],
				byAutonomyLevel: [],
				byRetryStatus: [],
				byToolCall: [],
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/actions/aggregates/tool-reliability")) {
			return jsonResponse({
				tools: [],
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/actions/aggregates/version-diff")) {
			return jsonResponse({
				availableVersions: [],
				baselineVersion: null,
				targetVersion: null,
				metrics: [],
				exemplars: { baselineFailures: [], targetFailures: [] },
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/remediations")) {
			return jsonResponse({
				proposals: [
					{
						id: "rem_1",
						projectId: "default",
						findingId: "fnd_1",
						incidentId: "inc_1",
						actionKind: "rollback_deploy",
						environment: "prod",
						targetNodeId: "service:prod:default:checkout",
						effectiveAutonomy: "human_approved_write",
						policyDecisionReason: "Rollback checkout v2.4.1",
						status: "pending_human_approval",
						expectedCurrentState: { version: "2.4.1" },
						desiredTargetState: { version: "2.4.0" },
						createdAt: "2026-10-16T00:00:00.000Z",
						updatedAt: "2026-10-16T00:00:00.000Z",
					},
				],
			});
		}

		const evalCaseFixture = {
			id: "ec_1",
			projectId: "default",
			sourceEntityType: "action",
			sourceEntityId: "act_1",
			name: "Checkout regression gate ec_1",
			expectedOutcome: "Order succeeds without double charge",
			rubric: null,
			redactedPrompt: null,
			referencePayload: null,
			metadata: {},
			createdAt: "2026-10-16T00:00:00.000Z",
			updatedAt: "2026-10-16T00:00:00.000Z",
		};

		if (url.includes("/eval-cases/ec_1/results")) {
			return jsonResponse({
				evalCaseResults: [
					{
						id: "res_1",
						projectId: "default",
						evalCaseId: "ec_1",
						runId: "run_1",
						passed: true,
						score: 0.95,
						actualOutcome: "All assertions passed",
						details: {},
						createdAt: "2026-10-16T00:00:00.000Z",
					},
				],
			});
		}

		if (url.includes("/eval-cases/ec_1")) {
			return jsonResponse({ evalCase: evalCaseFixture });
		}

		if (url.includes("/eval-cases")) {
			return jsonResponse({
				evalCases: [evalCaseFixture],
			});
		}

		if (url.includes("/eval-runs")) {
			return jsonResponse({ evalRuns: [] });
		}

		if (url.includes("/ai/spans")) {
			return jsonResponse({
				summary: {
					totalSpans: 1,
					errorSpans: 0,
					totalInputTokens: 100,
					totalOutputTokens: 50,
					totalCostUsd: 0.002,
					averageLatencyMs: 250,
				},
				spans: [
					{
						traceId: "t1",
						spanId: "s_ai_1",
						parentSpanId: null,
						spanName: "chat gpt-4o",
						serviceName: "checkout-agent",
						kind: "llm",
						model: "gpt-4o",
						provider: "openai",
						startTime: "2026-10-16T00:00:00.000Z",
						endTime: "2026-10-16T00:00:00.250Z",
						durationMs: 250,
						statusCode: 1,
						statusMessage: null,
						inputTokens: 100,
						outputTokens: 50,
						costUsd: 0.002,
						inputJson:
							'{"messages":[{"role":"user","content":"Help me checkout"}]}',
						outputJson: '{"content":"Sure, checking your cart."}',
						attributes: {
							"ai.call_id": "call_1",
							"llm.model_name": "gpt-4o",
							"llm.provider": "openai",
						},
					},
				],
				byModel: [],
				byService: [],
				byKind: [],
			});
		}

		if (url.includes("/ai/evaluations")) {
			return jsonResponse({ evaluations: [] });
		}

		if (url.includes("/telemetry/service-map")) {
			return jsonResponse({
				nodes: [
					{
						service: "checkout",
						spanCount: 10,
						errorCount: 1,
						errorRate: 0.1,
						traceCount: 5,
					},
				],
				edges: [],
				windowHours: 6,
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/telemetry/services/checkout/operations")) {
			return jsonResponse({
				service: "checkout",
				spanCount: 10,
				traceCount: 5,
				errorCount: 1,
				operations: [],
				recentErrors: [],
				windowHours: 6,
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/evidence/stats")) {
			return jsonResponse({
				byKind: [],
				bySource: [],
				recentRefs: [],
				recentExpansions: [],
				generatedAt: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/evidence/bundle")) {
			const parsedBody = body ? JSON.parse(body) : {};
			const anchor = parsedBody.anchor ?? {
				entityKind: "incident",
				entityId: "inc_1",
			};
			return jsonResponse({
				schemaVersion: "obs-unified.evidence-bundle.v1",
				intent: "triage_incident",
				anchor,
				summary: `Loaded bundle for ${anchor.entityKind}:${anchor.entityId}`,
				derivedSummaries: [],
				findings: [],
				compactions: [],
				evidenceReferences: [],
				retrievalRefs: [],
				suggestedNextPivots: [],
			});
		}

		if (url.includes("/users/usr_1")) {
			return jsonResponse({
				user: {
					userId: "usr_1",
					visitorId: "vis_1",
					email: "alice@example.com",
					name: "Alice Operator",
					properties: { plan: "enterprise" },
					firstSeenAt: "2026-10-16T00:00:00.000Z",
					lastSeenAt: "2026-10-16T00:00:00.000Z",
				},
			});
		}

		if (url.includes("/analyses/error_top_offenders/result")) {
			return jsonResponse({
				definition: {
					id: "error_top_offenders",
					title: "Error Top Offenders Investigation",
					description: "Top failing routes and services",
					view: "page",
					scope: {},
				},
				result: {
					analysisId: "error_top_offenders",
					status: "critical",
					headline: "Checkout service accounts for 92% of 5xx responses",
					narrative: "Spike started after deploy v2.4.1.",
					payload: { evidence: {} },
					computedAt: "2026-10-16T00:00:00.000Z",
				},
			});
		}

		if (url.includes("/analyses")) {
			return jsonResponse({ analyses: [] });
		}

		if (url.includes("/usage/sessions/sess_1")) {
			return jsonResponse({
				session: {
					sessionId: "sess_1",
					visitorId: "vis_1",
					firstSeen: "2026-10-16T00:00:00.000Z",
					lastSeen: "2026-10-16T00:01:00.000Z",
					eventCount: 2,
					pageViewCount: 1,
					errorCount: 1,
				},
				events: [],
			});
		}

		if (url.includes("/replays/sess_1")) {
			return jsonResponse({
				events: [],
				chunks: { nextChunkOffset: null },
			});
		}

		if (url.includes("/replays")) {
			return jsonResponse({
				replays: [
					{
						session_id: "sess_1",
						visitor_id: "vis_1",
						first_chunk_at: "2026-10-16T00:00:00.000Z",
						last_chunk_at: "2026-10-16T00:01:00.000Z",
						chunk_count: 1,
						events_count: 2,
					},
				],
			});
		}

		if (url.includes("/connected/action/act_1")) {
			return jsonResponse({
				entity: { kind: "action", id: "act_1", projectId: "default" },
				up: [],
				across: [],
				down: [],
				related: [],
				rawManifest: {
					agentRuns: [],
					actions: [
						{
							id: "act_1",
							projectId: "default",
							agentRunId: "run_1",
							parentActionId: null,
							actionKind: "tool_execution",
							name: "charge_card_act_1",
							status: "ok",
							autonomyLevel: "human_approved_write",
							startedAt: "2026-10-16T00:00:00.000Z",
							endedAt: "2026-10-16T00:00:00.050Z",
							traceId: "t1",
							spanId: "s1",
						},
					],
					toolCalls: [],
					retrievalEvents: [],
					evalResults: [],
					artifacts: [],
				},
			});
		}

		if (url.includes("/agent-runs/run_1")) {
			return jsonResponse({
				agentRun: { id: "run_1" },
				manifest: {
					agentRuns: [
						{
							id: "run_1",
							projectId: "default",
							agentId: "checkout-agent",
							agentName: "checkout-agent",
							agentVersion: "2.4.1",
							autonomyLevel: "bounded_write",
							environment: "prod",
							status: "ok",
							rootActionId: "act_1",
							startedAt: "2026-10-16T00:00:00.000Z",
							endedAt: "2026-10-16T00:00:01.000Z",
						},
					],
					actions: [
						{
							id: "act_1",
							projectId: "default",
							agentRunId: "run_1",
							parentActionId: null,
							actionKind: "agent_Invocation",
							name: "root_run_1_workflow",
							status: "ok",
							autonomyLevel: "bounded_write",
							startedAt: "2026-10-16T00:00:00.000Z",
							endedAt: "2026-10-16T00:00:01.000Z",
							traceId: "t1",
							spanId: "s1",
						},
					],
					toolCalls: [],
					retrievalEvents: [],
					evalResults: [],
					artifacts: [],
				},
			});
		}

		if (url.includes("/connected/tool_call/tc_1")) {
			return jsonResponse({
				entity: { kind: "tool_call", id: "tc_1", projectId: "default" },
				up: [],
				across: [],
				down: [],
				related: [],
				rawManifest: {
					agentRuns: [],
					actions: [],
					toolCalls: [
						{
							id: "tc_1",
							projectId: "default",
							actionId: "act_1",
							toolName: "stripe_capture_tc_1",
							toolVersion: "1.0",
							status: "ok",
							sideEffect: true,
							approvalState: "approved",
							startedAt: "2026-10-16T00:00:00.000Z",
							endedAt: "2026-10-16T00:00:00.025Z",
						},
					],
					retrievalEvents: [],
					evalResults: [],
					artifacts: [],
				},
			});
		}

		if (url.includes("/connected/")) {
			return jsonResponse({
				entity: { kind: "span", id: "t1:s1", projectId: "default" },
				up: [],
				across: [],
				down: [],
				related: [],
			});
		}

		if (url.includes("/projects")) {
			return jsonResponse({ projects: [] });
		}

		if (url.includes("/timeline")) {
			return jsonResponse({ events: [] });
		}

		if (url.includes("/resources")) {
			return jsonResponse({
				d1: {
					rowDensity: 0,
					eventsCount: 0,
					tracesCount: 0,
					logsCount: 0,
					aiCallsCount: 0,
				},
				r2: { replayChunksCount: 0, profilesCount: 0 },
				metricExemplars: [],
				timestamp: "2026-10-16T00:00:00.000Z",
			});
		}

		if (url.includes("/onboarding/counts")) {
			return jsonResponse({
				counts: {
					spans: 1,
					logs: 1,
					usageEvents: 1,
					identifiedUsers: 1,
					aiCalls: 1,
					replayChunks: 1,
					spansWithInteraction: 1,
				},
				collectorUrl: "http://localhost:8790",
			});
		}

		return jsonResponse({});
	};

	return { fetcher, requests };
}

function renderHref(
	href: string,
	options?: { renderPlayground?: () => React.ReactNode },
) {
	const { fetcher, requests } = createMockFetcher();
	const route = resolveDashboardRoute(href);
	const view = render(
		<ObsDashboardProvider basePath="/internal" fetcher={fetcher}>
			<DashboardRouteView
				route={route}
				renderPlayground={options?.renderPlayground}
			/>
		</ObsDashboardProvider>,
	);
	return { ...view, route, requests };
}

/**
 * View Coverage Inventory (RFC 0014 Workstream 2):
 * - Real-view selection tests under jsdom:
 *   `traces` (trace + span), `issues` (issueId), `alerts` (alertId),
 *   `logs` (logId), `usage` (usageId), `remediations` / `autonomous-review` (remediationId),
 *   `evaluations` (evaluationId), `ai` (aiCallId), `service-map` (service),
 *   `evidence` / `changes` / `findings` / `incidents` (anchor kind + id),
 *   `actions` (actionId), `agent-runs` (agentRunId), `tool-calls` (toolCallId),
 *   `profiles` (profileId + traceId), `replay` (sessionId), `users` (userId),
 *   `investigate` (investigationId).
 * - Dispatcher table coverage (views without detail entity selection):
 *   `health`, `projects`, `timeline`, `resources`, `onboarding`,
 *   `cost-attribution`, `tool-reliability`, `agent-version-diff`, `playground`.
 */
describe("DashboardRouteView end-to-end producer -> parser -> dispatcher -> real view selection", () => {
	it("expands both trace t1 and span s1 from canonical and legacy span links in TelemetryDashboard", async () => {
		for (const href of [
			hrefForEntity("span", "t1:s1"),
			"#/traces/t1#span=s1",
		]) {
			const parsed = parseDashboardRouteHash(href);
			expect(parsed.ok).toBe(true);
			const { container, unmount } = renderHref(href);

			await waitFor(() => {
				const spanBtn = container.querySelector(
					'[data-testid="trace-waterfall-span"][data-span-id="s1"]',
				);
				expect(spanBtn).not.toBeNull();
				expect(spanBtn?.getAttribute("aria-expanded")).toBe("true");
			});
			expect(screen.getByText("span_s1_attr")).toBeTruthy();
			unmount();
		}
	});

	it("selects issue iss_1 in TelemetryDashboard issues mode from #/issues?issue=iss_1", async () => {
		const href = dashboardRouteToHref({ tab: "issues", issueId: "iss_1" });
		expect(href).toBe("#/issues?issue=iss_1");
		renderHref(href);

		await waitFor(() => {
			expect(screen.getByText("Checkout timeout spike")).toBeTruthy();
			expect(screen.getByText("Deadline exceeded")).toBeTruthy();
		});
	});

	it("selects alert rule_1 in AlertsDashboard from #/alerts?id=rule_1", async () => {
		const href = hrefForEntity("alert", "rule_1");
		expect(href).toBe("#/alerts?id=rule_1");
		const { container } = renderHref(href);

		await waitFor(() => {
			const detail = container.querySelector(
				'[data-selected-alert-id="rule_1"]',
			);
			expect(detail).not.toBeNull();
		});
		expect(
			screen.getAllByText("Checkout High Error Rate").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("selects log_1 in LogsDashboard from #/logs?id=log_1", async () => {
		const href = hrefForEntity("log", "log_1");
		expect(href).toBe("#/logs?id=log_1");
		const { container } = renderHref(href);

		await waitFor(() => {
			const drawer = container.querySelector('[data-selected-log-id="log_1"]');
			expect(drawer).not.toBeNull();
		});
		expect(screen.getByText(/insufficient_funds/)).toBeTruthy();
	});

	it("focuses usage event ev_1 in UsageDashboard from #/usage?id=ev_1", async () => {
		const href = hrefForEntity("usage", "ev_1");
		expect(href).toBe("#/usage?id=ev_1");
		const { container } = renderHref(href);

		await waitFor(() => {
			const banner = container.querySelector('[data-selected-usage-id="ev_1"]');
			expect(banner).not.toBeNull();
		});
		expect(screen.getAllByText(/Cannot read cart item/).length).toBeGreaterThan(
			0,
		);
	});

	it("selects remediation proposal rem_1 in AutonomousReviewDashboard from #/remediations/rem_1", async () => {
		const href = hashRoutes.remediation("rem_1");
		expect(href).toBe("#/remediations/rem_1");
		const { container } = renderHref(href);

		await waitFor(() => {
			const card = container.querySelector(
				'[data-remediation-id="rem_1"][data-selected="true"]',
			);
			expect(card).not.toBeNull();
		});
	});

	it("selects evaluation case ec_1 in EvaluationsDashboard from canonical and legacy case links", async () => {
		for (const href of [
			hrefForEntity("eval", "ec_1"),
			"#/evaluations?case=ec_1",
		]) {
			const { unmount } = renderHref(href);

			await waitFor(() => {
				expect(
					screen.getByText("Order succeeds without double charge"),
				).toBeTruthy();
			});
			unmount();
		}
	});

	it("selects AI call call_1 in AIDashboard from canonical #/ai/calls/call_1 and legacy #/ai?id=call_1", async () => {
		for (const href of [hrefForEntity("ai_call", "call_1"), "#/ai?id=call_1"]) {
			const { unmount } = renderHref(href);

			await waitFor(() => {
				expect(screen.getByText(/Sure, checking your cart/)).toBeTruthy();
			});
			unmount();
		}
	});

	it("focuses service checkout in ServiceMapDashboard from #/service-map?service=checkout", async () => {
		const href = hrefForEntity("service", "checkout");
		expect(href).toBe("#/service-map?service=checkout");
		renderHref(href);

		await waitFor(() => {
			const chip = screen.getByTestId("service-focus-chip");
			expect(chip.textContent).toContain("Showing checkout");
		});
	});

	it("loads action, agent-run, tool-call, profile, user, replay, and investigation detail views", async () => {
		const actionView = renderHref(hrefForEntity("action", "act_1"));
		await waitFor(() => {
			expect(screen.getAllByText("charge_card_act_1").length).toBeGreaterThan(
				0,
			);
		});
		actionView.unmount();

		const runView = renderHref(hrefForEntity("agent_run", "run_1"));
		await waitFor(() => {
			expect(screen.getAllByText(/root_run_1_workflow/).length).toBeGreaterThan(
				0,
			);
		});
		runView.unmount();

		const toolView = renderHref(hrefForEntity("tool_call", "tc_1"));
		await waitFor(() => {
			expect(screen.getAllByText(/stripe_capture_tc_1/).length).toBeGreaterThan(
				0,
			);
		});
		toolView.unmount();

		const profileView = renderHref(
			hrefForEntity("profile", "prof_1", { traceId: "t1" }),
		);
		await waitFor(() => {
			const urls = profileView.requests.map((r) => r.url);
			expect(urls).toContain("/internal/profiles/prof_1");
			expect(urls).toContain("/internal/connected/profile/prof_1");
		});
		profileView.unmount();

		const userView = renderHref(
			dashboardRouteToHref({ tab: "users", userId: "usr_1" }),
		);
		await waitFor(() => {
			expect(screen.getAllByText("Alice Operator").length).toBeGreaterThan(0);
		});
		userView.unmount();

		const replayView = renderHref(hrefForEntity("session", "sess_1"));
		await waitFor(() => {
			expect(screen.getAllByText(/sess_1/).length).toBeGreaterThan(0);
		});
		replayView.unmount();

		const invView = renderHref(
			dashboardRouteToHref({
				tab: "investigate",
				investigationId: "error_top_offenders",
			}),
		);
		await waitFor(() => {
			expect(
				screen.getByText("Error Top Offenders Investigation"),
			).toBeTruthy();
		});
		invView.unmount();
	});

	it("loads anchor bundles in EvidenceDashboard for changes, findings, incidents, and unknown entity kinds", async () => {
		const cases = [
			{
				href: hashRoutes.change("chg_1"),
				kind: "change",
				id: "chg_1",
			},
			{
				href: hashRoutes.finding("fnd_1"),
				kind: "finding",
				id: "fnd_1",
			},
			{
				href: hashRoutes.incident("inc_1"),
				kind: "incident",
				id: "inc_1",
			},
			{
				href: dashboardRouteToHref({
					tab: "evidence",
					evidenceKind: "incident",
					evidenceId: "inc_2",
				}),
				kind: "incident",
				id: "inc_2",
			},
			{
				href: hrefForEntity("runbook_doc", "doc_9"),
				kind: "runbook_doc",
				id: "doc_9",
			},
		];

		for (const c of cases) {
			const { container, unmount } = renderHref(c.href);

			await waitFor(() => {
				const explorer = container.querySelector(
					`[data-anchor-kind="${c.kind}"][data-anchor-id="${c.id}"]`,
				);
				expect(explorer).not.toBeNull();
				expect(
					screen.getByText(`Loaded bundle for ${c.kind}:${c.id}`),
				).toBeTruthy();
			});
			unmount();
		}
	});

	it("renders the host-supplied Playground slot for #/playground and falls back to HealthDashboard on unknown routes", async () => {
		const playground = renderHref("#/playground", {
			renderPlayground: () => (
				<div data-testid="host-playground">Custom Host Playground</div>
			),
		});
		expect(screen.getByTestId("host-playground").textContent).toBe(
			"Custom Host Playground",
		);
		playground.unmount();

		const fallback = renderHref("#/not-a-valid-tab");
		expect(fallback.route).toEqual({ tab: "health" });
		fallback.unmount();
	});

	it("dispatches all 30 KNOWN_TABS end-to-end without error boundary crashes", () => {
		const tableRoutes: DashboardRoute[] = [
			{ tab: "health" },
			{ tab: "projects" },
			{ tab: "traces", traceId: "t1", spanId: "s1" },
			{ tab: "issues", issueId: "iss_1" },
			{ tab: "logs", logId: "log_1" },
			{ tab: "usage", usageId: "ev_1" },
			{ tab: "ai", aiCallId: "call_1" },
			{ tab: "evaluations", evaluationId: "ec_1" },
			{ tab: "replay", sessionId: "sess_1" },
			{ tab: "profiles", profileId: "prof_1", traceId: "t1" },
			{ tab: "alerts", alertId: "rule_1" },
			{ tab: "service-map", service: "checkout" },
			{ tab: "timeline" },
			{ tab: "resources" },
			{ tab: "onboarding" },
			{ tab: "playground" },
			{ tab: "investigate", investigationId: "error_top_offenders" },
			{ tab: "users", userId: "usr_1" },
			{ tab: "actions", actionId: "act_1" },
			{ tab: "agent-runs", agentRunId: "run_1" },
			{ tab: "tool-calls", toolCallId: "tc_1" },
			{ tab: "cost-attribution" },
			{ tab: "tool-reliability" },
			{ tab: "agent-version-diff" },
			{ tab: "autonomous-review", remediationId: "rem_1" },
			{ tab: "remediations", remediationId: "rem_1" },
			{ tab: "evidence", evidenceKind: "incident", evidenceId: "inc_1" },
			{ tab: "changes", changeId: "chg_1" },
			{ tab: "findings", findingId: "fnd_1" },
			{ tab: "incidents", incidentId: "inc_1" },
		];

		expect(new Set(tableRoutes.map((r) => r.tab))).toEqual(new Set(KNOWN_TABS));

		for (const route of tableRoutes) {
			const href = dashboardRouteToHref(route);
			const parsed = parseDashboardRouteHash(href);
			expect(parsed.ok).toBe(true);
			const view = renderHref(href, {
				renderPlayground: () => <div>Playground Slot</div>,
			});
			expect(view.container.textContent).not.toContain(
				"Dashboard render failed",
			);
			view.unmount();
		}
	});
});
