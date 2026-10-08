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

export interface McpAuditOptions {
	/**
	 * Raw `_meta` is disabled by default. Enable only in trusted environments
	 * after the redacted shape has been reviewed for project-specific secrets.
	 */
	captureRawMeta?: boolean;
}

export interface McpAuditEnvelope {
	schemaVersion: 1;
	presentFields: string[];
	allowedFields: Record<string, string>;
	hasRawMeta: boolean;
	rawMetaRedacted?: unknown;
	redactedFields: string[];
	hashedFields: Record<string, string>;
	droppedFields: string[];
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

/**
 * Build a privacy-safe audit envelope for MCP JSON-RPC `params._meta`.
 *
 * The envelope allow-lists only obs-unified causal context fields that agents
 * need for debugging. Vendor/private metadata is represented by field names and
 * hashes. Raw `_meta` capture is disabled by default and, when explicitly
 * enabled, still passes through sensitive-key redaction.
 */
export async function buildMcpAuditEnvelope(
	params: unknown,
	options: McpAuditOptions = {},
): Promise<McpAuditEnvelope | undefined> {
	if (!params || typeof params !== "object") return undefined;
	const rawMeta = (params as { _meta?: unknown })._meta;
	if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) {
		return undefined;
	}
	const meta = rawMeta as Record<string, unknown>;
	const presentFields = Object.keys(meta).sort();
	const allowedFields: Record<string, string> = {};
	const redactedFields: string[] = [];
	const hashedFields: Record<string, string> = {};
	const droppedFields: string[] = [];

	addAllowedString(meta, allowedFields, "traceparent");
	addAllowedString(meta, allowedFields, "obs.action.root_id");
	addAllowedString(meta, allowedFields, "obs.action.id");

	if (meta.obs && typeof meta.obs === "object" && !Array.isArray(meta.obs)) {
		const obs = meta.obs as Record<string, unknown>;
		if (typeof obs.root_action_id === "string") {
			allowedFields["obs.root_action_id"] = obs.root_action_id;
		}
		if (typeof obs.action_id === "string") {
			allowedFields["obs.action_id"] = obs.action_id;
		}
	}

	const interactionId = parseBaggageInteractionId(
		typeof meta.baggage === "string" ? meta.baggage : undefined,
	);
	if (interactionId) {
		allowedFields["baggage.obs.interaction.id"] = interactionId;
	}

	for (const field of presentFields) {
		if (isAllowedMcpAuditField(field)) continue;
		if (field === "tracestate" || field === "baggage") continue;
		const value = meta[field];
		if (value === undefined) continue;
		hashedFields[field] = await sha256Hex(stableStringify(value));
		droppedFields.push(field);
	}

	for (const field of ["tracestate", "baggage"]) {
		const value = meta[field];
		if (typeof value === "string") {
			hashedFields[field] = await sha256Hex(value);
			if (field === "baggage" && interactionId) {
				redactedFields.push("baggage");
			} else {
				droppedFields.push(field);
			}
		}
	}

	const envelope: McpAuditEnvelope = {
		schemaVersion: 1,
		presentFields,
		allowedFields,
		hasRawMeta: options.captureRawMeta === true,
		redactedFields: [...new Set(redactedFields)].sort(),
		hashedFields,
		droppedFields: [...new Set(droppedFields)].sort(),
	};

	if (options.captureRawMeta === true) {
		envelope.rawMetaRedacted = redactSensitiveKeys(meta);
	}

	return envelope;
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

const addAllowedString = (
	meta: Record<string, unknown>,
	allowedFields: Record<string, string>,
	field: string,
): void => {
	const value = meta[field];
	if (typeof value === "string") {
		allowedFields[field] = value;
	}
};

const isAllowedMcpAuditField = (field: string): boolean =>
	field === "traceparent" ||
	field === "obs.action.root_id" ||
	field === "obs.action.id" ||
	field === "obs";

const SENSITIVE_META_KEYS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"password",
	"passwd",
	"secret",
	"token",
	"api-key",
	"x-api-key",
	"email",
	"enduser.id",
]);

const shouldRedactMetaKey = (key: string): boolean => {
	const normalized = key.toLowerCase();
	if (SENSITIVE_META_KEYS.has(normalized)) return true;
	for (const sensitiveKey of SENSITIVE_META_KEYS) {
		if (normalized.endsWith(sensitiveKey)) return true;
	}
	return false;
};

const redactSensitiveKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) {
		return value.map(redactSensitiveKeys);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) => [
				key,
				shouldRedactMetaKey(key)
					? "[REDACTED]"
					: redactSensitiveKeys(nestedValue),
			]),
		);
	}
	return value;
};

const stableStringify = (value: unknown): string => {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	return `{${Object.keys(obj)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
		.join(",")}}`;
};

const sha256Hex = async (input: string): Promise<string> => {
	const encoder = new TextEncoder();
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};
