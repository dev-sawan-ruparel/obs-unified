// Logger (from DecisionOps)

// AI tracking
export { type AILoggerConfig, flushAICalls, initAI, trackAICall } from "./ai";
export {
	createLogger,
	errorMessage,
	flushLogs,
	initLogger,
	type Logger,
	type LoggerConfig,
	type LogSeverity,
} from "./logger";
// OTEL config (from Presence)
export { annotateErrorSpan, createResolveConfig } from "./otel-config";
// High-level plugins (from Presence)
export { analyticsPlugin, observability, telemetryPlugin } from "./plugin";
// Span system (from DecisionOps)
export {
	type ChildSpan,
	createRequestSpan,
	getActiveSpan,
	type RequestSpan,
	runWithSpan,
	withChildSpan,
} from "./span";
// Proxy routers (from Presence)
export { createTelemetryProxyRouter } from "./telemetry-proxy";
export { createUsageProxyRouter } from "./usage-proxy";
