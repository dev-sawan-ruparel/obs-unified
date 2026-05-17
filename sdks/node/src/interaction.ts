/**
 * Click-scoped correlation key propagation (server side).
 *
 * The browser SDK (`@obs-unified/analytics-sdk`) mints an `interaction_id`
 * on every click and sets it on the `x-obs-interaction` header of outbound
 * fetch/XHR. This module reads that header on the server side and stamps
 * the active span with `obs.interaction.id` so child spans, logs, and AI
 * calls inherit it.
 *
 * Wire spec: `docs/spec/interaction-id.md` in the obs-unified repo.
 *
 * Usage with the Node HTTP module:
 *
 *   import { stampInteractionFromRequest } from "@obs-unified/sdk";
 *
 *   server.on("request", (req, res) => {
 *     const span = tracer.startSpan("request");
 *     stampInteractionFromRequest(span, req);
 *     // ... your handler ...
 *   });
 *
 * Usage with Fetch API (Bun / Deno / Workers in Node compat):
 *
 *   stampInteractionFromRequest(span, fetchRequest);
 *
 * No-op when the header is absent. Server-originated work (cron, queue,
 * retry) legitimately carries no interaction.
 */

import { type Span, trace } from "@opentelemetry/api";

export const INTERACTION_HEADER = "x-obs-interaction";
export const INTERACTION_ATTRIBUTE = "obs.interaction.id";

// Per spec: 26 chars, Crockford base32, case-sensitive uppercase + digits.
const INTERACTION_ID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type HeaderSource =
	| { headers: { get(name: string): string | null } } // Fetch API Request
	| { headers: Record<string, string | string[] | undefined> } // Node IncomingMessage
	| { headers: Headers }
	| Headers
	| Map<string, string>
	| Record<string, string | string[] | undefined>;

const readHeader = (source: HeaderSource, name: string): string | undefined => {
	const lower = name.toLowerCase();

	// Fetch Headers
	if (source instanceof Headers) {
		return source.get(lower) ?? undefined;
	}

	if (source instanceof Map) {
		return source.get(lower) ?? source.get(name) ?? undefined;
	}

	// Carrier shapes with a `headers` field.
	const candidate = source as { headers?: unknown };
	if (candidate.headers) {
		const h = candidate.headers;
		if (h instanceof Headers) return h.get(lower) ?? undefined;
		if (typeof (h as { get?: unknown }).get === "function") {
			return (h as { get(n: string): string | null }).get(lower) ?? undefined;
		}
		const rec = h as Record<string, string | string[] | undefined>;
		const raw = rec[lower] ?? rec[name];
		if (Array.isArray(raw)) return raw[0];
		return raw;
	}

	// Plain object (Node IncomingMessage.headers shape).
	const rec = source as Record<string, string | string[] | undefined>;
	const raw = rec[lower] ?? rec[name];
	if (Array.isArray(raw)) return raw[0];
	return raw;
};

/**
 * Reads the `x-obs-interaction` header off the request and stamps the
 * value onto the given span as `obs.interaction.id`. No-op when:
 *
 *   - the header is absent (server-originated work),
 *   - the value is malformed (network corruption, hostile client),
 *   - the span is undefined or non-recording.
 *
 * Wrong joins are worse than missing ones — we never synthesize a
 * fallback ID.
 */
export const stampInteractionFromRequest = (
	span: Span | undefined,
	request: HeaderSource,
): void => {
	if (!span || !span.isRecording()) return;
	const raw = readHeader(request, INTERACTION_HEADER);
	if (!raw) return;
	if (!INTERACTION_ID_REGEX.test(raw)) return;
	span.setAttribute(INTERACTION_ATTRIBUTE, raw);
};

/**
 * Reads the interaction id from the currently active span. Returns
 * undefined if no span is active or the attribute isn't set.
 */
export const currentInteractionId = (): string | undefined => {
	const span = trace.getActiveSpan();
	if (!span) return undefined;
	const attrs = (span as unknown as {
		attributes?: Record<string, unknown>;
	}).attributes;
	const v = attrs?.[INTERACTION_ATTRIBUTE];
	return typeof v === "string" ? v : undefined;
};

/**
 * Re-export of the regex for tests and downstream validators.
 */
export const isValidInteractionId = (s: string): boolean =>
	INTERACTION_ID_REGEX.test(s);
