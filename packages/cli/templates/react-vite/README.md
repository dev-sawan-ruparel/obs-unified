# __APP_NAME__

Scaffolded by `obs-unified create`. React + Vite frontend + Hono backend,
pre-wired with `@obsunified/analytics-sdk` and `@obsunified/telemetry-sdk`.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5174`. Click the button. Then open your obs-unified
dashboard at `http://localhost:5173` (the collector API is `__COLLECTOR_URL__`;
it is not the dashboard) and you'll see:

- A usage event on the **Usage** tab
- A root span + child spans on the **Traces** tab, both stamped with the same
  `interaction_id`
- A log line on the **Logs** tab, correlated to the trace
- (If you add an LLM call) an AI call on the **AI Calls** tab

## Configuration

`.env.local` (created at scaffold time from `.env.example`) holds:

| Variable                 | Used by                      |
| ------------------------ | ---------------------------- |
| `VITE_OBS_COLLECTOR_URL` | browser (Vite)               |
| `VITE_OBS_INGEST_KEY`    | browser (Vite)               |
| `OBS_COLLECTOR_URL`      | Hono API (`pnpm dev:api`)    |
| `OBS_INGEST_KEY`         | Hono API (`pnpm dev:api`)    |

`dev:api` loads `.env.local` itself (`tsx --env-file-if-exists=.env.local`).
Replace the `dev-ingest-key` placeholder with a real key (`obs-unified keys mint`,
or scaffold with `--ingest-key <key>`) when the collector enforces ingest keys;
otherwise exports are rejected with HTTP 401.

## What's wired

| File            | What it does                                                  |
| --------------- | ------------------------------------------------------------- |
| `src/main.tsx`  | Wraps the app in `AnalyticsProvider` — auto-correlates clicks |
| `src/App.tsx`   | Identifies a user; demos a button → fetch → trace pivot       |
| `src/server.ts` | Hono backend with `stampInteractionFromRequest` middleware    |

## Going further

- Read [docs/instrumenting](https://docs.obsunified.com/docs/instrumenting) for
  the full set of primitives.
- The button is auto-tracked. Switch to `trackInteraction("event_name", {...})`
  for business-meaningful events.
- Add `withChildSpan("db.query", fn)` around DB calls — they'll show up as child
  spans under the root.
