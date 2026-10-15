import { trace } from "@opentelemetry/api";
import {
	buildLineageAttributes,
	type ObservabilityLineageConfig,
	resolveLineageConfig,
} from "./lineage";

/**
 * OTEL configuration helpers for Cloudflare Workers (from Presence).
 * Creates config for @microlabs/otel-cf-workers instrument().
 */

export interface OtelEnv {
	OTEL_ENABLED?: string;
	OTEL_EXPORTER_URL?: string;
	OTEL_EXPORTER_HEADERS?: string;
	OTEL_SERVICE_NAME?: string;
	OTEL_SERVICE_VERSION?: string;
	OTEL_SAMPLE_RATIO?: string;
	OBS_ENVIRONMENT?: string;
	NODE_ENV?: string;
	OBS_SERVICE_VERSION?: string;
	OBS_COMMIT_SHA?: string;
	GITHUB_SHA?: string;
	OBS_CONFIG_DIGEST?: string;
}

export interface ResolveConfigOptions extends ObservabilityLineageConfig {
	defaultServiceName?: string;
	defaultServiceVersion?: string;
	lineage?: ObservabilityLineageConfig;
}

export const createResolveConfig = <E extends OtelEnv>(
	options?: ResolveConfigOptions,
) => {
	return (env: E, _trigger: unknown) => {
		const exporterUrl = env.OTEL_EXPORTER_URL;
		const enabled = env.OTEL_ENABLED
			? env.OTEL_ENABLED === "true"
			: Boolean(exporterUrl);

		if (!enabled || !exporterUrl) {
			return { exporter: undefined };
		}

		const headerPairs = (env.OTEL_EXPORTER_HEADERS || "")
			.split(",")
			.map((pair) => pair.trim().split("="))
			.filter((parts) => parts.length === 2) as [string, string][];

		const sampleRatio = Math.max(
			0,
			Math.min(1, Number.parseFloat(env.OTEL_SAMPLE_RATIO || "1") || 1),
		);

		const envMap = env as unknown as Record<string, string | undefined>;
		const resolvedLineage = resolveLineageConfig(options, envMap);
		const lineageAttributes = buildLineageAttributes(options, envMap);

		return {
			exporter: {
				url: exporterUrl,
				headers: Object.fromEntries(headerPairs),
			},
			service: {
				name: env.OTEL_SERVICE_NAME || options?.defaultServiceName || "unknown",
				version:
					resolvedLineage.serviceVersion ||
					env.OTEL_SERVICE_VERSION ||
					options?.defaultServiceVersion ||
					"0.0.0",
			},
			resource: {
				attributes: lineageAttributes,
			},
			sampling: {
				headSampler: { acceptRemote: true, ratio: sampleRatio },
			},
		};
	};
};

/**
 * Annotate the active span with error details (from Presence).
 * Call this in error handlers to record exceptions on the current span.
 */
export const annotateErrorSpan = (
	error: unknown,
	context?: { path?: string; method?: string },
): void => {
	const span = trace.getActiveSpan();
	if (!span) return;

	span.recordException(
		error instanceof Error ? error : new Error(String(error)),
	);
	span.setStatus({ code: 2 });
	if (context?.path) span.setAttribute("url.path", context.path);
	if (context?.method) span.setAttribute("http.request.method", context.method);
	span.setAttribute("app.error.handled", true);
};
