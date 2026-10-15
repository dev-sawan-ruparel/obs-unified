/**
 * High-level orchestration helpers.
 * One-call setup for telemetry on a Hono app.
 */

import type { ObservabilityLineageConfig } from "./lineage";
import { createResolveConfig } from "./otel-config";

export interface TelemetryPluginOptions extends ObservabilityLineageConfig {
	defaultServiceName?: string;
	defaultServiceVersion?: string;
	lineage?: ObservabilityLineageConfig;
}

/**
 * Initialize telemetry for a Hono app.
 * Returns a `resolveConfig` middleware for OTEL span export.
 *
 * @example
 * ```ts
 * import { telemetryPlugin } from "@obsunified/telemetry-sdk";
 *
 * const resolveConfig = telemetryPlugin(app, {
 *   defaultServiceName: "my-api",
 * });
 * ```
 */
export const telemetryPlugin = (options?: TelemetryPluginOptions) => {
	return createResolveConfig({
		defaultServiceName: options?.defaultServiceName,
		defaultServiceVersion: options?.defaultServiceVersion,
		environment: options?.environment,
		serviceVersion: options?.serviceVersion,
		commitSha: options?.commitSha,
		configDigest: options?.configDigest,
		lineage: options?.lineage,
	});
};
