/**
 * High-level orchestration helpers.
 * One-call setup for telemetry on a Hono app.
 */

import { createResolveConfig } from "./otel-config";

interface TelemetryPluginOptions {
	defaultServiceName?: string;
	defaultServiceVersion?: string;
}

/**
 * Initialize telemetry for a Hono app.
 * Returns a `resolveConfig` middleware for OTEL span export.
 *
 * @example
 * ```ts
 * import { telemetryPlugin } from "@obs/telemetry-sdk";
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
	});
};
