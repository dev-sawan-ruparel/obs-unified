import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CollectorClient, readConfig, registerTools } from "./index";

const ORIGINAL_ENV = { ...process.env };

describe("mcp-server configuration & auth contract", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		delete process.env.OBS_COLLECTOR_URL;
		delete process.env.OBS_DASHBOARD_TOKEN;
		delete process.env.OBS_INGEST_KEY;
		delete process.env.OBS_SESSION_COOKIE;
		delete process.env.OBS_PROJECT_ID;
		delete process.env.OBS_DASHBOARD_URL;
		delete process.env.OBS_MCP_TIMEOUT_MS;
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	describe("readConfig()", () => {
		it("throws when OBS_COLLECTOR_URL is missing", () => {
			process.env.OBS_DASHBOARD_TOKEN = "test-token";
			expect(() => readConfig()).toThrow(/OBS_COLLECTOR_URL is required/);
		});

		it("configures Authorization: Bearer header when OBS_DASHBOARD_TOKEN is set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790/";
			process.env.OBS_DASHBOARD_TOKEN = "my-secret-admin-token";

			const config = readConfig();
			expect(config.baseUrl).toBe("http://localhost:8790");
			expect(config.authHeaders).toEqual({
				Accept: "application/json",
				Authorization: "Bearer my-secret-admin-token",
			});
			expect(config.projectId).toBeUndefined();
			expect(config.timeoutMs).toBe(30_000);
		});

		it("configures Cookie header when OBS_SESSION_COOKIE is set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_SESSION_COOKIE = "payload.signature";

			const config = readConfig();
			expect(config.authHeaders).toEqual({
				Accept: "application/json",
				Cookie: "obs_session=payload.signature",
			});

			// If already prefixed with obs_session=
			process.env.OBS_SESSION_COOKIE = "obs_session=already-prefixed";
			const config2 = readConfig();
			expect(config2.authHeaders.Cookie).toBe("obs_session=already-prefixed");
		});

		it("prefers OBS_DASHBOARD_TOKEN over OBS_SESSION_COOKIE if both are set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_DASHBOARD_TOKEN = "my-secret-admin-token";
			process.env.OBS_SESSION_COOKIE = "obs_session=my-session";

			const config = readConfig();
			expect(config.authHeaders.Authorization).toBe(
				"Bearer my-secret-admin-token",
			);
			expect(config.authHeaders.Cookie).toBeUndefined();
		});

		it("explicitly rejects OBS_INGEST_KEY with a clear write-only explanation", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_INGEST_KEY = "obs_ingest_write_only_key";

			expect(() => readConfig()).toThrow(
				/OBS_INGEST_KEY is a write-only ingest key and cannot be used for collector read access/i,
			);
		});

		it("throws when no read auth credential is provided", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";

			expect(() => readConfig()).toThrow(
				/Set OBS_DASHBOARD_TOKEN or OBS_SESSION_COOKIE for collector read access/i,
			);
		});

		it("parses optional variables: OBS_PROJECT_ID, OBS_DASHBOARD_URL, OBS_MCP_TIMEOUT_MS", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_DASHBOARD_TOKEN = "my-token";
			process.env.OBS_PROJECT_ID = "finance-prod";
			process.env.OBS_DASHBOARD_URL = "https://dashboard.example.com/";
			process.env.OBS_MCP_TIMEOUT_MS = "45000";

			const config = readConfig();
			expect(config.projectId).toBe("finance-prod");
			expect(config.dashboardUrl).toBe("https://dashboard.example.com");
			expect(config.timeoutMs).toBe(45_000);
		});
	});

	describe("CollectorClient end-to-end integration", () => {
		const TEST_TOKEN = "test-mcp-bearer-token-123";

		it("authenticates against collector using Bearer OBS_DASHBOARD_TOKEN and forwards X-Project-Id", async () => {
			const requestsReceived: Array<{
				path: string;
				headers: Record<string, string>;
			}> = [];

			// Mock fetch for client
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (
				input: RequestInfo | URL,
				init?: RequestInit,
			) => {
				const url = String(input);
				const headers: Record<string, string> = {};
				if (init?.headers) {
					const h = init.headers as Record<string, string>;
					for (const [k, v] of Object.entries(h)) {
						headers[k.toLowerCase()] = v;
					}
				}
				requestsReceived.push({ path: url, headers });

				// Verify bearer token received
				if (headers.authorization !== `Bearer ${TEST_TOKEN}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), {
						status: 401,
						headers: { "Content-Type": "application/json" },
					});
				}

				return new Response(
					JSON.stringify({
						ok: true,
						project: headers["x-project-id"] || "default",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			}) as typeof fetch;

			try {
				process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
				process.env.OBS_DASHBOARD_TOKEN = TEST_TOKEN;
				process.env.OBS_PROJECT_ID = "payments";

				const config = readConfig();
				const client = new CollectorClient(config);

				const result = await client.get<{ ok: boolean; project: string }>(
					"/internal/telemetry/overview",
					{ hours: 24 },
				);

				expect(result).toEqual({ ok: true, project: "payments" });
				expect(requestsReceived.length).toBe(1);
				expect(requestsReceived[0].path).toBe(
					"http://localhost:8790/internal/telemetry/overview?hours=24",
				);
				expect(requestsReceived[0].headers.authorization).toBe(
					`Bearer ${TEST_TOKEN}`,
				);
				expect(requestsReceived[0].headers["x-project-id"]).toBe("payments");
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("throws descriptive error when collector rejects with 401", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					statusText: "Unauthorized",
					headers: { "Content-Type": "application/json" },
				});
			}) as typeof fetch;

			try {
				process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
				process.env.OBS_DASHBOARD_TOKEN = "wrong-token";

				const config = readConfig();
				const client = new CollectorClient(config);

				await expect(
					client.get("/internal/telemetry/overview"),
				).rejects.toThrow(/Collector request failed: 401/i);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});

	describe("AutoSRE MCP tools (RFC 0013 Goal 4.1)", () => {
		interface CapturedTool {
			description: string;
			inputSchema: Record<string, z.ZodTypeAny>;
			handler: (args: Record<string, unknown>) => Promise<{
				isError?: boolean;
				content: Array<{ type: "text"; text: string }>;
			}>;
		}

		function setupTools(
			responder: (req: {
				method: string;
				url: URL;
				body: unknown;
			}) => unknown | Promise<unknown>,
		) {
			const calls: Array<{ method: string; url: URL; body: unknown }> = [];
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (
				input: RequestInfo | URL,
				init?: RequestInit,
			) => {
				const url = new URL(String(input));
				const method = (init?.method ?? "GET").toUpperCase();
				const body =
					typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
				const call = { method, url, body };
				calls.push(call);
				const out = await responder(call);
				return new Response(JSON.stringify(out), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}) as typeof fetch;

			const client = new CollectorClient({
				baseUrl: "http://localhost:8790",
				authHeaders: {
					Accept: "application/json",
					Authorization: "Bearer test-token",
				},
				dashboardUrl: "https://dashboard.example.com",
				timeoutMs: 5000,
			});

			const server = new McpServer({ name: "obs-unified", version: "1.0.0" });
			const tools = new Map<string, CapturedTool>();
			const origRegister = server.registerTool.bind(server);
			server.registerTool = ((
				name: string,
				config: {
					description: string;
					inputSchema: Record<string, z.ZodTypeAny>;
				},
				handler: CapturedTool["handler"],
			) => {
				tools.set(name, {
					description: config.description,
					inputSchema: config.inputSchema,
					handler,
				});
				return origRegister(
					name,
					config as Parameters<typeof origRegister>[1],
					handler as Parameters<typeof origRegister>[2],
				);
			}) as typeof server.registerTool;

			registerTools(server, client);

			const invoke = async (name: string, rawArgs: Record<string, unknown>) => {
				const tool = tools.get(name);
				if (!tool) throw new Error(`Tool ${name} not registered`);
				const parsed = z.object(tool.inputSchema).parse(rawArgs);
				const res = await tool.handler(parsed);
				return {
					raw: res,
					json: res.isError ? null : JSON.parse(res.content[0].text),
				};
			};

			return {
				tools,
				calls,
				invoke,
				restore: () => {
					globalThis.fetch = originalFetch;
				},
			};
		}

		it("extends connected_signals kind enum and get_evidence_bundle with change, finding, and incident", async () => {
			const h = setupTools(({ url, body }) => ({
				path: url.pathname,
				body,
			}));
			try {
				for (const kind of ["change", "finding", "incident"] as const) {
					const res = await h.invoke("connected_signals", {
						kind,
						id: `${kind}_123`,
					});
					expect(res.raw.isError).toBeUndefined();
					expect(res.json.data.path).toBe(
						`/internal/connected/${kind}/${kind}_123`,
					);
				}

				const bundleRes = await h.invoke("get_evidence_bundle", {
					anchor: { entityKind: "incident", entityId: "inc_42" },
					intent: "triage_incident",
				});
				expect(bundleRes.raw.isError).toBeUndefined();
				expect(bundleRes.json.data.path).toBe("/internal/evidence/bundle");
				expect(bundleRes.json.data.body).toMatchObject({
					anchor: { entityKind: "incident", entityId: "inc_42" },
					intent: "triage_incident",
				});
			} finally {
				h.restore();
			}
		});

		it("list_recent_changes queries GET /internal/changes with default limit 20", async () => {
			const h = setupTools(() => ({
				changes: [{ id: "chg_1", kind: "deploy", serviceName: "checkout" }],
			}));
			try {
				const res = await h.invoke("list_recent_changes", {
					environment: "prod",
					serviceName: "checkout",
					kind: "deploy",
				});
				expect(h.calls).toHaveLength(1);
				expect(h.calls[0].method).toBe("GET");
				expect(h.calls[0].url.pathname).toBe("/internal/changes");
				expect(h.calls[0].url.searchParams.get("environment")).toBe("prod");
				expect(h.calls[0].url.searchParams.get("serviceName")).toBe("checkout");
				expect(h.calls[0].url.searchParams.get("kind")).toBe("deploy");
				expect(h.calls[0].url.searchParams.get("limit")).toBe("20");
				expect(res.json.changes).toHaveLength(1);
				expect(res.json.data.changes[0].id).toBe("chg_1");
			} finally {
				h.restore();
			}
		});

		it("get_change_blast_radius queries GET /internal/changes/:changeId/blast-radius", async () => {
			const h = setupTools(() => ({
				cohortVerdict: "isolated_to_new_version",
				causalProofTier: "cohort_rate_isolated",
				rateDifference: 0.14,
				overlappingCodePaths: ["src/checkout/payment.ts"],
			}));
			try {
				const res = await h.invoke("get_change_blast_radius", {
					changeId: "chg_payment_241",
					environment: "prod",
					minSample: 25,
				});
				expect(h.calls).toHaveLength(1);
				expect(h.calls[0].method).toBe("GET");
				expect(h.calls[0].url.pathname).toBe(
					"/internal/changes/chg_payment_241/blast-radius",
				);
				expect(h.calls[0].url.searchParams.get("environment")).toBe("prod");
				expect(h.calls[0].url.searchParams.get("minSample")).toBe("25");
				expect(res.json.cohortVerdict).toBe("isolated_to_new_version");
				expect(res.json.data.overlappingCodePaths).toEqual([
					"src/checkout/payment.ts",
				]);
			} finally {
				h.restore();
			}
		});

		it("search_similar_findings queries GET /internal/findings", async () => {
			const h = setupTools(() => ({
				findings: [
					{
						id: "fnd_1",
						fingerprint: "fp_abc",
						causalVerificationStatus: "counterfactual_verified",
					},
				],
			}));
			try {
				const res = await h.invoke("search_similar_findings", {
					environment: "prod",
					fingerprint: "fp_abc",
					causalVerificationStatus: "counterfactual_verified",
				});
				expect(h.calls).toHaveLength(1);
				expect(h.calls[0].method).toBe("GET");
				expect(h.calls[0].url.pathname).toBe("/internal/findings");
				expect(h.calls[0].url.searchParams.get("fingerprint")).toBe("fp_abc");
				expect(
					h.calls[0].url.searchParams.get("causalVerificationStatus"),
				).toBe("counterfactual_verified");
				expect(h.calls[0].url.searchParams.get("limit")).toBe("20");
				expect(res.json.findings[0].id).toBe("fnd_1");
			} finally {
				h.restore();
			}
		});

		it("record_investigation_finding posts finding and chains counterfactual verification when provided", async () => {
			const h = setupTools(({ url }) => {
				if (url.pathname === "/internal/findings") {
					return {
						id: "fnd_99",
						title: "Null pointer in checkout",
						causalVerificationStatus: "unverified",
					};
				}
				return {
					id: "fnd_99",
					title: "Null pointer in checkout",
					causalVerificationStatus: "counterfactual_verified",
					counterfactualProof: {
						evalCaseId: "eval_1",
						failingRunId: "run_fail",
						passingRunIds: ["run_pass_1", "run_pass_2", "run_pass_3"],
					},
				};
			});
			try {
				const res = await h.invoke("record_investigation_finding", {
					environment: "prod",
					incidentId: "inc_1",
					title: "Null pointer in checkout",
					summary: "Deploy v2.4.1 introduced null deref",
					causalProofTier: "counterfactual_verified",
					confidence: 0.95,
					symptomEntityKind: "trace",
					symptomEntityId: "tr_1",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp_1",
					rootCauseEntityKind: "change",
					rootCauseEntityId: "chg_241",
					contributingChangeId: "chg_241",
					causalChain: [
						{
							subjectKind: "span",
							subjectId: "sp_1",
							predicate: "degraded_after_change",
							objectKind: "change",
							objectId: "chg_241",
						},
					],
					citedEvidenceIds: ["ev_1"],
					counterfactual: {
						evalCaseId: "eval_1",
						failingRunId: "run_fail",
						passingRunIds: ["run_pass_1", "run_pass_2", "run_pass_3"],
						requiredTrials: 3,
					},
				});

				expect(h.calls).toHaveLength(2);
				expect(h.calls[0].method).toBe("POST");
				expect(h.calls[0].url.pathname).toBe("/internal/findings");
				expect(
					(h.calls[0].body as Record<string, unknown>).counterfactual,
				).toBeUndefined();
				expect(h.calls[1].method).toBe("POST");
				expect(h.calls[1].url.pathname).toBe(
					"/internal/findings/fnd_99/counterfactual",
				);
				expect(h.calls[1].body).toEqual({
					evalCaseId: "eval_1",
					failingRunId: "run_fail",
					passingRunIds: ["run_pass_1", "run_pass_2", "run_pass_3"],
					requiredTrials: 3,
				});
				expect(res.json.causalVerificationStatus).toBe(
					"counterfactual_verified",
				);
			} finally {
				h.restore();
			}
		});

		it("propose_remediation_action posts to /internal/remediations/propose", async () => {
			const h = setupTools(() => ({
				id: "prop_1",
				status: "grant_issued",
				effectiveAutonomy: "autonomous_write",
				grantToken: "grant_secret_token",
			}));
			try {
				const res = await h.invoke("propose_remediation_action", {
					environment: "prod",
					incidentId: "inc_1",
					findingId: "fnd_99",
					idempotencyKey: "idem_1",
					actionKind: "rollback_deploy",
					targetNodeId: "service:prod:default:checkout",
					expectedCurrentState: { version: "2.4.1" },
					desiredTargetState: { version: "2.4.0" },
					requestedAutonomy: "autonomous_write",
				});
				expect(h.calls).toHaveLength(1);
				expect(h.calls[0].method).toBe("POST");
				expect(h.calls[0].url.pathname).toBe("/internal/remediations/propose");
				expect(res.json.grantToken).toBe("grant_secret_token");
				expect(res.json.effectiveAutonomy).toBe("autonomous_write");
			} finally {
				h.restore();
			}
		});

		it("claim_remediation_grant supports claim, complete, and fail operations", async () => {
			const h = setupTools(({ url, body }) => ({
				path: url.pathname,
				body,
				status: url.pathname.endsWith("/complete")
					? "completed"
					: "claimed_executing",
			}));
			try {
				// Missing grantToken on claim returns tool error
				const errRes = await h.invoke("claim_remediation_grant", {
					proposalId: "prop_1",
					operation: "claim",
				});
				expect(errRes.raw.isError).toBe(true);
				expect(errRes.raw.content[0].text).toMatch(/grantToken is required/i);

				const claimRes = await h.invoke("claim_remediation_grant", {
					proposalId: "prop_1",
					operation: "claim",
					grantToken: "grant_secret_token",
					runnerId: "runner_1",
				});
				expect(claimRes.raw.isError).toBeUndefined();
				expect(claimRes.json.path).toBe("/internal/remediations/prop_1/claim");

				const completeRes = await h.invoke("claim_remediation_grant", {
					proposalId: "prop_1",
					operation: "complete",
					resultingChangeId: "chg_rollback_240",
					remediationAgentRunId: "run_rem_1",
				});
				expect(completeRes.raw.isError).toBeUndefined();
				expect(completeRes.json.path).toBe(
					"/internal/remediations/prop_1/complete",
				);
				expect(completeRes.json.status).toBe("completed");
			} finally {
				h.restore();
			}
		});
	});
});
