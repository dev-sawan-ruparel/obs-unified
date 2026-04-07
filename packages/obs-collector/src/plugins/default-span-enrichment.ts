import type { JsonValue, StoredSpan } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

export const defaultSpanEnrichmentPlugin: CollectorPlugin = {
	name: "default-span-enrichment",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "default-span-enrichment",
			process(spans) {
				return spans.map((span): StoredSpan => {
					const attributes = parseJsonRecord(span.attributesJson);
					const resourceAttributes = parseJsonRecord(
						span.resourceAttributesJson,
					);

					const method =
						typeof attributes["http.request.method"] === "string"
							? attributes["http.request.method"]
							: undefined;
					const path =
						typeof attributes["url.path"] === "string"
							? attributes["url.path"]
							: undefined;

					const normalizedAttributes: Record<string, JsonValue> = {
						...attributes,
						"collector.status_label":
							span.statusCode === 2
								? "error"
								: span.statusCode === 1
									? "ok"
									: "unset",
						"collector.received_at": span.receivedAt,
					};

					if (method && path) {
						normalizedAttributes["collector.route_label"] = `${method} ${path}`;
					}

					const serviceName =
						span.serviceName ||
						(typeof resourceAttributes["service.name"] === "string"
							? resourceAttributes["service.name"]
							: null) ||
						(typeof attributes["server.address"] === "string"
							? attributes["server.address"]
							: null);

					return {
						...span,
						serviceName,
						attributesJson: JSON.stringify(normalizedAttributes),
					};
				});
			},
		});
	},
};
