// ── Unified init ──

import { type AILoggerConfig, initAI } from "./ai";
import { initLogger, type LoggerConfig } from "./logger";
import { initSpanExporter, type SpanExporterConfig } from "./span";

export interface ObservabilityConfig {
	/** URL of your collector (e.g. "https://obs.my-app.com") */
	collectorUrl: string;
	/** Write-only API key for the collector */
	apiKey: string;
	/** Name of your service (e.g. "my-api") */
	serviceName: string;
	/** Optional service version */
	serviceVersion?: string;
	/** Periodic flush interval in milliseconds for logs and AI calls. Set to 0 to disable. */
	flushIntervalMs?: number;
	/**
	 * Additional HTTP headers attached to every collector POST (logs + AI).
	 * Used by the obs-collector worker to mark self-emitted telemetry with
	 * `X-Telemetry-Self: 1` so its own request middleware can short-circuit
	 * and avoid an infinite export loop.
	 *
	 * See apps/collector/SELF_INSTRUMENTATION.md before changing this.
	 */
	extraHeaders?: Record<string, string>;
}

/**
 * Initialize all observability subsystems in one call.
 * This is the recommended entry point for backend integration.
 *
 * @example
 * ```ts
 * import { initObservability, createLogger } from "@obs-unified/telemetry-sdk";
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
		extraHeaders: config.extraHeaders,
		flushIntervalMs: config.flushIntervalMs,
	};
	const aiConfig: AILoggerConfig = {
		collectorUrl: config.collectorUrl,
		authToken: config.apiKey,
		serviceName: config.serviceName,
		extraHeaders: config.extraHeaders,
		flushIntervalMs: config.flushIntervalMs,
	};
	const spanConfig: SpanExporterConfig = {
		collectorUrl: config.collectorUrl,
		authToken: config.apiKey,
		extraHeaders: config.extraHeaders,
		flushIntervalMs: config.flushIntervalMs,
	};
	initSpanExporter(spanConfig);
	initLogger(loggerConfig);
	initAI(aiConfig);
}

// ── Agentic Causal Graph (RFC 0010) ──
export {
	type ActionContextOptions,
	type AgentRun,
	type AgentRunOptions,
	type AgentStep,
	type ArtifactOptions,
	createActionId,
	type EvalOptions,
	getActiveAgentContext,
	type LLMCall,
	type LLMOptions,
	llm,
	type RetrievalDocument,
	type RetrievalOptions,
	type Retriever,
	recordArtifact,
	recordEvaluation,
	recordRetrieval,
	type StepOptions,
	startAgentRun,
	step,
	type ToolCall,
	type ToolOptions,
	tool,
	withAction,
} from "./agent";
// ── AI tracking ──
export {
	type AILoggerConfig,
	flushAICalls,
	initAI,
	shutdownAI,
	trackAICall,
} from "./ai";
// ── AI span helpers (OpenInference) ──
export {
	type AISpan,
	type ChainSpanOptions,
	clearAISessionContext,
	type EmbeddingSpanOptions,
	getAISessionContext,
	type LLMSpan,
	type LLMSpanOptions,
	type RetrievedDocument,
	type RetrieverSpan,
	type RetrieverSpanOptions,
	setAISessionContext,
	startAgentSpan,
	startChainSpan,
	startEmbeddingSpan,
	startLLMSpan,
	startRetrieverSpan,
	startToolSpan,
	type ToolSpanOptions,
} from "./ai-spans";
// ── Cloudflare binding wrappers ──
export { type WrapD1Options, wrapD1 } from "./d1";
// ── HTTP client wrapper ──
export { type WrapFetchOptions, wrapFetch } from "./fetch";
// ── Logger ──
export {
	createLogger,
	errorMessage,
	flushLogs,
	initLogger,
	type Logger,
	type LoggerConfig,
	type LogSeverity,
	shutdownLogger,
} from "./logger";
// ── OTEL config ──
export { annotateErrorSpan, createResolveConfig } from "./otel-config";
// ── High-level plugin ──
export { telemetryPlugin } from "./plugin";
// ── Process metrics (RFC 0005) ──
export {
	type EnableProcessMetricsOptions,
	enableProcessMetrics,
} from "./process-metrics";
// ── pprof profile push (RFC 0007) ──
export {
	type ProfileCapture,
	type ProfilerHandle,
	type PushProfileOptions,
	type PushProfileResult,
	pushProfile,
	type StartProfilerOptions,
	startProfiler,
} from "./profile";
export { type WrapR2Options, wrapR2 } from "./r2";
// ── Span system ──
export {
	type ChildSpan,
	clearActiveActionContext,
	createRequestSpan,
	flushSpans,
	getActiveActionContext,
	getActiveSpan,
	INTERACTION_ATTRIBUTE_KEY,
	INTERACTION_HEADER_NAME,
	type IncomingActionContext,
	type IncomingTraceContext,
	initSpanExporter,
	parseActionHeader,
	parseActionHeadersFromRequest,
	parseInteractionHeader,
	parseTraceparent,
	type RequestSpan,
	runWithActionContext,
	runWithSpan,
	type SpanExporterConfig,
	setActiveActionContext,
	shutdownSpanExporter,
	stampActionFromRequest,
	stampIdentityFromRequest,
	stampInteractionFromRequest,
	withChildSpan,
} from "./span";
