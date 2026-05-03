/**
 * Initializes the OpenTelemetry Node SDK with sane defaults pointed at an
 * obs-unified collector. Call this once at process startup.
 *
 * What it sets up:
 *   - OTLP/HTTP trace + log exporters at `${collectorUrl}/v1/traces`
 *     and `${collectorUrl}/v1/logs` with the ingest key on every export.
 *   - Resource attributes: `service.name`, `service.version`,
 *     `deployment.environment` (when supplied), plus any custom attrs.
 *   - Optional `X-Telemetry-Self: 1` header for services that ingest their
 *     own telemetry (loop-guard scenario; rare).
 *
 * What it does *not* do:
 *   - Auto-instrument HTTP / DB / RPC. Install
 *     `@opentelemetry/auto-instrumentations-node` for that and pass it
 *     via `instrumentations` in the config.
 *
 * Returns a shutdown function. Call it from your SIGTERM handler so
 * pending spans flush before the process exits.
 */

import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	BatchSpanProcessor,
	type SpanProcessor,
	TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

export interface InitConfig {
	/** Base URL of your obs-unified collector (no trailing slash). */
	collectorUrl: string;
	/** Ingest key from the collector's keys UI. Sent as `Authorization: Bearer ...`. */
	ingestKey: string;
	/** Service name surfaced in the dashboard's service list. */
	serviceName: string;
	/** Optional service version for release tagging. */
	serviceVersion?: string;
	/** Optional deployment environment (e.g. `production`, `staging`). */
	environment?: string;
	/** Optional default project id. Stamped as a resource attribute. */
	projectId?: string;
	/** Extra resource attributes merged onto every emitted span / log. */
	resourceAttributes?: Record<string, string | number | boolean>;
	/** Tail-sampling ratio in [0, 1]. Defaults to 1 (sample everything). */
	sampleRatio?: number;
	/**
	 * Set to `true` only if this service ingests its own telemetry through
	 * the same collector. Stamps `X-Telemetry-Self: 1` on every export so
	 * the collector's request middleware short-circuits and avoids a loop.
	 * See `apps/collector/SELF_INSTRUMENTATION.md`.
	 */
	selfTelemetry?: boolean;
	/**
	 * Pass auto-instrumentation packages here, e.g.:
	 *   getNodeAutoInstrumentations() from
	 *   "@opentelemetry/auto-instrumentations-node"
	 */
	instrumentations?: ConstructorParameters<typeof NodeSDK>[0]["instrumentations"];
	/** Enables OTel diag logging at the given level. Useful for first-time setup. */
	debug?: boolean;
}

export type Shutdown = () => Promise<void>;

const headers = (cfg: InitConfig): Record<string, string> => {
	const base: Record<string, string> = {
		Authorization: `Bearer ${cfg.ingestKey}`,
	};
	if (cfg.selfTelemetry) base["X-Telemetry-Self"] = "1";
	return base;
};

export const init = (cfg: InitConfig): Shutdown => {
	if (cfg.debug) {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
	}

	const baseUrl = cfg.collectorUrl.replace(/\/$/, "");

	const resourceAttrs: Record<string, string | number | boolean> = {
		[ATTR_SERVICE_NAME]: cfg.serviceName,
		...(cfg.serviceVersion
			? { [ATTR_SERVICE_VERSION]: cfg.serviceVersion }
			: {}),
		...(cfg.environment
			? { "deployment.environment": cfg.environment }
			: {}),
		...(cfg.projectId ? { "project.id": cfg.projectId } : {}),
		...(cfg.resourceAttributes ?? {}),
	};

	const traceExporter = new OTLPTraceExporter({
		url: `${baseUrl}/v1/traces`,
		headers: headers(cfg),
	});
	const logExporter = new OTLPLogExporter({
		url: `${baseUrl}/v1/logs`,
		headers: headers(cfg),
	});

	const spanProcessors: SpanProcessor[] = [new BatchSpanProcessor(traceExporter)];
	const logRecordProcessors: LogRecordProcessor[] = [
		new BatchLogRecordProcessor(logExporter),
	];

	const sampler =
		cfg.sampleRatio !== undefined && cfg.sampleRatio < 1
			? new TraceIdRatioBasedSampler(cfg.sampleRatio)
			: undefined;

	const sdk = new NodeSDK({
		resource: resourceFromAttributes(resourceAttrs),
		spanProcessors,
		logRecordProcessors,
		sampler,
		instrumentations: cfg.instrumentations,
	});

	sdk.start();

	return async () => {
		await sdk.shutdown();
	};
};
