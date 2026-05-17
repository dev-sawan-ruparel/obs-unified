# Migrating from PostHog

obs-unified covers PostHog's session replay, event analytics, and user
profile surfaces — plus traces, logs, and AI call tracking that PostHog
doesn't ship. This page maps PostHog's mental model to obs-unified's so
you can rewire your app incrementally.

## Concept mapping

| PostHog | obs-unified |
| --- | --- |
| Event (`capture()`) | Usage event (`trackInteraction()`) |
| Person | User profile (via `identify()`) |
| Session recording | Session replay (rrweb, same wire format) |
| Distinct ID | Visitor ID (auto) + User ID (post-`identify`) |
| Feature flag | (not provided — keep PostHog or LaunchDarkly for flags) |
| Funnel | Not yet — use the Usage tab's path filter for ad-hoc funnels |
| Insight / dashboard widget | The dashboard's per-tab views |

## SDK swap — browser

```diff
- import posthog from "posthog-js";
- posthog.init("phc_…", { api_host: "https://us.i.posthog.com" });
+ import { AnalyticsProvider } from "@obs-unified/analytics-sdk/react";
+ <AnalyticsProvider
+   collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL}
+   apiKey={import.meta.env.VITE_OBS_INGEST_KEY}
+   trackPageViews
+   captureErrors
+ >
+   <App />
+ </AnalyticsProvider>

- posthog.capture("checkout_clicked", { plan: "pro" });
+ const { trackInteraction } = useAnalytics();
+ trackInteraction("checkout_clicked", { plan: "pro" });

- posthog.identify("user-42", { email });
+ identify("user-42", { email });
```

## What you GAIN

- **End-to-end trace correlation.** A click in the browser ties to the
  exact span(s) it caused on the server. PostHog can't show you which
  database query a click triggered; obs-unified can.
- **AI call tracking.** Token counts, cost, latency by model and user.
- **Self-hosted on your infrastructure.** No data leaves your cloud.

## What you LOSE (today)

- **Feature flags.** Keep PostHog/LaunchDarkly for that surface.
- **Funnels + cohort builder.** The Usage tab supports path-level
  ad-hoc filtering; multi-step funnels are on the roadmap but not yet
  shipped.
- **Mature SDK ecosystem.** PostHog has Python/Ruby/PHP/iOS/Android
  SDKs. obs-unified ships first-party SDKs for browsers, Node, Go,
  Rust today; other languages adopt via the
  [`docs/recipes/`](../recipes/) cookbook.

## Backfilling history

obs-unified accepts a `firstSeenAt` field on `/v1/identify` so you can
backfill users without erasing their original signup date:

```ts
await fetch(`${collector}/v1/identify`, {
	method: "POST",
	body: JSON.stringify({
		userId: "user-42",
		email: "alice@example.com",
		firstSeenAt: "2024-01-15T08:30:00Z",  // ISO-8601, must be in the past
	}),
});
```

Event-level backfill is not yet supported — obs-unified does not
provide a CSV-import path for historical PostHog events. Plan to run
both systems in parallel during the cutover window if you need
historical continuity.
