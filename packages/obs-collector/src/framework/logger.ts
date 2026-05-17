/**
 * Pluggable logger interface for the collector framework.
 *
 * Structurally compatible with `@obs-unified/telemetry-sdk`'s `Logger`, so the worker
 * entrypoint can do:
 *
 *   import { createLogger } from "@obs-unified/telemetry-sdk";
 *   createDefaultCollectorApp({ logger: createLogger("obs-collector") });
 *
 * The framework package intentionally does not import telemetry-sdk to keep
 * the dependency graph one-way (SDK depends on collector contracts, not the
 * other way around). Anything that conforms to this interface works.
 *
 * When no logger is supplied, the framework falls back to a console-backed
 * logger so out-of-the-box deployments keep their existing log output.
 */
export interface Logger {
	debug(message: string, attributes?: Record<string, unknown>): void;
	info(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
}

const formatAttrs = (attributes?: Record<string, unknown>): string => {
	if (!attributes || Object.keys(attributes).length === 0) return "";
	try {
		return ` ${JSON.stringify(attributes)}`;
	} catch {
		return "";
	}
};

export const consoleLogger: Logger = {
	debug: (message, attributes) =>
		console.debug(`${message}${formatAttrs(attributes)}`),
	info: (message, attributes) =>
		console.log(`${message}${formatAttrs(attributes)}`),
	warn: (message, attributes) =>
		console.warn(`${message}${formatAttrs(attributes)}`),
	error: (message, attributes) =>
		console.error(`${message}${formatAttrs(attributes)}`),
};

/**
 * Minimal handle exposed to a `ChildSpanRunner` callback so the wrapped fn
 * can stamp attributes / events / status onto the span as it learns about
 * them (e.g., LLM token counts that are only known after the response).
 *
 * Structurally compatible with `ChildSpan` from `@obs-unified/telemetry-sdk` so the
 * worker entrypoint can pass the SDK's child span through directly without
 * a bespoke adapter.
 */
export interface ChildSpanHandle {
	setAttribute(key: string, value: unknown): void;
	addEvent?(name: string, attributes?: Record<string, unknown>): void;
	setStatus?(code: number, message?: string): void;
}

/**
 * Wraps an async fn in a child span attached to the active parent span.
 * Structurally compatible with `withChildSpan` from `@obs-unified/telemetry-sdk`.
 * Default is pass-through — wire from the worker entrypoint to enable.
 *
 * The wrapped fn receives a `ChildSpanHandle` so it can stamp attributes
 * after the fact (e.g., `gen_ai.usage.input_tokens` once the LLM response
 * arrives). When unwired, the handle's setters are no-ops.
 */
export type ChildSpanRunner = <T>(
	name: string,
	fn: (span: ChildSpanHandle) => Promise<T>,
	attributes?: Record<string, unknown>,
) => Promise<T>;

const NOOP_HANDLE: ChildSpanHandle = {
	setAttribute() {},
	addEvent() {},
	setStatus() {},
};

export const passthroughChildSpan: ChildSpanRunner = async (_name, fn) =>
	fn(NOOP_HANDLE);
