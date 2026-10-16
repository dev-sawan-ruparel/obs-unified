import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CausalVerificationStatusSchema,
	ChangeEventKindSchema,
	EVIDENCE_REFERENCE_SCHEMA_VERSION,
	EvidenceReferenceJsonSchema,
	TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION,
	type ToolResponseContract,
} from "@obsunified/types";
import { z } from "zod";
import { registerAutosreReadTools } from "./tools/autosre-reads";
import { registerAutosreWriteTools } from "./tools/autosre-writes";

type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface CollectorConfig {
	baseUrl: string;
	authHeaders: Record<string, string>;
	projectId?: string;
	dashboardUrl?: string;
	timeoutMs: number;
}

const positiveInt = (fallback: number, min = 1, max = 10_000) =>
	z.number().int().min(min).max(max).optional().default(fallback);
const nonNegativeInt = (fallback: number, max = 10_000) =>
	z.number().int().min(0).max(max).optional().default(fallback);

const hoursParam = positiveInt(24, 1, 24 * 365);
const limitParam = positiveInt(30, 1, 500);

function requireEnv(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required`);
	}
	return value;
}

/** Write tools are opt-in: they are only registered when OBS_MCP_ENABLE_WRITES=true. */
export function writesEnabled(): boolean {
	return process.env.OBS_MCP_ENABLE_WRITES?.trim().toLowerCase() === "true";
}

export function readConfig(): CollectorConfig {
	const baseUrl = requireEnv("OBS_COLLECTOR_URL").replace(/\/+$/, "");
	const dashboardToken =
		process.env.OBS_DASHBOARD_TOKEN?.trim() ||
		process.env.OBS_API_TOKEN?.trim();
	const ingestKey = process.env.OBS_INGEST_KEY?.trim();
	const sessionCookie = process.env.OBS_SESSION_COOKIE?.trim();
	const timeoutMs = Number.parseInt(process.env.OBS_MCP_TIMEOUT_MS ?? "", 10);

	const authHeaders: Record<string, string> = {
		Accept: "application/json",
	};
	if (dashboardToken) {
		authHeaders.Authorization = `Bearer ${dashboardToken}`;
	} else if (sessionCookie) {
		authHeaders.Cookie = sessionCookie.includes("obs_session=")
			? sessionCookie
			: `obs_session=${encodeURIComponent(sessionCookie)}`;
	} else if (ingestKey) {
		throw new Error(
			"OBS_INGEST_KEY is a write-only ingest key and cannot be used for collector read access. Set OBS_DASHBOARD_TOKEN or OBS_SESSION_COOKIE instead.",
		);
	} else {
		throw new Error(
			"Set OBS_DASHBOARD_TOKEN (alias OBS_API_TOKEN) or OBS_SESSION_COOKIE for collector read access",
		);
	}

	return {
		baseUrl,
		authHeaders,
		projectId: process.env.OBS_PROJECT_ID?.trim() || undefined,
		dashboardUrl:
			process.env.OBS_DASHBOARD_URL?.trim().replace(/\/+$/, "") || undefined,
		timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
	};
}

function buildPath(
	pathname: string,
	params: Record<string, string | number | boolean | undefined> = {},
): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") search.set(key, String(value));
	}
	const query = search.toString();
	return query ? `${pathname}?${query}` : pathname;
}

export class CollectorClient {
	constructor(private readonly config: CollectorConfig) {}

	private async request<T = JsonValue>(
		method: "GET" | "POST",
		pathname: string,
		options: {
			params?: Record<string, string | number | boolean | undefined>;
			body?: unknown;
		} = {},
	): Promise<T> {
		const path = buildPath(pathname, options.params);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const response = await fetch(`${this.config.baseUrl}${path}`, {
				method,
				headers: {
					...this.config.authHeaders,
					...(method === "POST" ? { "Content-Type": "application/json" } : {}),
					...(this.config.projectId
						? { "X-Project-Id": this.config.projectId }
						: {}),
				},
				body:
					options.body === undefined ? undefined : JSON.stringify(options.body),
				signal: controller.signal,
			});
			const text = await response.text();
			let body: unknown = text;
			if (text) {
				try {
					body = JSON.parse(text);
				} catch {
					body = text;
				}
			}

			if (!response.ok) {
				throw new Error(
					`Collector request failed: ${response.status} ${response.statusText} ${JSON.stringify(body).slice(0, 500)}`,
				);
			}

			return body as T;
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				throw new Error(
					`Collector request timed out after ${this.config.timeoutMs}ms`,
				);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	async get<T = JsonValue>(
		pathname: string,
		params?: Record<string, string | number | boolean | undefined>,
	): Promise<T> {
		return this.request<T>("GET", pathname, { params });
	}

	async post<T = JsonValue>(pathname: string, body: unknown): Promise<T> {
		return this.request<T>("POST", pathname, { body });
	}

	dashboardLink(fragment: string): string | undefined {
		if (!this.config.dashboardUrl) return undefined;
		return `${this.config.dashboardUrl}/#/${fragment.replace(/^#?\//, "")}`;
	}
}

function jsonToolResult(data: unknown, contract?: ToolResponseContract) {
	const payload =
		contract && data && typeof data === "object" && !Array.isArray(data)
			? { ...(data as Record<string, unknown>), contract }
			: contract
				? { result: data, contract }
				: data;
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(payload, null, 2),
			},
		],
	};
}

function toolResult(
	tool: string,
	params: Record<string, unknown>,
	returns: string,
	data: unknown,
) {
	return jsonToolResult(data, {
		schemaVersion: TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION,
		transport: "mcp",
		tool,
		params,
		returns,
		evidenceReferenceSchemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
		evidenceReferenceJsonSchema: EvidenceReferenceJsonSchema,
	});
}

function errorToolResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		isError: true,
		content: [
			{
				type: "text" as const,
				text: message,
			},
		],
	};
}

function registerTools(server: McpServer, client: CollectorClient): void {
	server.registerTool(
		"get_evidence_bundle",
		{
			description:
				"Return compact evidence for an anchor, investigation intent, and token budget.",
			inputSchema: {
				anchor: z.object({
					entityKind: z.enum([
						"trace",
						"action",
						"agent_run",
						"tool_call",
						"change",
						"finding",
						"incident",
					]),
					entityId: z.string().min(1),
				}),
				intent: z
					.enum([
						"debug_failure",
						"explain_latency",
						"explain_cost",
						"inspect_agent_run",
						"inspect_tool_call",
						"find_instrumentation_gap",
						"triage_incident",
						"general",
					])
					.optional(),
				budget: z
					.object({
						targetTokens: positiveInt(4000, 500, 30_000),
						detailLevel: z
							.enum(["brief", "standard", "deep"])
							.optional()
							.default("standard"),
					})
					.optional(),
				hours: positiveInt(24, 1, 720),
			},
		},
		async ({ anchor, intent, budget, hours }) => {
			try {
				const data = await client.post("/internal/evidence/bundle", {
					anchor,
					intent,
					budget,
					hours,
				});
				return toolResult(
					"get_evidence_bundle",
					{ anchor, intent, budget, hours },
					"{ data: EvidenceBundle, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`evidence?kind=${encodeURIComponent(anchor.entityKind)}&id=${encodeURIComponent(anchor.entityId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"retrieve_evidence_ref",
		{
			description:
				"Expand a retrieval reference into raw or less-compacted evidence records.",
			inputSchema: {
				refId: z.string().min(1),
				limit: positiveInt(100, 1, 1000),
				chunkOffset: nonNegativeInt(0, 1_000_000),
				severity: z
					.enum(["DEBUG", "INFO", "WARN", "ERROR", "FATAL"])
					.optional(),
			},
		},
		async ({ refId, limit, chunkOffset, severity }) => {
			try {
				const data = await client.get(
					`/internal/evidence/refs/${encodeURIComponent(refId)}`,
					{ limit, chunkOffset, severity },
				);
				return toolResult(
					"retrieve_evidence_ref",
					{ refId, limit, chunkOffset, severity },
					"{ data: EvidenceRetrievalRefExpansion, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`evidence/refs/${encodeURIComponent(refId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"search_evidence_ref",
		{
			description:
				"Search within a retrieval reference without expanding the full evidence slice.",
			inputSchema: {
				refId: z.string().min(1),
				query: z.string().min(1),
				limit: limitParam,
			},
		},
		async ({ refId, query, limit }) => {
			try {
				const data = await client.post(
					`/internal/evidence/refs/${encodeURIComponent(refId)}/search`,
					{ query, limit },
				);
				return toolResult(
					"search_evidence_ref",
					{ refId, query, limit },
					"{ data: EvidenceRetrievalRefSearchResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`evidence/refs/${encodeURIComponent(refId)}?q=${encodeURIComponent(query)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_evidence_stats",
		{
			description:
				"Return materialized evidence retrieval ref issue and expansion telemetry.",
			inputSchema: {
				limit: positiveInt(20, 1, 100),
			},
		},
		async ({ limit }) => {
			try {
				const data = await client.get("/internal/evidence/stats", { limit });
				return toolResult(
					"get_evidence_stats",
					{ limit },
					"{ data: EvidenceRetrievalStats, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("evidence"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"obs_status",
		{
			description:
				"Check collector read access and return a tiny recent telemetry sample.",
			inputSchema: {
				hours: hoursParam,
			},
		},
		async ({ hours }) => {
			try {
				const overview = await client.get("/internal/telemetry/overview", {
					hours,
					limit: 1,
				});
				return toolResult(
					"obs_status",
					{ hours },
					"{ ok: true, overview: TelemetryOverviewResponse }",
					{ ok: true, overview },
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"recent_traces",
		{
			description:
				"List recent traces, optionally filtered by service, status, or text query.",
			inputSchema: {
				hours: hoursParam,
				limit: limitParam,
				service: z.string().optional(),
				status: z.enum(["all", "ok", "error"]).optional().default("all"),
				query: z.string().optional(),
			},
		},
		async ({ hours, limit, service, status, query }) => {
			try {
				const data = await client.get("/internal/telemetry/overview", {
					hours,
					limit,
					service,
					status,
					q: query,
				});
				return toolResult(
					"recent_traces",
					{ hours, limit, service, status, query },
					"{ data: TelemetryOverviewResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("traces"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_trace",
		{
			description: "Fetch the full span tree for a trace id.",
			inputSchema: {
				traceId: z.string().min(1),
			},
		},
		async ({ traceId }) => {
			try {
				const data = await client.get(
					`/internal/telemetry/traces/${encodeURIComponent(traceId)}`,
				);
				return toolResult(
					"get_trace",
					{ traceId },
					"{ data: TelemetryTraceDetailResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`traces?trace=${encodeURIComponent(traceId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"service_operations",
		{
			description:
				"Get latency and request rollups for operations on a specific service.",
			inputSchema: {
				service: z.string().min(1),
				hours: hoursParam,
			},
		},
		async ({ service, hours }) => {
			try {
				const data = await client.get(
					`/internal/telemetry/services/${encodeURIComponent(service)}/operations`,
					{ hours },
				);
				return toolResult(
					"service_operations",
					{ service, hours },
					"{ data: ServiceOperationsResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`services?service=${encodeURIComponent(service)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"service_map",
		{
			description: "Get service-to-service edges for the selected time window.",
			inputSchema: {
				hours: hoursParam,
				source: z.enum(["all", "sdk", "ebpf"]).optional().default("all"),
			},
		},
		async ({ hours, source }) => {
			try {
				const data = await client.get("/internal/telemetry/service-map", {
					hours,
					source,
				});
				return toolResult(
					"service_map",
					{ hours, source },
					"{ data: ServiceMapResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("service-map"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"search_logs",
		{
			description:
				"Search recent structured logs by severity, service, trace id, or text.",
			inputSchema: {
				hours: hoursParam,
				limit: limitParam,
				service: z.string().optional(),
				severity: z.enum(["debug", "info", "warn", "error"]).optional(),
				traceId: z.string().optional(),
				search: z.string().optional(),
			},
		},
		async ({ hours, limit, service, severity, traceId, search }) => {
			try {
				const data = await client.get("/internal/logs/overview", {
					hours,
					limit,
					service,
					severity,
					traceId,
					search,
				});
				return toolResult(
					"search_logs",
					{ hours, limit, service, severity, traceId, search },
					"{ data: LogsOverviewResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("logs"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"ai_overview",
		{
			description: "List recent AI/LLM calls and cost/usage summaries.",
			inputSchema: {
				hours: hoursParam,
				limit: limitParam,
				provider: z.string().optional(),
				model: z.string().optional(),
			},
		},
		async ({ hours, limit, provider, model }) => {
			try {
				const data = await client.get("/internal/ai/overview", {
					hours,
					limit,
					provider,
					model,
				});
				return toolResult(
					"ai_overview",
					{ hours, limit, provider, model },
					"{ data: AICallsOverviewResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("ai"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_ai_session",
		{
			description: "Fetch the call sequence for a specific AI session.",
			inputSchema: {
				sessionId: z.string().min(1),
			},
		},
		async ({ sessionId }) => {
			try {
				const data = await client.get(
					`/internal/ai/sessions/${encodeURIComponent(sessionId)}`,
				);
				return toolResult(
					"get_ai_session",
					{ sessionId },
					"{ data: AISessionDetailResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`ai?session=${encodeURIComponent(sessionId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_user",
		{
			description: "Fetch a user profile and recent sessions.",
			inputSchema: {
				userId: z.string().min(1),
			},
		},
		async ({ userId }) => {
			try {
				const data = await client.get(
					`/internal/users/${encodeURIComponent(userId)}`,
				);
				return toolResult(
					"get_user",
					{ userId },
					"{ data: UserProfileDetail, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`users/${encodeURIComponent(userId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_replay",
		{
			description: "Fetch replay metadata and event stream for a session id.",
			inputSchema: {
				sessionId: z.string().min(1),
			},
		},
		async ({ sessionId }) => {
			try {
				const data = await client.get(
					`/internal/replays/${encodeURIComponent(sessionId)}`,
				);
				return toolResult(
					"get_replay",
					{ sessionId },
					"{ data: ReplayResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`replay?session=${encodeURIComponent(sessionId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_profile",
		{
			description:
				"Fetch pprof profile metadata, indexed trace ids, and frame summary for a profile id.",
			inputSchema: {
				profileId: z.string().min(1),
				traceId: z
					.string()
					.optional()
					.describe("Optionally scope frame summaries to one trace id."),
			},
		},
		async ({ profileId, traceId }) => {
			try {
				const data = await client.get(
					`/internal/profiles/${encodeURIComponent(profileId)}`,
					{ trace_id: traceId },
				);
				return toolResult(
					"get_profile",
					{ profileId, traceId },
					"{ data: ProfileDetailResponse, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`profiles/${encodeURIComponent(profileId)}${
								traceId ? `?trace_id=${encodeURIComponent(traceId)}` : ""
							}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_eval",
		{
			description:
				"Fetch one AI evaluation by id, including evidence references back to its trace/span.",
			inputSchema: {
				evaluationId: z.string().min(1),
			},
		},
		async ({ evaluationId }) => {
			try {
				const data = await client.get(
					`/internal/ai/evaluations/${encodeURIComponent(evaluationId)}`,
				);
				return toolResult(
					"get_eval",
					{ evaluationId },
					"{ data: { evaluation: AIEvaluationRecord, timestamp: string }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`evals/${encodeURIComponent(evaluationId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"connected_signals",
		{
			description:
				"Pivot from one entity to related traces, logs, AI calls, users, replays, profiles, actions, agent runs, tool calls, changes, findings, and incidents.",
			inputSchema: {
				kind: z.enum([
					"span",
					"profile",
					"log",
					"usage",
					"ai_call",
					"replay",
					"alert",
					"analysis",
					"user",
					"action",
					"agent_run",
					"tool_call",
					"change",
					"finding",
					"incident",
				]),
				id: z
					.string()
					.min(1)
					.describe(
						"For span, use '<traceId>:<spanId>'; otherwise use the entity id.",
					),
			},
		},
		async ({ kind, id }) => {
			try {
				const data = await client.get(
					`/internal/connected/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
				);
				return toolResult(
					"connected_signals",
					{ kind, id },
					"{ data: ConnectedSignalManifest }",
					{ data },
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_agent_run",
		{
			description:
				"Fetch an Agent Action Graph run with its connected manifest.",
			inputSchema: {
				agentRunId: z.string().min(1),
			},
		},
		async ({ agentRunId }) => {
			try {
				const data = await client.get(
					`/internal/agent-runs/${encodeURIComponent(agentRunId)}`,
				);
				return toolResult(
					"get_agent_run",
					{ agentRunId },
					"{ data: AgentRunDetail, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`agent-runs/${encodeURIComponent(agentRunId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_action",
		{
			description: "Fetch an action with its connected manifest.",
			inputSchema: {
				actionId: z.string().min(1),
			},
		},
		async ({ actionId }) => {
			try {
				const data = await client.get(
					`/internal/actions/${encodeURIComponent(actionId)}`,
				);
				return toolResult(
					"get_action",
					{ actionId },
					"{ data: ActionDetail }",
					{ data },
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_tool_call",
		{
			description: "Fetch a tool call with its connected manifest.",
			inputSchema: {
				toolCallId: z.string().min(1),
			},
		},
		async ({ toolCallId }) => {
			try {
				const data = await client.get(
					`/internal/tool-calls/${encodeURIComponent(toolCallId)}`,
				);
				return toolResult(
					"get_tool_call",
					{ toolCallId },
					"{ data: ToolCallDetail }",
					{ data },
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"list_recent_changes",
		{
			description:
				"List recent service deploys, rollbacks, config updates, feature-flag toggles, and prompt rollouts.",
			inputSchema: {
				environment: z.string().optional(),
				serviceName: z.string().optional(),
				targetNodeId: z.string().optional(),
				kind: ChangeEventKindSchema.optional(),
				since: z.string().optional(),
				limit: positiveInt(20, 1, 500),
			},
		},
		async ({ environment, serviceName, targetNodeId, kind, since, limit }) => {
			try {
				const data = await client.get("/internal/changes", {
					environment,
					serviceName,
					targetNodeId,
					kind,
					since,
					limit,
				});
				return toolResult(
					"list_recent_changes",
					{ environment, serviceName, targetNodeId, kind, since, limit },
					"{ data: { changes: ChangeEvent[] }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("changes"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"get_change_blast_radius",
		{
			description:
				"Compute traffic-normalized cohort lift, noisy-neighbor contention, and code-path overlap for a change.",
			inputSchema: {
				changeId: z.string().min(1),
				environment: z.string().optional(),
				minSample: z.number().int().positive().optional(),
			},
		},
		async ({ changeId, environment, minSample }) => {
			try {
				const data = await client.get(
					`/internal/changes/${encodeURIComponent(changeId)}/blast-radius`,
					{ environment, minSample },
				);
				return toolResult(
					"get_change_blast_radius",
					{ changeId, environment, minSample },
					"{ data: ChangeBlastRadiusResult, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`changes/${encodeURIComponent(changeId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"search_similar_findings",
		{
			description:
				"Search historical investigation findings by recurrence fingerprint, symptom, root cause, or verification status.",
			inputSchema: {
				environment: z.string().optional(),
				fingerprint: z.string().optional(),
				symptomEntityId: z.string().optional(),
				rootCauseEntityId: z.string().optional(),
				causalVerificationStatus: CausalVerificationStatusSchema.optional(),
				limit: positiveInt(20, 1, 500),
			},
		},
		async ({
			environment,
			fingerprint,
			symptomEntityId,
			rootCauseEntityId,
			causalVerificationStatus,
			limit,
		}) => {
			try {
				const data = await client.get("/internal/findings", {
					environment,
					fingerprint,
					symptomEntityId,
					rootCauseEntityId,
					causalVerificationStatus,
					limit,
				});
				return toolResult(
					"search_similar_findings",
					{
						environment,
						fingerprint,
						symptomEntityId,
						rootCauseEntityId,
						causalVerificationStatus,
						limit,
					},
					"{ data: { findings: InvestigationFinding[] }, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("findings"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	registerAutosreReadTools(server, client, { toolResult, errorToolResult });

	if (writesEnabled()) {
		registerAutosreWriteTools(server, client, { toolResult, errorToolResult });
	}
}

async function main(): Promise<void> {
	const config = readConfig();
	const client = new CollectorClient(config);
	const server = new McpServer({
		name: "obs-unified",
		version: "2.3.0",
	});

	registerTools(server, client);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

export { main, registerTools };

if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
	main().catch((err) => {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	});
}
