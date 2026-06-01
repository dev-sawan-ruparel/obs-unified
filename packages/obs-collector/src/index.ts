import {
	type CollectorConfig,
	createTelemetryCollectorApp,
} from "./framework/collector";
import { actionGraphProcessorPlugin } from "./plugins/action-graph-processor";
import { actionRoutesPlugin } from "./plugins/action-routes";
import { aiReceiverPlugin } from "./plugins/ai-receiver";
import { aiSpanPayloadsProcessorPlugin } from "./plugins/ai-span-payloads-processor";
import {
	createAlertEvaluatorHandler,
	evaluateAllRules,
} from "./plugins/alerts-evaluator";
import { alertsRoutesPlugin } from "./plugins/alerts-routes";
import { analysesRoutesPlugin } from "./plugins/analyses-routes";
import { askRoutesPlugin } from "./plugins/ask-routes";
import { botFilterPlugin } from "./plugins/bot-filter";
import { connectedRoutesPlugin } from "./plugins/connected-routes";
import { dashboardRoutesPlugin } from "./plugins/dashboard-routes";
import { defaultSpanEnrichmentPlugin } from "./plugins/default-span-enrichment";
import { genAiNormalizerPlugin } from "./plugins/gen-ai-normalizer";
import { identityReceiverPlugin } from "./plugins/identity-receiver";
import { issueEnrichmentPlugin } from "./plugins/issue-enrichment";
import { issueInsightsPlugin } from "./plugins/issue-insights";
import { logsReceiverPlugin } from "./plugins/logs-receiver";
import { metricsReceiverPlugin } from "./plugins/metrics-receiver";
import { onboardingRoutesPlugin } from "./plugins/onboarding-routes";
import { otlpReceiverPlugin } from "./plugins/otlp-receiver";
import { platformRoutesPlugin } from "./plugins/platform-routes";
import { profileRoutesPlugin } from "./plugins/profile-routes";
import { projectsRoutesPlugin } from "./plugins/projects-routes";
import { queryRoutesPlugin } from "./plugins/query-routes";
import { redactionProcessorPlugin } from "./plugins/redaction-processor";
import { replayQueryRoutesPlugin } from "./plugins/replay-query-routes";
import { replayReceiverPlugin } from "./plugins/replay-receiver";
import { tailRoutesPlugin } from "./plugins/tail-routes";
import { timelineRoutesPlugin } from "./plugins/timeline-routes";
import { uaEnrichmentPlugin } from "./plugins/ua-enrichment";
import { usageNormalizationPlugin } from "./plugins/usage-normalization";
import { usagePrivacyPlugin } from "./plugins/usage-privacy";
import { usageQueryRoutesPlugin } from "./plugins/usage-query-routes";
import { usageReceiverPlugin } from "./plugins/usage-receiver";
import { usersQueryRoutesPlugin } from "./plugins/users-query-routes";
import { utmEnrichmentPlugin } from "./plugins/utm-enrichment";

export { createDashboardAuth } from "./auth/dashboard-auth";
export { createIngestAuth } from "./auth/ingest-auth";
export type { TailEvent, TailKind } from "./durable-objects/tail-hub";
export { TailHub } from "./durable-objects/tail-hub";
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

export type {
	CollectorApp,
	CollectorEnv,
	CollectorRouteContext,
} from "./framework/env";

export type { Logger } from "./framework/logger";
export { consoleLogger } from "./framework/logger";
export { AlertsStore, compareValue } from "./lib/alerts-store";
export {
	type BlobListOptions,
	type BlobListResult,
	type BlobObject,
	type BlobPutOptions,
	type BlobStore,
	BlobStoreToR2Adapter,
	R2BlobStore,
} from "./lib/blob-store";
export { S3BlobStore, type S3BlobStoreOptions } from "./lib/blob-store-s3";
export { MetricsStore } from "./lib/metrics-store";
export { ProjectsStore } from "./lib/projects-store";
export { D1Adapter, type SqlDb, type SqlStatement } from "./lib/sql-db";
export {
	PostgresAdapter,
	type PostgresAdapterOptions,
} from "./lib/sql-db-postgres";
export {
	actionRoutesPlugin,
	aiReceiverPlugin,
	aiSpanPayloadsProcessorPlugin,
	alertsRoutesPlugin,
	analysesRoutesPlugin,
	askRoutesPlugin,
	botFilterPlugin,
	connectedRoutesPlugin,
	createAlertEvaluatorHandler,
	dashboardRoutesPlugin,
	defaultSpanEnrichmentPlugin,
	evaluateAllRules,
	genAiNormalizerPlugin,
	identityReceiverPlugin,
	issueEnrichmentPlugin,
	issueInsightsPlugin,
	logsReceiverPlugin,
	metricsReceiverPlugin,
	onboardingRoutesPlugin,
	otlpReceiverPlugin,
	platformRoutesPlugin,
	profileRoutesPlugin,
	projectsRoutesPlugin,
	queryRoutesPlugin,
	redactionProcessorPlugin,
	replayQueryRoutesPlugin,
	replayReceiverPlugin,
	tailRoutesPlugin,
	timelineRoutesPlugin,
	uaEnrichmentPlugin,
	usageNormalizationPlugin,
	usagePrivacyPlugin,
	usageQueryRoutesPlugin,
	usageReceiverPlugin,
	usersQueryRoutesPlugin,
	utmEnrichmentPlugin,
};

/** All built-in plugins in recommended registration order */
export const allPlugins = [
	defaultSpanEnrichmentPlugin,
	issueEnrichmentPlugin,
	redactionProcessorPlugin,
	// Normalize vendor gen_ai.* attrs → OpenInference before payload routing.
	genAiNormalizerPlugin,
	actionGraphProcessorPlugin,
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
	onboardingRoutesPlugin,
	projectsRoutesPlugin,
	queryRoutesPlugin,
	usageQueryRoutesPlugin,
	usersQueryRoutesPlugin,
	replayQueryRoutesPlugin,
	alertsRoutesPlugin,
	analysesRoutesPlugin,
	actionRoutesPlugin,
	askRoutesPlugin,
	tailRoutesPlugin,
	timelineRoutesPlugin,
	connectedRoutesPlugin,
	profileRoutesPlugin,
	dashboardRoutesPlugin,
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
