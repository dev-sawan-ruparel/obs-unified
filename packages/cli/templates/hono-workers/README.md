# __APP_NAME__

Scaffolded by `obs-unified create` (Hono-on-Workers variant). Hono backend
deployed as a Cloudflare Worker, pre-wired with `@obsunified/telemetry-sdk`.

## Run locally

```bash
pnpm install
pnpm dev          # wrangler dev
pnpm typecheck    # tsc --noEmit
```

`wrangler.toml` sets `compatibility_flags = ["nodejs_compat"]`; the telemetry SDK
needs it, so keep it.

### Ingest key

The ingest key is a secret and does not live in `wrangler.toml`.

- **Local dev:** copy `.dev.vars.example` to `.dev.vars` and set
  `OBS_INGEST_KEY=<your key>` (wrangler loads `.dev.vars` automatically; it is
  never deployed). Scaffolding with `--ingest-key <key>` writes this file for
  you. Mint a key with `obs-unified keys mint`.
- **Production:** `wrangler secret put OBS_INGEST_KEY`.

Then call `curl http://localhost:8787/api/hello` and open your obs-unified
dashboard at `http://localhost:5173` (the collector API itself is at
`__COLLECTOR_URL__`) to see the trace under the **Traces** tab.

## Deploy

```bash
pnpm deploy
```

## What's wired

- A request middleware bootstraps `initObservability` per request.
- A root-span middleware creates a request span and calls
  `stampInteractionFromRequest` on it — that's the half of the click-to-trace
  pivot that lives on the server.
- A `createLogger`-emitted log is correlated to the request span.

## Pair with a browser

Pair this with `obs-unified create my-app` → pick `react-vite` for the matching
frontend. The browser SDK will set `x-obs-interaction` on outbound fetches; this
server reads it; the dashboard shows them joined.
