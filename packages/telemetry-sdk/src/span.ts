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
} from "@obs-unified/types";

const generateId = (bytes: number): string =>
	randomBytes(bytes).toString("hex");
const nowNano = (): string => (BigInt(Date.now()) * 1_000_000n).toString();

const toKv = (key: string, value: unknown): OtlpKeyValue => {
	if (typeof value === "string") return { key, value: { stringValue: value } };
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { key, value: { intValue: value } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: String(value ?? "") } };
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

/** Header name set by `@obs-unified/analytics-sdk` on outbound requests. */
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
	const headers =
		"headers" in request ? request.headers : (request as Request).headers;
	const raw =
		typeof headers.get === "function"
			? headers.get(INTERACTION_HEADER_NAME)
			: undefined;
	const id = parseInteractionHeader(raw);
	if (id !== undefined) span.setAttribute(INTERACTION_ATTRIBUTE_KEY, id);
	return id;
};

export interface AgentActionContext {
	actionId: string;
	rootActionId: string;
	causedByActionId: string | null;
	agentRunId: string | null;
	actorType: string;
	actorId: string | null;
}

export const agentContextStorage = new AsyncLocalStorage<AgentActionContext>();

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

	return {
		traceId,
		spanId,
		get statusCode() {
			return statusCode;
		},
		setAttribute(key, value) {
			attributes.push(toKv(key, value));
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
				child.attributes.push(toKv("obs.action.id", agentCtx.actionId));
				child.attributes.push(toKv("obs.action.root_id", agentCtx.rootActionId));
				if (agentCtx.causedByActionId) {
					child.attributes.push(toKv("obs.action.caused_by_id", agentCtx.causedByActionId));
				}
				child.attributes.push(toKv("obs.action.actor_type", agentCtx.actorType));
				if (agentCtx.actorId) {
					child.attributes.push(toKv("obs.action.actor_id", agentCtx.actorId));
				}
				if (agentCtx.agentRunId) {
					child.attributes.push(toKv("obs.action.agent_run_id", agentCtx.agentRunId));
				}
			}

			childSpans.push(child);
			return {
				spanId: child.spanId,
				setAttribute(key: string, value: unknown) {
					child.attributes.push(toKv(key, value));
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
			endTimeUnixNano = nowNano();
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
