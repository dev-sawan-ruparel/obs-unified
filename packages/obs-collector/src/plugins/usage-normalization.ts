import type { JsonValue, UsageEventRecord } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

const normalizePathSegment = (segment: string): string => {
	if (!segment) return segment;
	if (/^\d+$/.test(segment)) return ":id";
	if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
	return segment;
};

const normalizePath = (path: string | null): string | null => {
	if (!path) return null;
	const [pathname] = path.split("?");
	const segments = pathname
		.split("/")
		.map(normalizePathSegment)
		.filter((segment, index) => !(index === 0 && segment === ""));
	return `/${segments.join("/")}`.replace(/\/{2,}/g, "/");
};

export const usageNormalizationPlugin: CollectorPlugin = {
	name: "usage-normalization",
	register(_app, runtime) {
		runtime.addUsageEventProcessor({
			name: "usage-normalization",
			process(events) {
				return events.map((event): UsageEventRecord => {
					const context = parseJsonRecord(event.contextJson);
					const normalizedPath = normalizePath(event.pagePath);
					const nextContext: Record<string, JsonValue> = {
						...context,
						"collector.is_admin_path": Boolean(
							normalizedPath && normalizedPath.startsWith("/admin"),
						),
					};
					return {
						...event,
						pagePath: normalizedPath,
						contextJson: JSON.stringify(nextContext),
					};
				});
			},
		});
	},
};
