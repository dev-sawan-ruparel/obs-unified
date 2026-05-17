import type { JsonValue, UsageEventRecord } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonValue } from "../lib/json";

const REDACTED_VALUE = "[REDACTED]";
const DEFAULT_REDACT_FIELDS = [
	"email",
	"token",
	"password",
	"authorization",
	"cookie",
];

const shouldRedactKey = (key: string): boolean => {
	const normalized = key.toLowerCase();
	return DEFAULT_REDACT_FIELDS.some(
		(field) => normalized === field || normalized.endsWith(field),
	);
};

const redactJson = (value: JsonValue): JsonValue => {
	if (Array.isArray(value)) return value.map(redactJson);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) =>
				shouldRedactKey(key)
					? [key, REDACTED_VALUE]
					: [key, redactJson(nestedValue)],
			),
		);
	}
	return value;
};

export const usagePrivacyPlugin: CollectorPlugin = {
	name: "usage-privacy",
	register(_app, runtime) {
		runtime.addUsageEventProcessor({
			name: "usage-privacy",
			process(events) {
				return events.map(
					(event): UsageEventRecord => ({
						...event,
						contextJson: JSON.stringify(
							redactJson(parseJsonValue(event.contextJson)),
						),
						propertiesJson: JSON.stringify(
							redactJson(parseJsonValue(event.propertiesJson)),
						),
					}),
				);
			},
		});
	},
};
