import {
	AnalyticsErrorBoundary,
	AnalyticsProvider,
} from "@obs/analytics-sdk/react";
import { ObsDashboardProvider } from "@obs/dashboard";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AnalyticsProvider
			collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL ?? "http://localhost:8790"}
			apiKey={import.meta.env.VITE_OBS_INGEST_KEY ?? ""}
			debug={true}
			trackPageViews={true}
			captureErrors={true}
			trackOutboundLinks={true}
			storagePrefix="obs_demo"
		>
			<ObsDashboardProvider basePath="/internal">
				<AnalyticsErrorBoundary
					context="App"
					fallback={
						<div className="flex items-center justify-center min-h-screen">
							<p className="text-red-600 text-sm">
								Something crashed. Check the telemetry dashboard.
							</p>
						</div>
					}
				>
					<App />
				</AnalyticsErrorBoundary>
			</ObsDashboardProvider>
		</AnalyticsProvider>
	</StrictMode>,
);
