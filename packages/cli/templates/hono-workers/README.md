# __APP_NAME__

Scaffolded by `obs-unified create` (Hono-on-Workers variant). Hono
backend deployed as a Cloudflare Worker, pre-wired with
`@obs-unified/telemetry-sdk`.

## Run locally

```bash
pnpm install
pnpm dev          # wrangler dev
```

Set the ingest key as a secret (it shouldn't live in `wrangler.toml`):

```bash
wrangler secret put OBS_INGEST_KEY
```

## Deploy

```bash
pnpm deploy
```

## What's wired

- A request middleware bootstraps `initObservability` per request.
- A root-span middleware creates a request span and calls
  `stampInteractionFromRequest` on it — that's the half of the
  click-to-trace pivot that lives on the server.
- A `createLogger`-emitted log is correlated to the request span.

## Pair with a browser

Pair this with `obs-unified create my-app` → pick `react-vite` for the
matching frontend. The browser SDK will set `x-obs-interaction` on
outbound fetches; this server reads it; the dashboard shows them
joined.
