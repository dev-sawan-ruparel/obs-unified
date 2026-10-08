export interface RedactionContext {
	projectId: string;
	actionId: string;
	traceId: string;
	spanId: string;
	kind: "tool_call" | "retrieval" | "eval" | "artifact" | "agent_run";
	fieldName: "args" | "result" | "query" | "documents" | "content";
}

export interface PayloadRedactorPlugin {
	name: string;
	redact(
		value: unknown,
		context: RedactionContext,
	): unknown | Promise<unknown> | undefined;
}

const redactionPlugins: PayloadRedactorPlugin[] = [];

export function registerRedactionPlugin(plugin: PayloadRedactorPlugin) {
	redactionPlugins.push(plugin);
}

export function clearRedactionPlugins() {
	redactionPlugins.length = 0;
}

// Default redactor that performs sensitive key scrubbing.
const DEFAULT_REDACT_KEYS = new Set([
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
]);

function shouldRedactKey(key: string): boolean {
	const normalized = key.toLowerCase();
	if (DEFAULT_REDACT_KEYS.has(normalized)) return true;
	for (const k of DEFAULT_REDACT_KEYS) {
		if (normalized.endsWith(k)) return true;
	}
	return false;
}

function redactObj(val: unknown): unknown {
	if (Array.isArray(val)) {
		return val.map(redactObj);
	}
	if (val && typeof val === "object") {
		const nextEntries = Object.entries(val).map(([key, nestedValue]) => {
			if (shouldRedactKey(key)) {
				return [key, "[REDACTED]"] as const;
			}
			return [key, redactObj(nestedValue)] as const;
		});
		return Object.fromEntries(nextEntries);
	}
	return val;
}

export async function runRedaction(
	value: unknown,
	context: RedactionContext,
): Promise<unknown> {
	for (const plugin of redactionPlugins) {
		try {
			const res = await plugin.redact(value, context);
			if (res !== undefined) {
				return res;
			}
		} catch (err) {
			console.error(`[redaction-plugin:${plugin.name}] failed`, err);
		}
	}

	return redactObj(value);
}
