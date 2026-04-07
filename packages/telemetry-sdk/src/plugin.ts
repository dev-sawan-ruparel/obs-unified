/**
 * High-level orchestration helpers (from Presence).
 * One-call setup for analytics and telemetry on a Hono app.
 */

import type { TelemetryProxyEnv } from "@obs/types";
import type { Hono, MiddlewareHandler } from "hono";
import { createResolveConfig } from "./otel-config";
import { createTelemetryProxyRouter } from "./telemetry-proxy";
import { createUsageProxyRouter } from "./usage-proxy";

interface AnalyticsPluginOptions {
	routePrefix?: string;
}

interface TelemetryPluginOptions {
	defaultServiceName?: string;
	defaultServiceVersion?: string;
	adminRoutePrefix?: string;
	admin?: boolean;
}

interface ObservabilityOptions
	extends AnalyticsPluginOptions,
		TelemetryPluginOptions {
	analytics?: boolean;
}

export const analyticsPlugin = <E extends TelemetryProxyEnv>(
	app: Hono<{ Bindings: E }>,
	options?: AnalyticsPluginOptions,
): void => {
	const prefix = options?.routePrefix ?? "/api/usage";
	app.route(prefix, createUsageProxyRouter<E>());
};

export const telemetryPlugin = <E extends TelemetryProxyEnv>(
	app: Hono<{ Bindings: E }>,
	options?: TelemetryPluginOptions,
) => {
	const adminPrefix = options?.adminRoutePrefix ?? "/api/admin";

	if (options?.admin !== false) {
		app.route(adminPrefix, createTelemetryProxyRouter<E>());
	}

	return createResolveConfig({
		defaultServiceName: options?.defaultServiceName,
		defaultServiceVersion: options?.defaultServiceVersion,
	});
};

export const observability = <E extends TelemetryProxyEnv>(
	app: Hono<{ Bindings: E }>,
	options?: ObservabilityOptions,
) => {
	if (options?.analytics !== false) {
		analyticsPlugin(app, options);
	}
	return telemetryPlugin(app, options);
};
