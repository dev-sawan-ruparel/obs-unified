/**
 * Project-id propagation. obs-unified is multi-tenant: every span/log/metric
 * carries a `project.id` so the dashboard can filter by project.
 *
 * Two ways to set it:
 *   1. As a default at init time via `InitConfig.projectId`. Stamped as a
 *      resource attribute, applied to every emission.
 *   2. Per-request via `setProjectId(projectId)` inside an active span,
 *      which stamps the current span only.
 *
 * For HTTP propagation across services, set the `X-Project-Id` header on
 * outbound requests; the receiving service reads it and calls
 * `setProjectId` early in its request handler.
 */

import { trace } from "@opentelemetry/api";

export const PROJECT_ID_ATTRIBUTE = "project.id";
export const PROJECT_ID_HEADER = "X-Project-Id";

/** Stamps `project.id` on the currently active span. No-op if no span active. */
export const setProjectId = (projectId: string): void => {
	const span = trace.getActiveSpan();
	if (span) span.setAttribute(PROJECT_ID_ATTRIBUTE, projectId);
};

/** Reads `project.id` off the active span. Returns undefined if not set. */
export const getProjectId = (): string | undefined => {
	const span = trace.getActiveSpan();
	if (!span) return undefined;
	// SpanAttributes is internal; use a structural cast.
	const attrs = (span as unknown as {
		attributes?: Record<string, unknown>;
	}).attributes;
	const v = attrs?.[PROJECT_ID_ATTRIBUTE];
	return typeof v === "string" ? v : undefined;
};
