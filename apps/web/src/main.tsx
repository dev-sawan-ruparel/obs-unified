import {
	AnalyticsErrorBoundary,
	AnalyticsProvider,
} from "@obsunified/analytics-sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthGate } from "../../../packages/dashboard/src/AuthGate";
import { ObsDashboardProvider } from "../../../packages/dashboard/src/provider";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const ingestKey = import.meta.env.VITE_OBS_INGEST_KEY ?? "";
const analyticsEnabled = ingestKey.trim().length > 0;

createRoot(root).render(
	<StrictMode>
		<AnalyticsProvider
			collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL ?? "/"}
			apiKey={ingestKey}
			debug={
				import.meta.env.DEV &&
				import.meta.env.VITE_OBS_ANALYTICS_DEBUG === "true"
			}
			trackPageViews={analyticsEnabled}
			captureErrors={analyticsEnabled}
			trackOutboundLinks={analyticsEnabled}
			storagePrefix="obs_demo"
		>
			<ObsDashboardProvider basePath="/internal">
				<AuthGate>
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
				</AuthGate>
			</ObsDashboardProvider>
		</AnalyticsProvider>
	</StrictMode>,
);
