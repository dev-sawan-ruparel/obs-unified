import { createTelemetryCollectorApp, type CollectorConfig } from "./framework/collector";
import { createIngestAuth } from "./auth/ingest-auth";
import { createDashboardAuth } from "./auth/dashboard-auth";
import { aiReceiverPlugin } from "./plugins/ai-receiver";
import { aiSpanPayloadsProcessorPlugin } from "./plugins/ai-span-payloads-processor";
import { botFilterPlugin } from "./plugins/bot-filter";
import { genAiNormalizerPlugin } from "./plugins/gen-ai-normalizer";
import { defaultSpanEnrichmentPlugin } from "./plugins/default-span-enrichment";
import { issueEnrichmentPlugin } from "./plugins/issue-enrichment";
import { issueInsightsPlugin } from "./plugins/issue-insights";
import { logsReceiverPlugin } from "./plugins/logs-receiver";
import { metricsReceiverPlugin } from "./plugins/metrics-receiver";
import { otlpReceiverPlugin } from "./plugins/otlp-receiver";
import { queryRoutesPlugin } from "./plugins/query-routes";
import { redactionProcessorPlugin } from "./plugins/redaction-processor";
import { tailRoutesPlugin } from "./plugins/tail-routes";
import { timelineRoutesPlugin } from "./plugins/timeline-routes";
import { uaEnrichmentPlugin } from "./plugins/ua-enrichment";
import { usageNormalizationPlugin } from "./plugins/usage-normalization";
import { usagePrivacyPlugin } from "./plugins/usage-privacy";
import { usageQueryRoutesPlugin } from "./plugins/usage-query-routes";
import { usageReceiverPlugin } from "./plugins/usage-receiver";
import { utmEnrichmentPlugin } from "./plugins/utm-enrichment";
import { identityReceiverPlugin } from "./plugins/identity-receiver";
import { usersQueryRoutesPlugin } from "./plugins/users-query-routes";
import { replayReceiverPlugin } from "./plugins/replay-receiver";
import { replayQueryRoutesPlugin } from "./plugins/replay-query-routes";
import { platformRoutesPlugin } from "./plugins/platform-routes";
import { projectsRoutesPlugin } from "./plugins/projects-routes";
import { alertsRoutesPlugin } from "./plugins/alerts-routes";
import { analysesRoutesPlugin } from "./plugins/analyses-routes";
import { askRoutesPlugin } from "./plugins/ask-routes";
import { connectedRoutesPlugin } from "./plugins/connected-routes";
import { profileRoutesPlugin } from "./plugins/profile-routes";
import {
	createAlertEvaluatorHandler,
	evaluateAllRules,
} from "./plugins/alerts-evaluator";

export {
	type CollectorAuthConfig,
	type CollectorConfig,
	type CollectorPlugin,
	type CollectorRuntime,
	createAnalysesRunHandler,
	createRetentionCleanupHandler,
	createTelemetryCollectorApp,
	type SpanProcessorPlugin,
	type SqlDbFactory,
	type UsageEventProcessorPlugin,
} from "./framework/collector";

export { D1Adapter, type SqlDb, type SqlStatement } from "./lib/sql-db";
export {
	PostgresAdapter,
	type PostgresAdapterOptions,
} from "./lib/sql-db-postgres";
export {
	type BlobListOptions,
	type BlobListResult,
	type BlobObject,
	type BlobPutOptions,
	type BlobStore,
	R2BlobStore,
} from "./lib/blob-store";
export { S3BlobStore, type S3BlobStoreOptions } from "./lib/blob-store-s3";

export type {
	CollectorApp,
	CollectorEnv,
	CollectorRouteContext,
} from "./framework/env";

export type { Logger } from "./framework/logger";
export { consoleLogger } from "./framework/logger";

export { createIngestAuth } from "./auth/ingest-auth";
export { createDashboardAuth } from "./auth/dashboard-auth";

export {
	aiReceiverPlugin,
	aiSpanPayloadsProcessorPlugin,
	botFilterPlugin,
	defaultSpanEnrichmentPlugin,
	genAiNormalizerPlugin,
	issueEnrichmentPlugin,
	issueInsightsPlugin,
	logsReceiverPlugin,
	metricsReceiverPlugin,
	otlpReceiverPlugin,
	queryRoutesPlugin,
	redactionProcessorPlugin,
	tailRoutesPlugin,
	timelineRoutesPlugin,
	uaEnrichmentPlugin,
	usageNormalizationPlugin,
	usagePrivacyPlugin,
	usageQueryRoutesPlugin,
	usageReceiverPlugin,
	utmEnrichmentPlugin,
	identityReceiverPlugin,
	usersQueryRoutesPlugin,
	replayReceiverPlugin,
	replayQueryRoutesPlugin,
	platformRoutesPlugin,
	projectsRoutesPlugin,
	alertsRoutesPlugin,
	analysesRoutesPlugin,
	askRoutesPlugin,
	connectedRoutesPlugin,
	profileRoutesPlugin,
	createAlertEvaluatorHandler,
	evaluateAllRules,
};

export { TailHub } from "./durable-objects/tail-hub";
export type { TailEvent, TailKind } from "./durable-objects/tail-hub";

export { ProjectsStore } from "./lib/projects-store";
export { AlertsStore, compareValue } from "./lib/alerts-store";
export { MetricsStore } from "./lib/metrics-store";

/** All built-in plugins in recommended registration order */
export const allPlugins = [
	defaultSpanEnrichmentPlugin,
	issueEnrichmentPlugin,
	redactionProcessorPlugin,
	// Normalize vendor gen_ai.* attrs → OpenInference before payload routing.
	genAiNormalizerPlugin,
	// Must run after redaction + normalization so stored payloads reflect the
	// redacted form and cover both native-SDK and gen_ai spans.
	aiSpanPayloadsProcessorPlugin,
	usageNormalizationPlugin,
	usagePrivacyPlugin,
	uaEnrichmentPlugin,
	botFilterPlugin,
	utmEnrichmentPlugin,
	otlpReceiverPlugin,
	usageReceiverPlugin,
	logsReceiverPlugin,
	metricsReceiverPlugin,
	aiReceiverPlugin,
	identityReceiverPlugin,
	replayReceiverPlugin,
	issueInsightsPlugin,
	projectsRoutesPlugin,
	queryRoutesPlugin,
	usageQueryRoutesPlugin,
	usersQueryRoutesPlugin,
	replayQueryRoutesPlugin,
	alertsRoutesPlugin,
	analysesRoutesPlugin,
	askRoutesPlugin,
	tailRoutesPlugin,
	timelineRoutesPlugin,
	connectedRoutesPlugin,
	profileRoutesPlugin,
];

export const createDefaultCollectorApp = (config?: Partial<CollectorConfig>) =>
	createTelemetryCollectorApp({
		plugins: config?.plugins ?? [...allPlugins, platformRoutesPlugin],
		auth: config?.auth,
		allowedOrigins: config?.allowedOrigins,
		dashboardAuth: config?.dashboardAuth,
		logger: config?.logger,
		withChildSpan: config?.withChildSpan,
		sqlDb: config?.sqlDb,
	});

export default createTelemetryCollectorApp(allPlugins);
