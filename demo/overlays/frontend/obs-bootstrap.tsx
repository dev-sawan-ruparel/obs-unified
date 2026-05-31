import { AnalyticsProvider } from "@obs-unified/analytics-sdk/react";
import type { ReactNode } from "react";

export function ObsBootstrap({ children }: { children: ReactNode }) {
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
			{children}
		</AnalyticsProvider>
	);
}
