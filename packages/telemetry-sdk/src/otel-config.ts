/**
 * OTEL configuration helpers for Cloudflare Workers (from Presence).
 * Creates config for @microlabs/otel-cf-workers instrument().
 */

import type { TelemetryProxyEnv } from "@obs/types";

export interface OtelEnv extends TelemetryProxyEnv {
	OTEL_ENABLED?: string;
	OTEL_EXPORTER_URL?: string;
	OTEL_EXPORTER_HEADERS?: string;
	OTEL_SERVICE_NAME?: string;
	OTEL_SERVICE_VERSION?: string;
	OTEL_SAMPLE_RATIO?: string;
}

interface ResolveConfigOptions {
	defaultServiceName?: string;
	defaultServiceVersion?: string;
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

		return {
			exporter: {
				url: exporterUrl,
				headers: Object.fromEntries(headerPairs),
			},
			service: {
				name: env.OTEL_SERVICE_NAME || options?.defaultServiceName || "unknown",
				version:
					env.OTEL_SERVICE_VERSION || options?.defaultServiceVersion || "0.0.0",
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
	// This is a lightweight helper — actual span annotation depends on
	// whether you're using @opentelemetry/api or the custom span system.
	// When using custom spans, use getActiveSpan() from ./span instead.
	try {
		const { trace } = require("@opentelemetry/api");
		const span = trace.getActiveSpan();
		if (!span) return;

		span.recordException(
			error instanceof Error ? error : new Error(String(error)),
		);
		span.setStatus({ code: 2 });
		if (context?.path) span.setAttribute("url.path", context.path);
		if (context?.method)
			span.setAttribute("http.request.method", context.method);
		span.setAttribute("app.error.handled", true);
	} catch {
		// @opentelemetry/api not available — no-op
	}
};
