// ── Internal types ──

export type UsageEventType =
	| "page_view"
	| "interaction"
	| "frontend_error"
	| "performance";
export type UsageEventSeverity = "info" | "warn" | "error";

export interface UsageEventPayload {
	type: UsageEventType;
	name: string;
	sessionId: string;
	visitorId: string;
	path?: string;
	title?: string;
	referrer?: string | null;
	occurredAt?: string;
	severity?: UsageEventSeverity;
	properties?: Record<string, unknown>;
	context?: Record<string, unknown>;
	/**
	 * RFC 0004 — click-scoped correlation key. Set when the event is
	 * emitted while an interaction is active (Mode A captures it
	 * automatically; Mode B requires `withInteractionContext`). Null
	 * for events outside any user interaction (e.g. autoflushed
	 * page_view on initial mount).
	 */
	interactionId?: string;
	/**
	 * RFC 0010 — action graph identity. Browser-only interactions coalesce
	 * these with `interactionId`; agent-triggered work may diverge while
	 * preserving the original `interactionId` correlation.
	 */
	rootActionId?: string;
	actionId?: string;
}
