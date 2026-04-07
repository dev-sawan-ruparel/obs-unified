import {
	AnalyticsErrorBoundary,
	AnalyticsProvider,
} from "@obs/analytics-sdk/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AnalyticsProvider
			endpoint="/api/usage/events"
			debug={true}
			trackPageViews={true}
			captureErrors={true}
			trackOutboundLinks={true}
			storagePrefix="obs_demo"
		>
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
		</AnalyticsProvider>
	</StrictMode>,
);
