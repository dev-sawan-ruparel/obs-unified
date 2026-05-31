# **APP_NAME**

Scaffolded by `obs-unified create`. React + Vite frontend + Hono backend,
pre-wired with `@obs-unified/analytics-sdk` and `@obs-unified/telemetry-sdk`.

## Run

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Click the button. Then open your obs-unified
dashboard (`__COLLECTOR_URL__`) and you'll see:

- A usage event on the **Usage** tab
- A root span + child spans on the **Traces** tab, both stamped with the same
  `interaction_id`
- A log line on the **Logs** tab, correlated to the trace
- (If you add an LLM call) an AI call on the **AI Calls** tab

## What's wired

| File            | What it does                                                  |
| --------------- | ------------------------------------------------------------- |
| `src/main.tsx`  | Wraps the app in `AnalyticsProvider` — auto-correlates clicks |
| `src/App.tsx`   | Identifies a user; demos a button → fetch → trace pivot       |
| `src/server.ts` | Hono backend with `stampInteractionFromRequest` middleware    |

## Going further

- Read [docs/instrumenting](https://obs-unified-docs.dev/docs/instrumenting) for
  the full set of primitives.
- The button is auto-tracked. Switch to `trackInteraction("event_name", {...})`
  for business-meaningful events.
- Add `withChildSpan("db.query", fn)` around DB calls — they'll show up as child
  spans under the root.
