import type { JsonValue, StoredSpan } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

const INTERNAL_PATH_PREFIXES = [
	"/api/admin",
	"/api/internal",
	"/internal/telemetry",
	"/v1/traces",
	"/health",
];

const getStringValue = (
	record: Record<string, JsonValue>,
	keys: string[],
): string | null => {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
};

const normalizePathSegment = (segment: string): string => {
	if (!segment) return segment;
	if (/^\d+$/.test(segment)) return ":id";
	if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			segment,
		)
	)
		return ":uuid";
	return segment;
};

const normalizePath = (path: string): string => {
	const [pathname] = path.split("?");
	const segments = pathname
		.split("/")
		.map(normalizePathSegment)
		.filter((segment, index) => !(index === 0 && segment === ""));
	return `/${segments.join("/")}`.replace(/\/{2,}/g, "/");
};

const isInternalPath = (path: string): boolean =>
	INTERNAL_PATH_PREFIXES.some(
		(prefix) => path === prefix || path.startsWith(`${prefix}/`),
	);

const deriveDependencyTarget = (
	attributes: Record<string, JsonValue>,
	resourceAttributes: Record<string, JsonValue>,
): string | null => {
	const dbSystem = getStringValue(attributes, ["db.system"]);
	if (dbSystem) return dbSystem;
	const peerService = getStringValue(attributes, [
		"peer.service",
		"server.address",
		"http.host",
	]);
	if (peerService) return peerService;
	const urlValue = getStringValue(attributes, ["url.full", "http.url"]);
	if (urlValue) {
		try {
			return new URL(urlValue).host;
		} catch {
			return urlValue;
		}
	}
	return getStringValue(resourceAttributes, ["host.name"]);
};

export const issueEnrichmentPlugin: CollectorPlugin = {
	name: "issue-enrichment",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "issue-enrichment",
			process(spans) {
				return spans.map((span): StoredSpan => {
					const attributes = parseJsonRecord(span.attributesJson);
					const resourceAttributes = parseJsonRecord(
						span.resourceAttributesJson,
					);
					const method = getStringValue(attributes, [
						"http.request.method",
						"http.method",
					]);
					const path = getStringValue(attributes, [
						"url.path",
						"http.target",
						"http.route",
					]);
					const routePath = path ? normalizePath(path) : null;
					const existingRouteLabel = getStringValue(attributes, [
						"collector.route_label",
					]);
					const dependencyTarget = deriveDependencyTarget(
						attributes,
						resourceAttributes,
					);
					const isDependencySpan = Boolean(
						dependencyTarget ||
							span.spanKind === 3 ||
							span.spanKind === 4 ||
							span.spanKind === 5,
					);

					const nextAttributes: Record<string, JsonValue> = { ...attributes };

					if (routePath) {
						nextAttributes["collector.route_key"] = routePath;
						if (!existingRouteLabel) {
							nextAttributes["collector.route_label"] = method
								? `${method} ${routePath}`
								: routePath;
						}
						nextAttributes["collector.is_internal"] = isInternalPath(routePath);
					}
					if (dependencyTarget && isDependencySpan) {
						nextAttributes["collector.dependency_target"] = dependencyTarget;
					}
					if (isDependencySpan) {
						nextAttributes["collector.span_role"] = "dependency";
					}

					return { ...span, attributesJson: JSON.stringify(nextAttributes) };
				});
			},
		});
	},
};
