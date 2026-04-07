import type { JsonValue, StoredSpan } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonValue } from "../lib/json";

const DEFAULT_REDACT_FIELDS = [
	"authorization",
	"cookie",
	"set-cookie",
	"password",
	"passwd",
	"secret",
	"token",
	"api-key",
	"x-api-key",
	"email",
	"enduser.id",
];

const REDACTED_VALUE = "[REDACTED]";

const toRedactionFieldSet = (extraFields?: string): Set<string> => {
	const customFields = extraFields
		? extraFields
				.split(",")
				.map((field) => field.trim().toLowerCase())
				.filter(Boolean)
		: [];
	return new Set([...DEFAULT_REDACT_FIELDS, ...customFields]);
};

const shouldRedactKey = (key: string, fields: Set<string>): boolean => {
	const normalizedKey = key.toLowerCase();
	if (fields.has(normalizedKey)) return true;
	for (const field of fields) {
		if (normalizedKey.endsWith(field)) return true;
	}
	return false;
};

const redactJsonValue = (
	value: JsonValue,
	fields: Set<string>,
): { nextValue: JsonValue; redactionCount: number } => {
	if (Array.isArray(value)) {
		let redactionCount = 0;
		const nextValue = value.map((item) => {
			const result = redactJsonValue(item, fields);
			redactionCount += result.redactionCount;
			return result.nextValue;
		});
		return { nextValue, redactionCount };
	}

	if (value && typeof value === "object") {
		let redactionCount = 0;
		const nextEntries = Object.entries(value).map(([key, nestedValue]) => {
			if (shouldRedactKey(key, fields)) {
				redactionCount += 1;
				return [key, REDACTED_VALUE] as const;
			}
			const result = redactJsonValue(nestedValue, fields);
			redactionCount += result.redactionCount;
			return [key, result.nextValue] as const;
		});
		return { nextValue: Object.fromEntries(nextEntries), redactionCount };
	}

	return { nextValue: value, redactionCount: 0 };
};

const redactJsonString = (
	value: string,
	fields: Set<string>,
): { serialized: string; redactionCount: number } => {
	const parsed = parseJsonValue(value);
	const redacted = redactJsonValue(parsed, fields);
	return {
		serialized: JSON.stringify(redacted.nextValue),
		redactionCount: redacted.redactionCount,
	};
};

export const redactionProcessorPlugin: CollectorPlugin = {
	name: "redaction-processor",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "redaction-processor",
			process(spans, context) {
				const redactFields = toRedactionFieldSet(
					context.env.TELEMETRY_REDACT_FIELDS,
				);
				return spans.map((span): StoredSpan => {
					const attributes = redactJsonString(
						span.attributesJson,
						redactFields,
					);
					const resourceAttributes = redactJsonString(
						span.resourceAttributesJson,
						redactFields,
					);
					const events = redactJsonString(span.eventsJson, redactFields);
					const links = redactJsonString(span.linksJson, redactFields);

					const totalRedactions =
						attributes.redactionCount +
						resourceAttributes.redactionCount +
						events.redactionCount +
						links.redactionCount;

					const normalizedAttributes = parseJsonValue(attributes.serialized);
					const nextAttributes =
						normalizedAttributes &&
						typeof normalizedAttributes === "object" &&
						!Array.isArray(normalizedAttributes)
							? {
									...normalizedAttributes,
									"collector.redaction.count": totalRedactions,
								}
							: normalizedAttributes;

					return {
						...span,
						attributesJson: JSON.stringify(nextAttributes),
						resourceAttributesJson: resourceAttributes.serialized,
						eventsJson: events.serialized,
						linksJson: links.serialized,
					};
				});
			},
		});
	},
};
