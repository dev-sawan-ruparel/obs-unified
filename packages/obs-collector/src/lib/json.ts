import type { JsonValue } from "@obs-unified/types";

export const parseJsonRecord = (
	value: string | null | undefined,
): Record<string, JsonValue> => {
	if (!value) {
		return {};
	}

	try {
		const parsed = JSON.parse(value) as JsonValue;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, JsonValue>)
			: {};
	} catch {
		return {};
	}
};

export const parseJsonValue = (value: string): JsonValue => {
	try {
		return JSON.parse(value) as JsonValue;
	} catch {
		return {};
	}
};

export const parseJsonArray = (value: string | null | undefined): unknown[] => {
	if (!value) {
		return [];
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
};
