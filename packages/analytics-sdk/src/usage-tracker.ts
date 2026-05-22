/**
 * Union browser usage tracker.
 * - P's core tracking (page view, interaction, frontend error)
 * - P's UTM extraction, viewport, referrer, page view deduplication
 * - A's event-once semantics (dedup by key)
 * - A's metadata normalization (truncation, filtering)
 * - A's error skip-list / filtering
 * - D's configurable secondary error endpoint
 */
import { record } from "rrweb";
import { currentInteractionId } from "./interaction";

// ── Public config ──

/**
 * Privacy-related rrweb replay options exposed to SDK consumers.
 *
 * The SDK ships safe defaults: all inputs masked, password/email/tel
 * masked specifically, text input values asterisk-padded. Override these
 * to tighten or loosen recording for your app — for example,
 * `maskInputOptions: { text: true }` to also mask plain text inputs, or
 * `blockSelector: ".secret"` to exclude marked subtrees entirely.
 *
 * Fields are forwarded to rrweb's `record()` and merged with the SDK's
 * defaults. Defining a self-contained shape (rather than re-exporting
 * rrweb's `recordOptions`) keeps the SDK's public surface stable across
 * rrweb upgrades.
 */
export interface ReplayPrivacyOptions {
	/** Mask the value of all <input> elements. Default: true. */
	maskAllInputs?: boolean;
	/**
	 * Per-input-type masking. Shallow-merged with SDK defaults
	 * (`{ password: true, email: true, tel: true, text: false }`).
	 */
	maskInputOptions?: Record<string, boolean>;
	/** Function used to mask input values. Default: asterisk-pads up to 20 chars. */
	maskInputFn?: (text: string, element?: HTMLElement | null) => string;
	/** CSS selector matching elements whose text content should be masked. */
	maskTextSelector?: string;
	/** Function used to mask text content. */
	maskTextFn?: (text: string, element?: HTMLElement | null) => string;
	/** CSS selector matching elements to entirely block from recording. */
	blockSelector?: string;
	/** CSS selector matching elements to ignore (rendered but not recorded). */
	ignoreSelector?: string;
}

export interface UsageTrackerConfig {
	/** URL of your collector (e.g. "https://obs.my-app.com"). When set, the SDK sends directly to the collector. */
	collectorUrl?: string;
	/** Write-only API key for the collector. Required when using collectorUrl. */
	apiKey?: string;
	/**
	 * Legacy: endpoint for usage events (e.g. "/api/usage/events").
	 * @deprecated Use collectorUrl + apiKey instead for direct-to-collector mode.
	 */
	endpoint?: string;
	debug?: boolean;
	/** Optional secondary endpoint for error reporting */
	errorEndpoint?: string;
	/** Storage key prefix (default: 'usage') */
	storagePrefix?: string;
	/** Include credentials in fetch */
	credentials?: RequestCredentials;
	/** Error filter: return false to skip reporting an error */
	errorFilter?: (error: {
		name?: string;
		message?: string;
		source?: string;
	}) => boolean;
	/** Max string length for metadata values (default: 160) */
	maxMetadataLength?: number;
	/**
	 * Privacy-related rrweb replay options. Merged with the SDK's safe
	 * defaults — consumers can tighten masking (e.g. mask text inputs too)
	 * or add `blockSelector` / `ignoreSelector` rules without forking the
	 * SDK. See {@link ReplayPrivacyOptions}.
	 */
	replayPrivacyOptions?: ReplayPrivacyOptions;
}

// ── Internal types ──

type UsageEventType =
	| "page_view"
	| "interaction"
	| "frontend_error"
	| "performance";
type UsageEventSeverity = "info" | "warn" | "error";

interface UsageEventPayload {
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
}

// ── Helpers ──

const createId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

const safeStorage = (
	storage: Storage,
	key: string,
	value?: string,
): string | null => {
	try {
		if (value !== undefined) {
			storage.setItem(key, value);
			return value;
		}
		return storage.getItem(key);
	} catch {
		return null;
	}
};

const getStorageValue = (storage: Storage, key: string): string => {
	const existing = safeStorage(storage, key);
	if (existing) return existing;
	const next = createId();
	safeStorage(storage, key, next);
	return next;
};

/** Truncate string values to max length (from A) */
const truncateValue = (value: unknown, maxLength: number): unknown => {
	if (typeof value === "string" && value.length > maxLength) {
		return value.slice(0, maxLength);
	}
	return value;
};

/** Normalize metadata: filter undefined, truncate strings (from A) */
const normalizeMetadata = (
	data: Record<string, unknown> | undefined,
	maxLength: number,
): Record<string, unknown> | undefined => {
	if (!data) return undefined;
	const entries = Object.entries(data)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => [k, truncateValue(v, maxLength)]);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const getUtmParams = (): Record<string, string> => {
	if (typeof window === "undefined") return {};
	const params = new URLSearchParams(window.location.search);
	const utm: Record<string, string> = {};
	for (const key of [
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
	]) {
		const value = params.get(key);
		if (value) utm[key.replace("utm_", "utm")] = value;
	}
	return utm;
};

const getViewportContext = (): Record<string, unknown> => {
	if (typeof window === "undefined") return {};
	return {
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight,
	};
};

// ── Tracker ──

export class UsageTracker {
	private readonly config: Required<
		Pick<
			UsageTrackerConfig,
			"endpoint" | "debug" | "storagePrefix" | "maxMetadataLength"
		>
	> &
		Pick<UsageTrackerConfig, "errorEndpoint" | "credentials" | "errorFilter">;
	private lastPagePath: string | null = null;
	private readonly onceKeys = new Set<string>();

	// Time synchronization
	private timeOffsetMs = 0;

	// Replay state
	private replayStopFn: (() => void) | null = null;
	private replayEvents: Record<string, unknown>[] = [];
	private replaySequence = 0;
	private replayInterval: ReturnType<typeof setInterval> | null = null;

	// Internal flag to track if we need to restart rrweb after a rotation
	private isRecording = false;

	/** API key for direct-to-collector mode */
	private readonly apiKey?: string;

	/** Consumer-supplied rrweb privacy overrides, merged with SDK defaults in startReplay(). */
	private readonly replayPrivacyOptions: ReplayPrivacyOptions;

	/** Whether we've already logged a clock-sync failure. Avoid log spam from
	 *  a misconfigured collector URL by only warning once per session. */
	private hasWarnedClockSync = false;

	constructor(config: UsageTrackerConfig) {
		// Resolve endpoint: collectorUrl+apiKey (new) or endpoint (legacy)
		const resolvedEndpoint = config.collectorUrl
			? `${config.collectorUrl.replace(/\/$/, "")}/v1/usage`
			: (config.endpoint ?? "");
		this.apiKey = config.apiKey;

		this.config = {
			endpoint: resolvedEndpoint,
			debug: config.debug ?? false,
			errorEndpoint: config.errorEndpoint,
			storagePrefix: config.storagePrefix ?? "usage",
			credentials: config.collectorUrl ? undefined : config.credentials,
			errorFilter: config.errorFilter,
			maxMetadataLength: config.maxMetadataLength ?? 160,
		};
		this.replayPrivacyOptions = config.replayPrivacyOptions ?? {};
		// Kick off time synchronization immediately without blocking
		this.syncTime().catch(() => {});
	}

	private async syncTime() {
		// Resolve the collector's root /health endpoint regardless of what
		// path was appended onto `endpoint` (e.g. /v1/usage for the new shape,
		// /events for the legacy shape). The previous .replace("/events", "")
		// silently no-op'd for the new shape, sending the request to
		// /v1/usage/health — a non-existent route under /v1/* auth that 401s
		// without CORS headers, which browsers then surface as a confusing
		// "CORS blocked" error. Use URL resolution instead so /health
		// always resolves to the origin root.
		let healthUrl: string;
		try {
			healthUrl = new URL("/health", this.config.endpoint).toString();
		} catch {
			this.warnClockSyncOnce("invalid endpoint URL", this.config.endpoint);
			return;
		}

		try {
			const start = performance.now();
			// Note: do NOT send `Cache-Control` here — adding it to the request
			// would force a CORS preflight that needs the collector to allow
			// it, and we already pass `cache: "no-store"` so the browser will
			// bypass HTTP cache without the header.
			const res = await fetch(healthUrl, {
				method: "GET",
				cache: "no-store",
			});
			if (!res.ok) {
				this.warnClockSyncOnce(`clock sync HTTP ${res.status}`, healthUrl);
				return;
			}
			const rtt = performance.now() - start;

			// Try to find a Date header which all normal servers append automatically
			const dateStr = res.headers.get("Date");
			if (dateStr) {
				const serverTime = new Date(dateStr).getTime();
				const localAssumeAtServerResp = Date.now() - rtt / 2;
				this.timeOffsetMs = serverTime - localAssumeAtServerResp;
				if (this.config.debug)
					console.log(
						"[analytics-sdk] clock synced, offset:",
						this.timeOffsetMs,
						"ms",
					);
			}
		} catch (e) {
			this.warnClockSyncOnce("clock sync failed", healthUrl, e);
		}
	}

	private warnClockSyncOnce(message: string, ...rest: unknown[]) {
		if (this.hasWarnedClockSync) return;
		this.hasWarnedClockSync = true;
		// Surface once at warn level so misconfiguration is visible without
		// debug=true, but don't spam the console on every retry.
		console.warn(`[analytics-sdk] ${message}`, ...rest);
	}

	private getNowAdjusted(): string {
		return new Date(Date.now() + this.timeOffsetMs).toISOString();
	}

	private checkAndRotateSession(): boolean {
		if (typeof sessionStorage === "undefined") return false;

		const activityKey = `${this.config.storagePrefix}_last_act`;
		const startKey = `${this.config.storagePrefix}_start_ts`;
		const sessionKey = `${this.config.storagePrefix}_session_id`;

		const now = Date.now();
		const lastAct = parseInt(
			safeStorage(sessionStorage, activityKey) || "0",
			10,
		);
		const startTs = parseInt(safeStorage(sessionStorage, startKey) || "0", 10);

		let rotated = false;
		// 30 min idle timeout OR 60 min hard cap
		if (
			(lastAct > 0 && now - lastAct > 30 * 60 * 1000) ||
			(startTs > 0 && now - startTs > 60 * 60 * 1000)
		) {
			safeStorage(sessionStorage, sessionKey, "");
			safeStorage(sessionStorage, startKey, "");
			safeStorage(sessionStorage, activityKey, "");
			rotated = true;
		}

		if (!safeStorage(sessionStorage, startKey)) {
			safeStorage(sessionStorage, startKey, now.toString());
		}

		return rotated;
	}

	private bumpActivity(): void {
		if (typeof sessionStorage !== "undefined") {
			safeStorage(
				sessionStorage,
				`${this.config.storagePrefix}_last_act`,
				Date.now().toString(),
			);
		}
	}

	public get sessionId(): string {
		const rotated = this.checkAndRotateSession();
		const id = getStorageValue(
			sessionStorage,
			`${this.config.storagePrefix}_session_id`,
		);

		if (rotated && this.isRecording && typeof window !== "undefined") {
			// Restart rrweb so the new session gets a FullSnapshot naturally
			if (this.config.debug)
				console.log("[analytics-sdk] session rotated, restarting recorder");
			this.stopReplay();
			this.startReplay();
		}

		return id;
	}

	private get visitorId(): string {
		return getStorageValue(
			localStorage,
			`${this.config.storagePrefix}_visitor_id`,
		);
	}

	private dispatch(events: UsageEventPayload[]): void {
		if (events.length === 0) return;
		this.bumpActivity();
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			if (this.apiKey) {
				headers["Authorization"] = `Bearer ${this.apiKey}`;
			}
			const init: RequestInit = {
				method: "POST",
				headers,
				body: JSON.stringify({ events }),
				keepalive: true,
			};
			if (this.config.credentials) {
				init.credentials = this.config.credentials;
			}
			fetch(this.config.endpoint, init).catch((error) => {
				if (this.config.debug)
					console.warn("[analytics-sdk] dispatch failed", error);
			});
		} catch (error) {
			if (this.config.debug)
				console.warn("[analytics-sdk] dispatch error", error);
		}
	}

	private dispatchError(payload: {
		message: string;
		name?: string;
		url?: string;
		stack?: string;
	}): void {
		if (!this.config.errorEndpoint) return;
		try {
			fetch(this.config.errorEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...payload,
					url: payload.url ?? window.location.href,
					timestamp: this.getNowAdjusted(),
					userAgent: navigator.userAgent,
				}),
				keepalive: true,
			}).catch(() => {});
		} catch {}
	}

	identify(userId: string, properties?: Record<string, unknown>): void {
		try {
			const baseUrl = this.config.endpoint.replace("/events", "");
			const identifyUrl = `${baseUrl}/identify`;
			const init: RequestInit = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					userId,
					visitorId: this.visitorId,
					properties,
				}),
				keepalive: true,
			};
			if (this.config.credentials) {
				init.credentials = this.config.credentials;
			}
			fetch(identifyUrl, init).catch((e) => {
				if (this.config.debug)
					console.warn("[analytics-sdk] identify failed", e);
			});
		} catch (e) {
			if (this.config.debug) console.warn("[analytics-sdk] identify error", e);
		}
	}

	private static readonly MAX_REPLAY_BUFFER = 500;

	startReplay(): void {
		if (typeof window === "undefined" || this.replayStopFn) return;
		if (this.replayInterval) return; // guard against double-start

		this.isRecording = true;
		// Ensure session is rotated if stale before we begin
		this.checkAndRotateSession();

		// Privacy: mask all user input to avoid capturing PII. SDK defaults are
		// safe out of the box; consumers can override via `replayPrivacyOptions`
		// (e.g. mask plain text inputs too, add blockSelector for marked
		// subtrees). Consumer values win on scalar/function fields; per-input
		// type masking is shallow-merged so opt-in additions don't lose the
		// SDK's PII protections.
		const overrides = this.replayPrivacyOptions;
		const recordOptions: Record<string, unknown> = {
			emit: (event: unknown) => {
				const ev = event as Record<string, unknown>;
				// Adjust rrweb's raw timestamp by adding server delta
				if (typeof ev.timestamp === "number" && this.timeOffsetMs) {
					ev.timestamp += this.timeOffsetMs;
				}
				// RFC 0004 — stamp the active interaction_id on each rrweb
				// event so the replay viewer can pivot from a click event
				// to its caused trace. Namespaced field to avoid colliding
				// with rrweb's reserved keys.
				const id = currentInteractionId();
				if (id !== undefined) ev.obsInteractionId = id;
				this.replayEvents.push(ev);
				if (this.replayEvents.length >= 50) {
					this.flushReplays();
				}
				// Hard cap: drop oldest if buffer grows too large (collector down, etc.)
				if (this.replayEvents.length > UsageTracker.MAX_REPLAY_BUFFER) {
					this.replayEvents = this.replayEvents.slice(-50);
				}
			},
			maskAllInputs: overrides.maskAllInputs ?? true,
			maskInputOptions: {
				password: true,
				email: true,
				tel: true,
				text: false,
				...(overrides.maskInputOptions ?? {}),
			},
			maskInputFn:
				overrides.maskInputFn ??
				((text: string) => "*".repeat(Math.min(text.length, 20))),
		};
		if (overrides.maskTextSelector !== undefined) {
			recordOptions.maskTextSelector = overrides.maskTextSelector;
		}
		if (overrides.maskTextFn !== undefined) {
			recordOptions.maskTextFn = overrides.maskTextFn;
		}
		if (overrides.blockSelector !== undefined) {
			recordOptions.blockSelector = overrides.blockSelector;
		}
		if (overrides.ignoreSelector !== undefined) {
			recordOptions.ignoreSelector = overrides.ignoreSelector;
		}
		this.replayStopFn = record(
			recordOptions as Parameters<typeof record>[0],
		) as () => void;

		this.replayInterval = setInterval(() => this.flushReplays(), 10000);
	}

	stopReplay(): void {
		// Flush remaining events before stopping
		this.flushReplays();
		if (this.replayStopFn) {
			this.replayStopFn();
			this.replayStopFn = null;
		}
		if (this.replayInterval) {
			clearInterval(this.replayInterval);
			this.replayInterval = null;
		}
		this.isRecording = false;
		this.replaySequence = 0;
		this.replayEvents = [];
	}

	flushReplays(): void {
		if (this.replayEvents.length === 0) return;
		const events = [...this.replayEvents];
		this.replayEvents = [];

		try {
			const baseUrl = this.config.endpoint.replace("/events", "");
			const replayUrl = `${baseUrl}/replays`;
			const init: RequestInit = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: this.sessionId,
					visitorId: this.visitorId,
					sequenceNumber: this.replaySequence++,
					events,
				}),
				keepalive: true,
			};
			if (this.config.credentials) {
				init.credentials = this.config.credentials;
			}
			fetch(replayUrl, init).catch((e) => {
				if (this.config.debug)
					console.warn("[analytics-sdk] replay flush failed", e);
			});
		} catch (e) {
			if (this.config.debug)
				console.warn("[analytics-sdk] replay flush error", e);
		}
	}

	trackPageView(path: string, title: string): void {
		// Page view deduplication (from P)
		if (this.lastPagePath === path) return;
		this.lastPagePath = path;

		const loadTime =
			typeof performance !== "undefined"
				? (
						performance.getEntriesByType?.(
							"navigation",
						)?.[0] as PerformanceNavigationTiming
					)?.duration
				: undefined;

		this.dispatch([
			{
				type: "page_view",
				name: "page_view",
				sessionId: this.sessionId,
				visitorId: this.visitorId,
				path,
				title,
				referrer: document.referrer || null,
				occurredAt: this.getNowAdjusted(),
				severity: "info",
				properties: {
					...getUtmParams(),
					...(Number.isFinite(loadTime)
						? { loadTimeMs: Math.round(loadTime!) }
						: {}),
				},
				context: getViewportContext(),
				interactionId: currentInteractionId(),
			},
		]);
	}

	trackInteraction(name: string, properties?: Record<string, unknown>): void {
		this.dispatch([
			{
				type: "interaction",
				name,
				sessionId: this.sessionId,
				visitorId: this.visitorId,
				path: window.location.pathname,
				title: document.title,
				occurredAt: this.getNowAdjusted(),
				severity: "info",
				properties: normalizeMetadata(
					properties,
					this.config.maxMetadataLength,
				),
				context: getViewportContext(),
				interactionId: currentInteractionId(),
			},
		]);
	}

	/** Track interaction only once per session (from A) */
	trackInteractionOnce(
		name: string,
		onceKey: string,
		properties?: Record<string, unknown>,
	): void {
		const key = `${name}:${onceKey}`;
		if (this.onceKeys.has(key)) return;
		const storageKey = `${this.config.storagePrefix}_once_${key}`;
		if (
			typeof sessionStorage !== "undefined" &&
			safeStorage(sessionStorage, storageKey)
		) {
			this.onceKeys.add(key);
			return;
		}
		this.onceKeys.add(key);
		if (typeof sessionStorage !== "undefined")
			safeStorage(sessionStorage, storageKey, "1");
		this.trackInteraction(name, properties);
	}

	trackError(error: {
		name?: string;
		message: string;
		stack?: string;
		component?: string;
		source?: string;
	}): void {
		// Error filter (from A)
		if (this.config.errorFilter && !this.config.errorFilter(error)) return;

		this.dispatch([
			{
				type: "frontend_error",
				name: "frontend_error",
				sessionId: this.sessionId,
				visitorId: this.visitorId,
				path: window.location.pathname,
				title: document.title,
				occurredAt: this.getNowAdjusted(),
				severity: "error",
				properties: normalizeMetadata(
					{
						errorName: error.name,
						errorMessage: error.message,
						errorStack: error.stack,
						component: error.component,
						errorSource: error.source,
					},
					this.config.maxMetadataLength,
				),
				context: getViewportContext(),
				interactionId: currentInteractionId(),
			},
		]);

		// Dual error reporting (from D)
		this.dispatchError({
			message: error.message,
			name: error.name,
			stack: error.stack,
		});
	}
}
