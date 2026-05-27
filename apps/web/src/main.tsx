import {
	AnalyticsErrorBoundary,
	AnalyticsProvider,
} from "@obs-unified/analytics-sdk/react";
import { AuthGate, ObsDashboardProvider } from "@obs-unified/dashboard";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
	<StrictMode>
		<AnalyticsProvider
			collectorUrl={
				import.meta.env.VITE_OBS_COLLECTOR_URL ?? "http://localhost:8790"
			}
			apiKey={import.meta.env.VITE_OBS_INGEST_KEY ?? ""}
			debug={true}
			trackPageViews={true}
			captureErrors={true}
			trackOutboundLinks={true}
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
