import type { ActionContextOptions } from "./agent";
import {
	getActiveActionContext,
	getActiveSpan,
	type IncomingTraceContext,
	parseActionHeader,
	parseInteractionHeader,
	parseTraceparent,
} from "./span";

export interface McpContext {
	traceContext?: IncomingTraceContext;
	actionContext?: ActionContextOptions;
	tracestate?: string;
	baggage?: string;
}

export interface McpContextInjectionOptions {
	tracestate?: string;
	baggage?: string;
}

type McpParams = {
	_meta?: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Client side: inject W3C traceparent and obs-unified action context
 * into standard Model Context Protocol (MCP) JSON-RPC request params._meta.
 */
export function injectMcpContext(
	params: McpParams | null | undefined,
	options: McpContextInjectionOptions = {},
): void {
	if (!params || typeof params !== "object") return;
	params._meta = params._meta || {};

	const activeSpan = getActiveSpan();
	if (activeSpan) {
		params._meta.traceparent = `00-${activeSpan.traceId}-${activeSpan.spanId}-01`;
	}

	const activeAction = getActiveActionContext();
	if (activeAction) {
		params._meta["obs.action.root_id"] = activeAction.rootActionId;
		params._meta["obs.action.id"] = activeAction.actionId;
		params._meta.obs = {
			root_action_id: activeAction.rootActionId,
			action_id: activeAction.actionId,
		};
	}

	if (options.tracestate) {
		params._meta.tracestate = options.tracestate;
	}
	if (options.baggage) {
		params._meta.baggage = options.baggage;
	} else if (activeAction?.interactionId) {
		params._meta.baggage = appendBaggagePair(
			typeof params._meta.baggage === "string" ? params._meta.baggage : "",
			"obs.interaction.id",
			activeAction.interactionId,
		);
	}
}

// Explicit aliases make request and notification JSON-RPC call sites readable.
export const injectMcpRequestContext = (
	params: McpParams | null | undefined,
): void => injectMcpContext(params);

export const injectMcpNotificationContext = (
	params: McpParams | null | undefined,
): void => injectMcpContext(params);

/**
 * Server side: extract trace context and obs-unified action context
 * from MCP request params._meta. The returned contexts can be passed
 * to standard trace/action context restoration utilities (e.g. `createRequestSpan`
 * and `withAction`) before performing nested operations.
 */
export function extractMcpContext(params: unknown): McpContext | undefined {
	if (!params || typeof params !== "object") return undefined;
	const rawMeta = (params as { _meta?: unknown })._meta;
	if (!rawMeta || typeof rawMeta !== "object") return undefined;
	const meta = rawMeta as Record<string, unknown>;

	const context: McpContext = {};

	if (typeof meta.traceparent === "string") {
		context.traceContext = parseTraceparent(meta.traceparent);
	}
	if (typeof meta.tracestate === "string") {
		context.tracestate = meta.tracestate;
	}
	if (typeof meta.baggage === "string") {
		context.baggage = meta.baggage;
	}

	const obs =
		meta.obs && typeof meta.obs === "object"
			? (meta.obs as Record<string, unknown>)
			: undefined;
	const rootActionId =
		typeof meta["obs.action.root_id"] === "string"
			? meta["obs.action.root_id"]
			: obs?.root_action_id;
	const actionId =
		typeof meta["obs.action.id"] === "string"
			? meta["obs.action.id"]
			: obs?.action_id;
	const validRootActionId =
		typeof rootActionId === "string"
			? parseActionHeader(rootActionId)
			: undefined;
	const validActionId =
		typeof actionId === "string" ? parseActionHeader(actionId) : undefined;
	const interactionId = parseBaggageInteractionId(context.baggage);
	if (validRootActionId && validActionId) {
		context.actionContext = {
			rootActionId: validRootActionId,
			actionId: validActionId,
			causedByActionId: validActionId, // Direct causal parent
			interactionId: interactionId ?? null,
			agentRunId: validRootActionId,
			actorType: "agent",
			actorId: null,
		};
	}

	if (
		!context.traceContext &&
		!context.actionContext &&
		!context.tracestate &&
		!context.baggage
	) {
		return undefined;
	}

	return context;
}

const appendBaggagePair = (
	baggage: string,
	key: string,
	value: string,
): string => {
	const encodedPair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
	if (!baggage) return encodedPair;
	const entries = baggage
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	const hasKey = entries.some((entry) => entry.split("=")[0]?.trim() === key);
	if (hasKey) return entries.join(",");
	return [...entries, encodedPair].join(",");
};

const parseBaggageInteractionId = (
	baggage: string | undefined,
): string | undefined => {
	if (!baggage) return undefined;
	for (const entry of baggage.split(",")) {
		const [rawKey, rawValue] = entry.trim().split("=");
		if (!rawKey || rawValue === undefined) continue;
		if (decodeURIComponent(rawKey.trim()) !== "obs.interaction.id") continue;
		const value = decodeURIComponent(rawValue.trim());
		return parseInteractionHeader(value);
	}
	return undefined;
};
