// ── Unified init ──

import { initLogger, type LoggerConfig } from "./logger";
import { initAI, type AILoggerConfig } from "./ai";

export interface ObservabilityConfig {
	/** URL of your collector (e.g. "https://obs.my-app.com") */
	collectorUrl: string;
	/** Write-only API key for the collector */
	apiKey: string;
	/** Name of your service (e.g. "my-api") */
	serviceName: string;
	/** Optional service version */
	serviceVersion?: string;
}

/**
 * Initialize all observability subsystems in one call.
 * This is the recommended entry point for backend integration.
 *
 * @example
 * ```ts
 * import { initObservability, createLogger } from "@obs/telemetry-sdk";
 *
 * initObservability({
 *   collectorUrl: "https://obs.my-app.com",
 *   apiKey: process.env.OBS_INGEST_KEY,
 *   serviceName: "my-api",
 * });
 *
 * const logger = createLogger("my-module");
 * logger.info("Hello observability");
 * ```
 */
export function initObservability(config: ObservabilityConfig): void {
	const loggerConfig: LoggerConfig = {
		collectorUrl: config.collectorUrl,
		authToken: config.apiKey,
		serviceName: config.serviceName,
	};
	const aiConfig: AILoggerConfig = {
		collectorUrl: config.collectorUrl,
		authToken: config.apiKey,
		serviceName: config.serviceName,
	};
	initLogger(loggerConfig);
	initAI(aiConfig);
}

// ── AI tracking ──
export { type AILoggerConfig, flushAICalls, initAI, trackAICall } from "./ai";

// ── AI span helpers (OpenInference) ──
export {
	type AISpan,
	type ChainSpanOptions,
	type EmbeddingSpanOptions,
	type LLMSpan,
	type LLMSpanOptions,
	type RetrievedDocument,
	type RetrieverSpan,
	type RetrieverSpanOptions,
	type ToolSpanOptions,
	clearAISessionContext,
	getAISessionContext,
	setAISessionContext,
	startAgentSpan,
	startChainSpan,
	startEmbeddingSpan,
	startLLMSpan,
	startRetrieverSpan,
	startToolSpan,
} from "./ai-spans";

// ── Logger ──
export {
	createLogger,
	errorMessage,
	flushLogs,
	initLogger,
	type Logger,
	type LoggerConfig,
	type LogSeverity,
} from "./logger";

// ── OTEL config ──
export { annotateErrorSpan, createResolveConfig } from "./otel-config";

// ── High-level plugin ──
export { telemetryPlugin } from "./plugin";

// ── Span system ──
export {
	type ChildSpan,
	createRequestSpan,
	getActiveSpan,
	type RequestSpan,
	runWithSpan,
	withChildSpan,
} from "./span";

