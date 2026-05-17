// Vanilla-TS template — no framework, just the analytics SDK's
// non-React surface. The auto-correlator hooks click / submit / keydown
// listeners at capture phase and patches window.fetch.

import {
	installAutoCorrelate,
	UsageTracker,
} from "@obs-unified/analytics-sdk";

const tracker = new UsageTracker({
	collectorUrl: import.meta.env.VITE_OBS_COLLECTOR_URL,
	apiKey: import.meta.env.VITE_OBS_INGEST_KEY,
	storagePrefix: "__APP_NAME__",
	trackPageViews: true,
	captureErrors: true,
});

installAutoCorrelate({ tracker });

// Once you know who the user is, identify them. The dashboard ties
// every signal back to this id.
tracker.identify("demo-user", { email: "demo@example.com" });

document.getElementById("hello")?.addEventListener("click", async () => {
	// The auto-correlator already minted an interaction_id for this
	// click. The fetch below carries it as `x-obs-interaction`.
	const res = await fetch("/api/hello");
	const body = await res.json();
	tracker.trackInteraction("hello_clicked", { status: res.status });
	console.log(body);
});
