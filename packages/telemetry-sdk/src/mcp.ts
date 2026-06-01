import type { ActionContextOptions } from "./agent";
import {
	getActiveActionContext,
	getActiveSpan,
	type IncomingTraceContext,
	parseTraceparent,
} from "./span";

export interface McpContext {
	traceContext?: IncomingTraceContext;
	actionContext?: ActionContextOptions;
}

/**
 * Client side: inject W3C traceparent and obs-unified action context
 * into standard Model Context Protocol (MCP) JSON-RPC request params._meta.
 */
// biome-ignore lint/suspicious/noExplicitAny: MCP JSON-RPC parameters have arbitrary structure
export function injectMcpContext(params: any): void {
	if (!params || typeof params !== "object") return;
	params._meta = params._meta || {};

	const activeSpan = getActiveSpan();
	if (activeSpan) {
		params._meta.traceparent = `00-${activeSpan.traceId}-${activeSpan.spanId}-01`;
	}

	const activeAction = getActiveActionContext();
	if (activeAction) {
		params._meta.obs = {
			root_action_id: activeAction.rootActionId,
			action_id: activeAction.actionId,
		};
	}
}

/**
 * Server side: extract trace context and obs-unified action context
 * from MCP request params._meta. The returned contexts can be passed
 * to standard trace/action context restoration utilities (e.g. `createRequestSpan`
 * and `withAction`) before performing nested operations.
 */
// biome-ignore lint/suspicious/noExplicitAny: MCP JSON-RPC parameters have arbitrary structure
export function extractMcpContext(params: any): McpContext | undefined {
	const meta = params?._meta;
	if (!meta || typeof meta !== "object") return undefined;

	const context: McpContext = {};

	if (typeof meta.traceparent === "string") {
		context.traceContext = parseTraceparent(meta.traceparent);
	}

	const obs = meta.obs;
	if (obs && typeof obs === "object") {
		const rootActionId = obs.root_action_id;
		const actionId = obs.action_id;
		if (typeof rootActionId === "string" && typeof actionId === "string") {
			context.actionContext = {
				rootActionId,
				actionId,
				causedByActionId: actionId, // Direct causal parent
				agentRunId: rootActionId,
				actorType: "agent",
				actorId: null,
			};
		}
	}

	if (!context.traceContext && !context.actionContext) {
		return undefined;
	}

	return context;
}
