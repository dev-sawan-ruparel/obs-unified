import { createTelemetryCollectorApp, type CollectorConfig } from "./framework/collector";
import { createIngestAuth } from "./auth/ingest-auth";
import { createDashboardAuth } from "./auth/dashboard-auth";
import { aiReceiverPlugin } from "./plugins/ai-receiver";
import { botFilterPlugin } from "./plugins/bot-filter";
import { defaultSpanEnrichmentPlugin } from "./plugins/default-span-enrichment";
import { issueEnrichmentPlugin } from "./plugins/issue-enrichment";
import { issueInsightsPlugin } from "./plugins/issue-insights";
import { logsReceiverPlugin } from "./plugins/logs-receiver";
import { otlpReceiverPlugin } from "./plugins/otlp-receiver";
import { queryRoutesPlugin } from "./plugins/query-routes";
import { redactionProcessorPlugin } from "./plugins/redaction-processor";
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

export {
	type CollectorAuthConfig,
	type CollectorConfig,
	type CollectorPlugin,
	type CollectorRuntime,
	createRetentionCleanupHandler,
	createTelemetryCollectorApp,
	type SpanProcessorPlugin,
	type UsageEventProcessorPlugin,
} from "./framework/collector";

export { createIngestAuth } from "./auth/ingest-auth";
export { createDashboardAuth } from "./auth/dashboard-auth";

export {
	aiReceiverPlugin,
	botFilterPlugin,
	defaultSpanEnrichmentPlugin,
	issueEnrichmentPlugin,
	issueInsightsPlugin,
	logsReceiverPlugin,
	otlpReceiverPlugin,
	queryRoutesPlugin,
	redactionProcessorPlugin,
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
};

/** All built-in plugins in recommended registration order */
export const allPlugins = [
	defaultSpanEnrichmentPlugin,
	issueEnrichmentPlugin,
	redactionProcessorPlugin,
	usageNormalizationPlugin,
	usagePrivacyPlugin,
	uaEnrichmentPlugin,
	botFilterPlugin,
	utmEnrichmentPlugin,
	otlpReceiverPlugin,
	usageReceiverPlugin,
	logsReceiverPlugin,
	aiReceiverPlugin,
	identityReceiverPlugin,
	replayReceiverPlugin,
	issueInsightsPlugin,
	queryRoutesPlugin,
	usageQueryRoutesPlugin,
	usersQueryRoutesPlugin,
	replayQueryRoutesPlugin,
];

export const createDefaultCollectorApp = (config?: Partial<CollectorConfig>) =>
	createTelemetryCollectorApp({
		plugins: config?.plugins ?? [...allPlugins, platformRoutesPlugin],
		auth: config?.auth,
		allowedOrigins: config?.allowedOrigins,
		dashboardAuth: config?.dashboardAuth,
	});

export default createTelemetryCollectorApp(allPlugins);
