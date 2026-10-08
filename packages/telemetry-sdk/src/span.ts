/**
 * Custom OTLP-compatible span system with AsyncLocalStorage (from DecisionOps).
 * Provides createRequestSpan, getActiveSpan, runWithSpan, withChildSpan.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import type {
	OtlpEvent,
	OtlpKeyValue,
	OtlpTraceExportRequest,
} from "@obsunified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_HEADER_NAME,
	ACTION_ID_KEY,
	ACTION_ID_RE,
	ACTION_ROOT_HEADER_NAME,
	ACTION_ROOT_ID_KEY,
	ACTOR_ID_KEY,
	ACTOR_TYPE_KEY,
	AGENT_RUN_ID_KEY,
	INTERACTION_ID_KEY,
} from "@obsunified/types/constants";
import { type FlushLifecycle, installFlushLifecycle } from "./flush-lifecycle";

const generateId = (bytes: number): string =>
	randomBytes(bytes).toString("hex");
const nowNano = (): string => (BigInt(Date.now()) * 1_000_000n).toString();
const MAX_SPAN_BUFFER_SIZE = 200;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

export interface SpanExporterConfig {
	collectorUrl: string;
	authToken?: string;
	extraHeaders?: Record<string, string>;
	/** Periodic flush interval in milliseconds. Set to 0 to disable. */
	flushIntervalMs?: number;
}

let spanExporterConfig: SpanExporterConfig | null = null;
const spanBuffer: OtlpTraceExportRequest[] = [];
let spanFlushInProgress = false;
let spanFlushLifecycle: FlushLifecycle | null = null;

export function initSpanExporter(config: SpanExporterConfig): void {
	spanExporterConfig = config;
	spanFlushLifecycle?.stop();
	spanFlushLifecycle = installFlushLifecycle({
		name: "span telemetry",
		flush: flushSpans,
		intervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
	});
}

export async function shutdownSpanExporter(): Promise<void> {
	spanFlushLifecycle?.stop();
	spanFlushLifecycle = null;
	await flushSpans();
	spanExporterConfig = null;
}

export async function flushSpans(): Promise<void> {
	if (!spanExporterConfig || spanBuffer.length === 0 || spanFlushInProgress) {
		return;
	}

	spanFlushInProgress = true;
	const batch = spanBuffer.splice(0, spanBuffer.length);
	const payload = mergeTraceExportRequests(batch);

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(spanExporterConfig.extraHeaders ?? {}),
		};
		if (spanExporterConfig.authToken) {
			headers.Authorization = `Bearer ${spanExporterConfig.authToken}`;
		}

		await fetch(`${spanExporterConfig.collectorUrl}/v1/traces`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		console.error("Failed to flush spans:", err);
		requeueSpans(batch);
	} finally {
		spanFlushInProgress = false;
	}
}

function enqueueSpanExport(request: OtlpTraceExportRequest): void {
	if (!spanExporterConfig) return;
	if (spanBuffer.length >= MAX_SPAN_BUFFER_SIZE) {
		spanBuffer.splice(0, spanBuffer.length - MAX_SPAN_BUFFER_SIZE + 1);
	}
	spanBuffer.push(request);
}

function requeueSpans(batch: OtlpTraceExportRequest[]): void {
	if (batch.length === 0) return;
	spanBuffer.unshift(...batch);
	if (spanBuffer.length > MAX_SPAN_BUFFER_SIZE) {
		spanBuffer.splice(0, spanBuffer.length - MAX_SPAN_BUFFER_SIZE);
	}
}

function mergeTraceExportRequests(
	batch: OtlpTraceExportRequest[],
): OtlpTraceExportRequest {
	return {
		resourceSpans: batch.flatMap((request) => request.resourceSpans ?? []),
	};
}

const toKv = (key: string, value: unknown): OtlpKeyValue => {
	if (typeof value === "string") return { key, value: { stringValue: value } };
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { key, value: { intValue: String(value) } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: String(value ?? "") } };
};

const setOrReplaceKv = (
	attributes: OtlpKeyValue[],
	key: string,
	value: unknown,
): void => {
	const kv = toKv(key, value);
	const existingIndex = attributes.findIndex((attr) => attr.key === key);
	if (existingIndex === -1) {
		attributes.push(kv);
		return;
	}
	attributes[existingIndex] = kv;
};

export interface ChildSpan {
	readonly spanId: string;
	setAttribute(key: string, value: unknown): void;
	addEvent(name: string, attributes?: Record<string, unknown>): void;
	setStatus(code: number, message?: string): void;
	end(): void;
}

export interface RequestSpan {
	readonly traceId: string;
	readonly spanId: string;
	readonly statusCode: number;
	setAttribute(key: string, value: unknown): void;
	addEvent(name: string, attributes?: Record<string, unknown>): void;
	setStatus(code: number, message?: string): void;
	createChildSpan(name: string, kind?: number): ChildSpan;
	end(): void;
	toOtlpExportRequest(): OtlpTraceExportRequest;
}

const spanStorage = new AsyncLocalStorage<RequestSpan>();

/**
 * The span_id of the current logical parent for any new child span. Defaults
 * to the request span's id, but `withChildSpan` pushes its child's id here so
 * further `withChildSpan` (or wrapped binding) calls inside the wrapped fn
 * become grandchildren rather than flat siblings of the request root.
 */
const parentSpanIdStorage = new AsyncLocalStorage<string>();

export const getActiveSpan = (): RequestSpan | undefined =>
	spanStorage.getStore();

export const runWithSpan = <T>(span: RequestSpan, fn: () => T): T =>
	spanStorage.run(span, fn);

interface ChildSpanRecord {
	spanId: string;
	parentSpanId: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano?: string;
	attributes: OtlpKeyValue[];
	events: OtlpEvent[];
	statusCode: number;
	statusMessage?: string;
}

/**
 * Parsed inbound trace context. Pass this to `createRequestSpan` to make
 * the new root span a continuation of the caller's trace — preserves the
 * trace_id and links via parent_span_id, so distributed traces land as
 * one tree across services.
 *
 * The W3C traceparent header format is `00-<traceId>-<parentSpanId>-<flags>`.
 * Use {@link parseTraceparent} to convert the header value to this shape.
 */
export interface IncomingTraceContext {
	traceId: string;
	parentSpanId: string;
}

const TRACEPARENT_RE =
	/^[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/**
 * Parse a W3C traceparent header. Returns `undefined` when the header is
 * missing or malformed — callers should fall through to generating a
 * fresh trace id in that case.
 */
export const parseTraceparent = (
	header: string | null | undefined,
): IncomingTraceContext | undefined => {
	if (!header) return undefined;
	const m = TRACEPARENT_RE.exec(header.trim().toLowerCase());
	if (!m) return undefined;
	const [, traceId, parentSpanId] = m;
	// Reject all-zero ids per spec.
	if (/^0+$/.test(traceId) || /^0+$/.test(parentSpanId)) return undefined;
	return { traceId, parentSpanId };
};

// ── RFC 0004 — interaction_id propagation ─────────────────────────────

/** Standard span-attribute key for the click-scoped correlation id. */
export const INTERACTION_ATTRIBUTE_KEY = "obs.interaction.id";

/** Header name set by `@obsunified/analytics-sdk` on outbound requests. */
export const INTERACTION_HEADER_NAME = "x-obs-interaction";

const INTERACTION_ID_RE = /^[0-9A-HJKMNPQRSTVWXYZ]{26}$/;

/**
 * Parse + validate the `x-obs-interaction` header. Returns `undefined`
 * when missing, empty, or malformed (not a 26-char Crockford-base32
 * string). Reject malformed values rather than letting them flow through
 * — a wrong interaction_id stamps the wrong join.
 *
 * Accepts whatever the host runtime exposes for headers — Hono's
 * `c.req.header(...)`, Node's `req.headers[...]`, or a raw value pulled
 * from a Headers instance — all return string | null | undefined which
 * this function handles uniformly.
 */
export const parseInteractionHeader = (
	header: string | null | undefined,
): string | undefined => {
	if (!header) return undefined;
	const trimmed = header.trim();
	if (!INTERACTION_ID_RE.test(trimmed)) return undefined;
	return trimmed;
};

export interface IncomingActionContext {
	actionId: string;
	rootActionId: string;
	causedByActionId: string | null;
}

export const parseActionHeader = (
	header: string | null | undefined,
): string | undefined => {
	if (!header) return undefined;
	const trimmed = header.trim();
	if (!ACTION_ID_RE.test(trimmed)) return undefined;
	return trimmed;
};

const headerValue = (
	request:
		| Request
		| { headers: { get(name: string): string | null } | Headers },
	name: string,
): string | null => {
	const headers =
		"headers" in request ? request.headers : (request as Request).headers;
	return typeof headers.get === "function" ? headers.get(name) : null;
};

/**
 * Convenience: stamp the interaction id from a request's headers onto a
 * span. No-op when the header is missing or invalid. Idempotent — safe
 * to call from multiple middleware layers.
 *
 *   const span = createRequestSpan(...);
 *   stampInteractionFromRequest(span, request);
 */
export const stampInteractionFromRequest = (
	span: { setAttribute(key: string, value: unknown): void },
	request:
		| Request
		| { headers: { get(name: string): string | null } | Headers },
): string | undefined => {
	const raw = headerValue(request, INTERACTION_HEADER_NAME);
	const id = parseInteractionHeader(raw);
	if (id !== undefined) span.setAttribute(INTERACTION_ATTRIBUTE_KEY, id);
	return id;
};

export interface AgentActionContext {
	actionId: string;
	rootActionId: string;
	causedByActionId: string | null;
	interactionId: string | null;
	agentRunId: string | null;
	actorType: string;
	actorId: string | null;
}

export const agentContextStorage = new AsyncLocalStorage<AgentActionContext>();

export function getActiveActionContext(): AgentActionContext | undefined {
	return agentContextStorage.getStore();
}

export function runWithActionContext<T>(
	context: AgentActionContext,
	fn: () => T,
): T {
	return agentContextStorage.run(context, fn);
}

export function setActiveActionContext(
	context: AgentActionContext,
): () => void {
	const previous = getActiveActionContext();
	agentContextStorage.enterWith(context);
	return () => {
		if (previous) agentContextStorage.enterWith(previous);
		else agentContextStorage.disable();
	};
}

export function clearActiveActionContext(): void {
	agentContextStorage.disable();
}

const anonymousInboundActionContext = (
	context: IncomingActionContext,
	interactionId: string | null,
): AgentActionContext => ({
	actionId: context.actionId,
	rootActionId: context.rootActionId,
	causedByActionId: context.causedByActionId,
	interactionId,
	agentRunId: null,
	actorType: "unknown",
	actorId: null,
});

export const parseActionHeadersFromRequest = (
	request:
		| Request
		| { headers: { get(name: string): string | null } | Headers },
): IncomingActionContext | undefined => {
	const rootActionId = parseActionHeader(
		headerValue(request, ACTION_ROOT_HEADER_NAME),
	);
	const actionId = parseActionHeader(headerValue(request, ACTION_HEADER_NAME));
	if (!rootActionId && !actionId) return undefined;
	return {
		rootActionId: rootActionId ?? actionId ?? "",
		actionId: actionId ?? rootActionId ?? "",
		causedByActionId: null,
	};
};

export const stampActionFromRequest = (
	span: { setAttribute(key: string, value: unknown): void },
	request:
		| Request
		| { headers: { get(name: string): string | null } | Headers },
): IncomingActionContext | undefined => {
	const explicitContext = parseActionHeadersFromRequest(request);
	const interactionId = parseInteractionHeader(
		headerValue(request, INTERACTION_HEADER_NAME),
	);
	const context =
		explicitContext ??
		(interactionId
			? {
					actionId: interactionId,
					rootActionId: interactionId,
					causedByActionId: null,
				}
			: undefined);
	if (!context) return undefined;

	if (interactionId) {
		span.setAttribute(INTERACTION_ID_KEY, interactionId);
	}
	span.setAttribute(ACTION_ID_KEY, context.actionId);
	span.setAttribute(ACTION_ROOT_ID_KEY, context.rootActionId);
	if (context.causedByActionId) {
		span.setAttribute(ACTION_CAUSED_BY_ID_KEY, context.causedByActionId);
	}
	setActiveActionContext(
		anonymousInboundActionContext(context, interactionId ?? null),
	);
	return context;
};

export const stampIdentityFromRequest = (
	span: { setAttribute(key: string, value: unknown): void },
	request:
		| Request
		| { headers: { get(name: string): string | null } | Headers },
): {
	interactionId?: string;
	actionContext?: IncomingActionContext;
} => ({
	interactionId: stampInteractionFromRequest(span, request),
	actionContext: stampActionFromRequest(span, request),
});

export function createRequestSpan(
	serviceName: string,
	spanName: string,
	incoming?: IncomingTraceContext,
): RequestSpan {
	const traceId = incoming?.traceId ?? generateId(16);
	const spanId = generateId(8);
	const startTimeUnixNano = nowNano();
	let endTimeUnixNano: string | undefined;
	const attributes: OtlpKeyValue[] = [];
	const events: OtlpEvent[] = [];
	let statusCode = 0;
	let statusMessage: string | undefined;
	const childSpans: ChildSpanRecord[] = [];
	let exported = false;

	return {
		traceId,
		spanId,
		get statusCode() {
			return statusCode;
		},
		setAttribute(key, value) {
			setOrReplaceKv(attributes, key, value);
		},
		addEvent(name, attrs) {
			const event: OtlpEvent = { name, timeUnixNano: nowNano() };
			if (attrs && Object.keys(attrs).length > 0) {
				event.attributes = Object.entries(attrs).map(([k, v]) => toKv(k, v));
			}
			events.push(event);
		},
		setStatus(code, message) {
			statusCode = code;
			statusMessage = message;
		},
		createChildSpan(name, kind = 1) {
			// Honor the current logical parent from AsyncLocalStorage so spans
			// created inside a `withChildSpan` body nest under that body, not
			// flat under the request root. Falls back to the request span's id
			// when no nested context is active.
			const parentSpanId = parentSpanIdStorage.getStore() ?? spanId;
			const child: ChildSpanRecord = {
				spanId: generateId(8),
				parentSpanId,
				name,
				kind,
				startTimeUnixNano: nowNano(),
				attributes: [],
				events: [],
				statusCode: 0,
			};

			const agentCtx = agentContextStorage.getStore();
			if (agentCtx) {
				child.attributes.push(toKv(ACTION_ID_KEY, agentCtx.actionId));
				child.attributes.push(toKv(ACTION_ROOT_ID_KEY, agentCtx.rootActionId));
				if (agentCtx.causedByActionId) {
					child.attributes.push(
						toKv(ACTION_CAUSED_BY_ID_KEY, agentCtx.causedByActionId),
					);
				}
				if (agentCtx.interactionId) {
					child.attributes.push(
						toKv(INTERACTION_ID_KEY, agentCtx.interactionId),
					);
				}
				child.attributes.push(toKv(ACTOR_TYPE_KEY, agentCtx.actorType));
				child.attributes.push(
					toKv("obs.action.actor_type", agentCtx.actorType),
				);
				if (agentCtx.actorId) {
					child.attributes.push(toKv(ACTOR_ID_KEY, agentCtx.actorId));
					child.attributes.push(toKv("obs.action.actor_id", agentCtx.actorId));
				}
				if (agentCtx.agentRunId) {
					child.attributes.push(toKv(AGENT_RUN_ID_KEY, agentCtx.agentRunId));
					child.attributes.push(
						toKv("obs.action.agent_run_id", agentCtx.agentRunId),
					);
				}
			}

			childSpans.push(child);
			return {
				spanId: child.spanId,
				setAttribute(key: string, value: unknown) {
					setOrReplaceKv(child.attributes, key, value);
				},
				addEvent(evtName: string, attrs?: Record<string, unknown>) {
					const event: OtlpEvent = { name: evtName, timeUnixNano: nowNano() };
					if (attrs && Object.keys(attrs).length > 0) {
						event.attributes = Object.entries(attrs).map(([k, v]) =>
							toKv(k, v),
						);
					}
					child.events.push(event);
				},
				setStatus(code: number, message?: string) {
					child.statusCode = code;
					child.statusMessage = message;
				},
				end() {
					child.endTimeUnixNano = nowNano();
				},
			};
		},
		end() {
			if (exported) return;
			endTimeUnixNano = nowNano();
			exported = true;
			enqueueSpanExport(this.toOtlpExportRequest());
		},
		toOtlpExportRequest(): OtlpTraceExportRequest {
			return {
				resourceSpans: [
					{
						resource: { attributes: [toKv("service.name", serviceName)] },
						scopeSpans: [
							{
								scope: { name: serviceName },
								spans: [
									{
										traceId,
										spanId,
										...(incoming
											? { parentSpanId: incoming.parentSpanId }
											: {}),
										name: spanName,
										kind: 2,
										startTimeUnixNano,
										endTimeUnixNano,
										attributes,
										events,
										status: { code: statusCode, message: statusMessage },
									},
									...childSpans.map((c) => ({
										traceId,
										spanId: c.spanId,
										parentSpanId: c.parentSpanId,
										name: c.name,
										kind: c.kind,
										startTimeUnixNano: c.startTimeUnixNano,
										endTimeUnixNano: c.endTimeUnixNano,
										attributes: c.attributes,
										events: c.events,
										status: { code: c.statusCode, message: c.statusMessage },
									})),
								],
							},
						],
					},
				],
			};
		},
	};
}

export async function withChildSpan<T>(
	name: string,
	fn: (child: ChildSpan) => Promise<T>,
): Promise<T> {
	const parent = getActiveSpan();
	if (!parent)
		return fn({
			spanId: "",
			setAttribute() {},
			addEvent() {},
			setStatus() {},
			end() {},
		} as ChildSpan);
	const child = parent.createChildSpan(name);
	// Push this child's span_id as the logical parent for the duration of fn.
	// Any further `withChildSpan` / `wrapD1` calls inside fn read this value
	// from AsyncLocalStorage and become grandchildren of `child`, not flat
	// siblings under the request root.
	return parentSpanIdStorage.run(child.spanId, async () => {
		try {
			const result = await fn(child);
			child.end();
			return result;
		} catch (error) {
			child.setStatus(
				2,
				error instanceof Error ? error.message : String(error),
			);
			child.end();
			throw error;
		}
	});
}
