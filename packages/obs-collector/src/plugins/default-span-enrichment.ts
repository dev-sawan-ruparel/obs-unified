import type { JsonValue, StoredSpan } from "@obsunified/types";
import {
	INTERACTION_ID_KEY,
	SESSION_ID_KEY,
} from "@obsunified/types/constants";
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

					const sessionId =
						typeof attributes[SESSION_ID_KEY] === "string" &&
						attributes[SESSION_ID_KEY].length > 0
							? (attributes[SESSION_ID_KEY] as string)
							: null;

					// RFC 0004 — denormalize obs.interaction.id from attributes
					// to a top-level column. Stamped by @obsunified/telemetry-sdk's
					// stampInteractionFromRequest on the inbound request.
					const interactionId =
						typeof attributes[INTERACTION_ID_KEY] === "string" &&
						attributes[INTERACTION_ID_KEY].length > 0
							? (attributes[INTERACTION_ID_KEY] as string)
							: null;

					// RFC 0009 — denormalize telemetry.sdk.name from
					// resource_attributes. Beyla and other eBPF agents set
					// this to identify themselves; the service map's
					// source filter uses it to distinguish kernel-observed
					// edges from SDK-instrumented ones.
					const telemetrySdkName =
						typeof resourceAttributes["telemetry.sdk.name"] === "string" &&
						(resourceAttributes["telemetry.sdk.name"] as string).length > 0
							? (resourceAttributes["telemetry.sdk.name"] as string)
							: null;

					return {
						...span,
						serviceName,
						attributesJson: JSON.stringify(normalizedAttributes),
						sessionId,
						interactionId,
						telemetrySdkName,
					};
				});
			},
		});
	},
};
