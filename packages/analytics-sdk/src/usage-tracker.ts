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

// ── Public config ──

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
}

// ── Helpers ──

const createId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

const safeStorage = (storage: Storage, key: string, value?: string): string | null => {
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

	constructor(config: UsageTrackerConfig) {
		// Resolve endpoint: collectorUrl+apiKey (new) or endpoint (legacy)
		const resolvedEndpoint = config.collectorUrl
			? `${config.collectorUrl.replace(/\/$/, "")}/v1/usage`
			: config.endpoint ?? "";
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
		// Kick off time synchronization immediately without blocking
		this.syncTime().catch(() => {});
	}

	private async syncTime() {
		try {
			const start = performance.now();
			const baseUrl = this.config.endpoint.replace("/events", "");
			// Note: do NOT send `Cache-Control` here — adding it to the request
			// would force a CORS preflight that needs the collector to allow
			// it, and we already pass `cache: "no-store"` so the browser will
			// bypass HTTP cache without the header.
			const res = await fetch(`${baseUrl}/health`, {
				method: "GET",
				cache: "no-store",
			});
			if (!res.ok) return;
			const rtt = performance.now() - start;
			
			// Try to find a Date header which all normal servers append automatically
			const dateStr = res.headers.get("Date");
			if (dateStr) {
				const serverTime = new Date(dateStr).getTime();
				const localAssumeAtServerResp = Date.now() - (rtt / 2);
				this.timeOffsetMs = serverTime - localAssumeAtServerResp;
				if (this.config.debug) console.log("[analytics-sdk] clock synced, offset:", this.timeOffsetMs, "ms");
			}
		} catch (e) {
			if (this.config.debug) console.warn("[analytics-sdk] failed to sync time", e);
		}
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
		const lastAct = parseInt(safeStorage(sessionStorage, activityKey) || "0", 10);
		const startTs = parseInt(safeStorage(sessionStorage, startKey) || "0", 10);

		let rotated = false;
		// 30 min idle timeout OR 60 min hard cap
		if ((lastAct > 0 && now - lastAct > 30 * 60 * 1000) ||
			(startTs > 0 && now - startTs > 60 * 60 * 1000)) {
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
			safeStorage(sessionStorage, `${this.config.storagePrefix}_last_act`, Date.now().toString());
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
			if (this.config.debug) console.log("[analytics-sdk] session rotated, restarting recorder");
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
			const headers: Record<string, string> = { "Content-Type": "application/json" };
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
				if (this.config.debug) console.warn("[analytics-sdk] identify failed", e);
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

		this.replayStopFn = record({
			emit: (event) => {
				const ev = event as Record<string, unknown>;
				// Adjust rrweb's raw timestamp by adding server delta
				if (typeof ev.timestamp === "number" && this.timeOffsetMs) {
					ev.timestamp += this.timeOffsetMs;
				}
				this.replayEvents.push(ev);
				if (this.replayEvents.length >= 50) {
					this.flushReplays();
				}
				// Hard cap: drop oldest if buffer grows too large (collector down, etc.)
				if (this.replayEvents.length > UsageTracker.MAX_REPLAY_BUFFER) {
					this.replayEvents = this.replayEvents.slice(-50);
				}
			},
			// Privacy: mask all user input to avoid capturing PII
			maskAllInputs: true,
			maskInputOptions: {
				password: true,
				email: true,
				tel: true,
				text: false,
			},
			// Mask text in these selectors (forms, sensitive areas)
			maskInputFn: (text: string) => "*".repeat(Math.min(text.length, 20)),
		}) as (() => void);

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
				if (this.config.debug) console.warn("[analytics-sdk] replay flush failed", e);
			});
		} catch (e) {
			if (this.config.debug) console.warn("[analytics-sdk] replay flush error", e);
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
		if (typeof sessionStorage !== "undefined" && safeStorage(sessionStorage, storageKey)) {
			this.onceKeys.add(key);
			return;
		}
		this.onceKeys.add(key);
		if (typeof sessionStorage !== "undefined") safeStorage(sessionStorage, storageKey, "1");
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
