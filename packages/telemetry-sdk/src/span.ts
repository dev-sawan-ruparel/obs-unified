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
} from "@obs/types";

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

export function createRequestSpan(
	serviceName: string,
	spanName: string,
): RequestSpan {
	const traceId = generateId(16);
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
			const child: ChildSpanRecord = {
				spanId: generateId(8),
				parentSpanId: spanId,
				name,
				kind,
				startTimeUnixNano: nowNano(),
				attributes: [],
				events: [],
				statusCode: 0,
			};
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
	try {
		const result = await fn(child);
		child.end();
		return result;
	} catch (error) {
		child.setStatus(2, error instanceof Error ? error.message : String(error));
		child.end();
		throw error;
	}
}
