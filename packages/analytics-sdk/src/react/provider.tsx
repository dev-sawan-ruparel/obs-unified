import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { installAutoCorrelate } from "../auto-correlate";
import { wrapInteraction } from "../interaction";
import { UsageTracker, type UsageTrackerConfig } from "../usage-tracker";
import { AnalyticsContext, type AnalyticsContextValue } from "./context";

export interface AnalyticsProviderProps extends UsageTrackerConfig {
	children: ReactNode;
	trackPageViews?: boolean;
	captureErrors?: boolean;
	trackOutboundLinks?: boolean;
	/**
	 * RFC 0004 Mode A — install global click/submit/keydown listeners and
	 * patch `fetch` + `XMLHttpRequest` to inject the `x-obs-interaction`
	 * header on outbound calls. Default `true`.
	 *
	 * Disable if another instrumentation library already patches `fetch`
	 * and you want to avoid layered wrappers, or in non-browser hosts.
	 * Mode B (`useAnalytics().withInteraction`) is unaffected by this flag.
	 */
	autoCorrelate?: boolean;
}

export function AnalyticsProvider({
	children,
	trackPageViews = true,
	captureErrors = true,
	trackOutboundLinks = true,
	autoCorrelate = true,
	...config
}: AnalyticsProviderProps) {
	const trackerRef = useRef<UsageTracker | null>(null);
	if (!trackerRef.current) {
		trackerRef.current = new UsageTracker(config);
	}
	const tracker = trackerRef.current;

	// Auto page view tracking on SPA navigation
	useEffect(() => {
		if (!trackPageViews) return;

		const track = () => {
			const path =
				window.location.pathname +
				(window.location.hash ? window.location.hash : "");
			tracker.trackPageView(path, document.title);
		};
		track();

		const originalPushState = history.pushState.bind(history);
		const originalReplaceState = history.replaceState.bind(history);

		history.pushState = (...args) => {
			originalPushState(...args);
			track();
		};
		history.replaceState = (...args) => {
			originalReplaceState(...args);
			track();
		};
		window.addEventListener("popstate", track);

		return () => {
			history.pushState = originalPushState;
			history.replaceState = originalReplaceState;
			window.removeEventListener("popstate", track);
		};
	}, [tracker, trackPageViews]);

	// Global error capture
	useEffect(() => {
		if (!captureErrors) return;

		const onError = (event: ErrorEvent) => {
			tracker.trackError({
				name: event.error?.name ?? "Error",
				message: event.message,
				stack: event.error?.stack,
				source: "window_error",
			});
		};
		const onRejection = (event: PromiseRejectionEvent) => {
			const reason = event.reason;
			tracker.trackError({
				name: reason?.name ?? "UnhandledRejection",
				message: reason?.message ?? String(reason),
				stack: reason?.stack,
				source: "unhandled_rejection",
			});
		};

		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		return () => {
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
		};
	}, [tracker, captureErrors]);

	// RFC 0004 Mode A — auto-propagate interaction_id via global click
	// listener + fetch/XHR patch. Mounted once (the installer is
	// idempotent); cleaned up on unmount so HMR doesn't double-patch.
	useEffect(() => {
		if (!autoCorrelate) return;
		const cleanup = installAutoCorrelate();
		return cleanup;
	}, [autoCorrelate]);

	// Outbound link tracking
	useEffect(() => {
		if (!trackOutboundLinks) return;

		const onClick = (event: MouseEvent) => {
			const anchor = (event.target as HTMLElement).closest?.("a");
			if (!anchor?.href) return;
			try {
				const url = new URL(anchor.href, window.location.origin);
				if (url.origin !== window.location.origin) {
					tracker.trackInteraction("outbound_link_click", {
						href: anchor.href,
						text: anchor.textContent?.slice(0, 100),
					});
				}
			} catch {}
		};

		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, [tracker, trackOutboundLinks]);

	const value = useMemo(
		(): AnalyticsContextValue => ({
			tracker,
			trackInteraction: (name, properties) =>
				tracker.trackInteraction(name, properties),
			trackError: (error, context) => {
				const err =
					error instanceof Error
						? { name: error.name, message: error.message, stack: error.stack }
						: error;
				tracker.trackError({ ...err, component: context });
			},
			identify: (userId, properties) => tracker.identify(userId, properties),
			startReplay: () => tracker.startReplay(),
			fetch: (input, init) => {
				const headers = new Headers(init?.headers);
				headers.set("X-Obs-Session-Id", tracker.sessionId);
				return window.fetch(input, { ...init, headers });
			},
			withInteraction: wrapInteraction,
		}),
		[tracker],
	);

	return (
		<AnalyticsContext.Provider value={value}>
			{children}
		</AnalyticsContext.Provider>
	);
}
