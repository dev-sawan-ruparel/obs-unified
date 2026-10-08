import {
	generateInteractionId,
	withInteractionContext,
} from "@obsunified/analytics-sdk";
import {
	AnalyticsProvider,
	useAnalytics,
} from "@obsunified/analytics-sdk/react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

const INTERACTION_HEADER = "x-obs-interaction";

function ObsDemoInteractionBridge() {
	const analytics = useAnalytics();
	const latestInteraction = useRef<{ id: string; expiresAt: number } | null>(
		null,
	);

	useEffect(() => {
		const onClick = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const clickable = target?.closest?.(
				"button,a,[role='button'],input,select,textarea",
			);
			if (!clickable) return;

			const id = generateInteractionId();
			latestInteraction.current = {
				id,
				expiresAt: Date.now() + 5000,
			};

			const label =
				clickable.getAttribute("data-cy") ||
				clickable.getAttribute("aria-label") ||
				clickable.textContent?.trim().slice(0, 80) ||
				clickable.tagName.toLowerCase();

			withInteractionContext(id, () => {
				analytics.trackInteraction(`click:${label}`, {
					tag: clickable.tagName.toLowerCase(),
					label,
				});
			});
		};

		document.addEventListener("click", onClick, true);
		return () => document.removeEventListener("click", onClick, true);
	}, [analytics]);

	useEffect(() => {
		const originalFetch = window.fetch.bind(window);
		window.fetch = (input, init) => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url,
				window.location.origin,
			);
			const active = latestInteraction.current;
			if (
				active &&
				active.expiresAt > Date.now() &&
				url.origin === window.location.origin &&
				url.pathname.startsWith("/api/")
			) {
				const headers = new Headers(init?.headers);
				if (!headers.has(INTERACTION_HEADER)) {
					headers.set(INTERACTION_HEADER, active.id);
				}
				return originalFetch(input, { ...init, headers });
			}
			return originalFetch(input, init);
		};

		return () => {
			window.fetch = originalFetch;
		};
	}, []);

	return null;
}

export function ObsBootstrap({ children }: { children: ReactNode }) {
	if (typeof window === "undefined") return <>{children}</>;

	return (
		<AnalyticsProvider
			collectorUrl={
				process.env.NEXT_PUBLIC_OBS_COLLECTOR_URL ?? "http://localhost:8790"
			}
			apiKey={
				process.env.NEXT_PUBLIC_OBS_INGEST_KEY ??
				"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504"
			}
			autoCorrelate
			trackPageViews
			captureErrors
		>
			<ObsDemoInteractionBridge />
			{children}
		</AnalyticsProvider>
	);
}
