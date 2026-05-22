import {
	AnalyticsErrorBoundary,
	AnalyticsProvider,
} from "@obs-unified/analytics-sdk/react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root element");

createRoot(rootEl).render(
	<AnalyticsProvider
		collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL}
		apiKey={import.meta.env.VITE_OBS_INGEST_KEY}
		trackPageViews
		captureErrors
		storagePrefix="__APP_NAME__"
	>
		<AnalyticsErrorBoundary
			context="App"
			fallback={<div>Something crashed.</div>}
		>
			<App />
		</AnalyticsErrorBoundary>
	</AnalyticsProvider>,
);
