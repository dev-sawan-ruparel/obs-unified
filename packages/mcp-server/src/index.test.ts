import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContractMismatchError } from "@obsunified/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CollectorClient, readConfig, registerTools } from "./index";

const ORIGINAL_ENV = { ...process.env };

describe("mcp-server configuration & auth contract", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		delete process.env.OBS_COLLECTOR_URL;
		delete process.env.OBS_DASHBOARD_TOKEN;
		delete process.env.OBS_API_TOKEN;
		delete process.env.OBS_MCP_ENABLE_WRITES;
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

		it("accepts OBS_API_TOKEN as an alias, with OBS_DASHBOARD_TOKEN winning", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_API_TOKEN = "alias-token";
			expect(readConfig().authHeaders.Authorization).toBe("Bearer alias-token");
			process.env.OBS_DASHBOARD_TOKEN = "dash-token";
			expect(readConfig().authHeaders.Authorization).toBe("Bearer dash-token");
		});

		it("throws when no read auth credential is provided", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";

			expect(() => readConfig()).toThrow(
				/Set OBS_DASHBOARD_TOKEN .* or OBS_SESSION_COOKIE for collector read access/i,
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
		const WRITE_TOOLS = [
			"record_investigation_finding",
			"propose_remediation_action",
			"claim_remediation_grant",
			"open_incident",
		];
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
			writes = true,
		) {
			process.env.OBS_MCP_ENABLE_WRITES = writes ? "true" : "";
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
				const forced =
					out && typeof out === "object" && "__status" in out
						? (out as { __status: number; body: unknown })
						: null;
				return new Response(JSON.stringify(forced ? forced.body : out), {
					status: forced ? forced.__status : 200,
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

		it("emits dashboardUrl values that match real dashboard routes", async () => {
			const h = setupTools(({ url }) => ({ path: url.pathname }));
			try {
				const ref = await h.invoke("retrieve_evidence_ref", { refId: "ref 1" });
				expect(ref.json.dashboardUrl).toBe(
					"https://dashboard.example.com/#/evidence",
				);
				const search = await h.invoke("search_evidence_ref", {
					refId: "ref 1",
					query: "oom",
				});
				expect(search.json.dashboardUrl).toBe(
					"https://dashboard.example.com/#/evidence",
				);
				const svc = await h.invoke("service_operations", {
					service: "checkout api",
				});
				expect(svc.json.dashboardUrl).toBe(
					"https://dashboard.example.com/#/service-map?service=checkout%20api",
				);
				const ev = await h.invoke("get_eval", { evaluationId: "case/1" });
				expect(ev.json.dashboardUrl).toBe(
					"https://dashboard.example.com/#/evaluations/case%2F1",
				);
			} finally {
				h.restore();
			}
		});

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

		it("does not register write tools unless OBS_MCP_ENABLE_WRITES=true", () => {
			const off = setupTools(() => ({}), false);
			try {
				for (const name of WRITE_TOOLS) expect(off.tools.has(name)).toBe(false);
				expect(off.tools.has("list_recent_changes")).toBe(true);
			} finally {
				off.restore();
			}
			const on = setupTools(() => ({}), true);
			try {
				for (const name of WRITE_TOOLS) expect(on.tools.has(name)).toBe(true);
			} finally {
				on.restore();
			}
		});

		it("validates enum inputs for write tools and bundle intent", async () => {
			const h = setupTools(() => ({}));
			try {
				const finding = z.object(
					h.tools.get("record_investigation_finding")?.inputSchema ?? {},
				);
				const base = {
					title: "t",
					summary: "s",
					symptomEntityKind: "trace",
					symptomEntityId: "tr",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp",
					causalChain: [],
					citedEvidenceIds: [],
				};
				expect(finding.safeParse(base).success).toBe(true);
				expect(
					finding.safeParse({ ...base, cohortVerdict: "bogus" }).success,
				).toBe(false);
				expect(
					finding.safeParse({
						...base,
						causalChain: [
							{
								subjectKind: "span",
								subjectId: "a",
								predicate: "not_a_predicate",
								objectKind: "change",
								objectId: "b",
							},
						],
					}).success,
				).toBe(false);
				const propose = z.object(
					h.tools.get("propose_remediation_action")?.inputSchema ?? {},
				);
				expect(
					propose.safeParse({
						incidentId: "i",
						findingId: "f",
						idempotencyKey: "k",
						actionKind: "drop_database",
						targetNodeId: "n",
						expectedCurrentState: {},
						desiredTargetState: {},
					}).success,
				).toBe(false);
				const bundle = z.object(
					h.tools.get("get_evidence_bundle")?.inputSchema ?? {},
				);
				expect(
					bundle.safeParse({
						anchor: { entityKind: "trace", entityId: "t" },
						intent: "free_form",
					}).success,
				).toBe(false);
				const changes = z.object(
					h.tools.get("list_recent_changes")?.inputSchema ?? {},
				);
				expect(changes.safeParse({ kind: "prompt_change" }).success).toBe(
					false,
				);
				expect(changes.safeParse({ kind: "prompt_rollout" }).success).toBe(
					true,
				);
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
				expect(res.json.data.changes).toHaveLength(1);
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
				expect(res.json.data.cohortVerdict).toBe("isolated_to_new_version");
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
				expect(res.json.data.findings[0].id).toBe("fnd_1");
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
					codeReferences: [
						{
							relativePath: "src/checkout/payment.ts",
							symbolName: "chargeCard",
							lineNumber: 42,
						},
					],
					counterfactual: {
						evalCaseId: "eval_1",
						failingRunId: "run_fail",
						passingRunIds: ["run_pass_1", "run_pass_2", "run_pass_3"],
						requiredTrials: 3,
					},
				});

				// Prerequisite GETs for the failing run + three passing runs come first.
				const preflight = h.calls.filter((c) => c.method === "GET");
				expect(preflight.map((c) => c.url.pathname)).toEqual([
					"/internal/evals/runs/run_fail",
					"/internal/evals/runs/run_pass_1",
					"/internal/evals/runs/run_pass_2",
					"/internal/evals/runs/run_pass_3",
				]);
				const writes = h.calls.filter((c) => c.method === "POST");
				expect(writes).toHaveLength(2);
				h.calls.splice(0, h.calls.length, ...writes);
				expect(h.calls[0].method).toBe("POST");
				expect(h.calls[0].url.pathname).toBe("/internal/findings");
				expect(
					(h.calls[0].body as Record<string, unknown>).counterfactual,
				).toBeUndefined();
				expect(
					(h.calls[0].body as Record<string, unknown>).codeReferences,
				).toEqual([
					{
						relativePath: "src/checkout/payment.ts",
						symbolName: "chargeCard",
						lineNumber: 42,
					},
				]);
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
				expect(res.json.data.causalVerificationStatus).toBe(
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
				expect(res.json.data.grantToken).toBe("grant_secret_token");
				expect(res.json.data.effectiveAutonomy).toBe("autonomous_write");
			} finally {
				h.restore();
			}
		});

		it("record_investigation_finding checks eval runs before persisting and persists nothing when one is missing", async () => {
			const h = setupTools(({ url }) =>
				url.pathname.startsWith("/internal/evals/runs/")
					? { __status: 404, body: { error: "Eval run not found" } }
					: { id: "fnd_never" },
			);
			try {
				const res = await h.invoke("record_investigation_finding", {
					title: "t",
					summary: "s",
					symptomEntityKind: "trace",
					symptomEntityId: "t1",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp1",
					causalChain: [],
					citedEvidenceIds: [],
					counterfactual: {
						evalCaseId: "c",
						failingRunId: "missing_run",
						passingRunIds: [],
					},
				});
				expect(res.raw.isError).toBe(true);
				expect(res.raw.content[0].text).toContain("missing_run");
				expect(res.raw.content[0].text).toContain("no finding was recorded");
				expect(h.calls.every((c) => c.method === "GET")).toBe(true);
			} finally {
				h.restore();
			}
		});

		it("record_investigation_finding returns the persisted finding plus counterfactualError when verification fails after insert", async () => {
			const h = setupTools(({ url }) => {
				if (url.pathname === "/internal/findings") {
					return { finding: { id: "fnd_kept", title: "t" }, id: "fnd_kept" };
				}
				if (url.pathname.endsWith("/counterfactual")) {
					return { __status: 422, body: { error: "fingerprint mismatch" } };
				}
				return { run: { id: "ok" } };
			});
			try {
				const res = await h.invoke("record_investigation_finding", {
					idempotencyKey: "retry-key-1",
					title: "t",
					summary: "s",
					symptomEntityKind: "trace",
					symptomEntityId: "t1",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "sp1",
					causalChain: [],
					citedEvidenceIds: [],
					counterfactual: {
						evalCaseId: "c",
						failingRunId: "run_f",
						passingRunIds: ["run_p"],
					},
				});
				expect(res.raw.isError).toBeUndefined();
				expect(res.json.data.finding.id).toBe("fnd_kept");
				expect(res.json.data.counterfactualError).toContain("422");
				const post = h.calls.find(
					(c) => c.url.pathname === "/internal/findings",
				);
				expect((post?.body as Record<string, unknown>).idempotencyKey).toBe(
					"retry-key-1",
				);
			} finally {
				h.restore();
			}
		});

		it("propose_remediation_action forwards webhookUrl and maps webhookSecret to the collector's secret without echoing it", async () => {
			const h = setupTools(() => ({
				id: "prop_cb",
				status: "pending_human_approval",
			}));
			try {
				const res = await h.invoke("propose_remediation_action", {
					incidentId: "inc_1",
					findingId: "fnd_1",
					idempotencyKey: "idem_cb",
					actionKind: "rollback_deploy",
					targetNodeId: "service:prod:default:checkout",
					expectedCurrentState: {},
					desiredTargetState: {},
					webhookUrl: "https://runner.example.com/grants",
					webhookSecret: "s3cret",
				});
				expect(h.calls[0].body).toMatchObject({
					webhookUrl: "https://runner.example.com/grants",
					secret: "s3cret",
				});
				expect(
					(h.calls[0].body as Record<string, unknown>).webhookSecret,
				).toBeUndefined();
				expect(JSON.stringify(res.json.contract.params)).not.toContain(
					"s3cret",
				);
			} finally {
				h.restore();
			}
		});

		it("incident read tools are always registered and call the collector GET routes", async () => {
			const h = setupTools(
				() => ({ incidents: [], incident: { id: "inc_1" } }),
				false,
			);
			try {
				for (const name of [
					"list_incidents",
					"get_incident",
					"get_remediation_proposal",
				]) {
					expect(h.tools.has(name)).toBe(true);
				}
				await h.invoke("list_incidents", {
					environment: "prod",
					status: "open",
					limit: 5,
				});
				await h.invoke("get_incident", { id: "inc 1", environment: "prod" });
				await h.invoke("get_remediation_proposal", { id: "rem_1" });
				expect(
					h.calls.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`),
				).toEqual([
					"GET /internal/incidents?environment=prod&status=open&limit=5",
					"GET /internal/incidents/inc%201?environment=prod",
					"GET /internal/remediations/rem_1",
				]);
				await expect(
					h.invoke("list_incidents", { status: "bogus" }),
				).rejects.toThrow();
			} finally {
				h.restore();
			}
		});

		it("open_incident posts to /internal/incidents and surfaces deduplicated", async () => {
			const h = setupTools(() => ({
				incident: { id: "inc_9" },
				deduplicated: true,
			}));
			try {
				const res = await h.invoke("open_incident", {
					environment: "prod",
					targetNodeId: "service:prod:default:checkout",
					symptomCategory: "errors",
				});
				expect(h.calls[0].method).toBe("POST");
				expect(h.calls[0].url.pathname).toBe("/internal/incidents");
				expect(res.json.deduplicated).toBe(true);
				expect(res.json.data.incident.id).toBe("inc_9");
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
				expect(claimRes.json.data.path).toBe(
					"/internal/remediations/prop_1/claim",
				);

				const completeRes = await h.invoke("claim_remediation_grant", {
					proposalId: "prop_1",
					operation: "complete",
					resultingChangeId: "chg_rollback_240",
					remediationAgentRunId: "run_rem_1",
				});
				expect(completeRes.raw.isError).toBeUndefined();
				expect(completeRes.json.data.path).toBe(
					"/internal/remediations/prop_1/complete",
				);
				expect(completeRes.json.data.status).toBe("completed");
			} finally {
				h.restore();
			}
		});

		it("supports strict dashboardRouteLink alongside legacy dashboardLink and enforces negative route types", () => {
			const client = new CollectorClient({
				baseUrl: "http://localhost:8790",
				authHeaders: { Accept: "application/json" },
				dashboardUrl: "https://dashboard.example.com",
				timeoutMs: 5000,
			});

			expect(
				client.dashboardRouteLink({
					tab: "evaluations",
					evaluationId: "ec_1",
				}),
			).toBe("https://dashboard.example.com/#/evaluations/ec_1");
			expect(
				client.dashboardRouteLink({
					tab: "service-map",
					service: "checkout api",
				}),
			).toBe(
				"https://dashboard.example.com/#/service-map?service=checkout%20api",
			);
			expect(
				client.dashboardRouteLink({
					tab: "traces",
					traceId: "tr_1",
					spanId: "sp_1",
				}),
			).toBe("https://dashboard.example.com/#/traces?trace=tr_1&span=sp_1");

			// Negative type tests: unknown tabs and cross-route fields must fail.
			if (false as boolean) {
				// @ts-expect-error unsupported tab
				client.dashboardRouteLink({ tab: "evals" });
				// @ts-expect-error remediationId is not a service-map field
				client.dashboardRouteLink({
					tab: "service-map",
					remediationId: "rem_1",
				});
			}

			// Legacy consumers continue to compile and produce the same URL.
			expect(client.dashboardLink("evaluations/ec_1")).toBe(
				"https://dashboard.example.com/#/evaluations/ec_1",
			);

			const noDashboardClient = new CollectorClient({
				baseUrl: "http://localhost:8790",
				authHeaders: { Accept: "application/json" },
				timeoutMs: 5000,
			});
			expect(
				noDashboardClient.dashboardRouteLink({
					tab: "evaluations",
					evaluationId: "ec_1",
				}),
			).toBeUndefined();
			expect(
				noDashboardClient.dashboardLink("evaluations/ec_1"),
			).toBeUndefined();
		});

		it("validates responses via requestContract and raises ContractMismatchError on malformed bodies", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async () =>
				new Response(JSON.stringify({ incidents: "not-an-array" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				})) as typeof fetch;

			try {
				const client = new CollectorClient({
					baseUrl: "http://localhost:8790",
					authHeaders: {
						Accept: "application/json",
						Authorization: "Bearer test-token",
					},
					timeoutMs: 5000,
				});

				await expect(
					client.requestContract("GET /internal/incidents", {
						query: { environment: "prod" },
					}),
				).rejects.toBeInstanceOf(ContractMismatchError);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
