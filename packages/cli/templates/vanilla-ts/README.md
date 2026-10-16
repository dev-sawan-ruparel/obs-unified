# __APP_NAME__

Scaffolded by `obs-unified create` (vanilla-TypeScript variant). No framework —
just the analytics SDK's auto-correlator on a plain HTML page.

## Run

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:5174`, click the button, then open your obs-unified
dashboard at `http://localhost:5173` to see the usage event. The collector API
(`__COLLECTOR_URL__`) is not the dashboard. This template uses port 5174 so it
does not collide with the dashboard's 5173.

`.env.local` sets `VITE_OBS_COLLECTOR_URL` and `VITE_OBS_INGEST_KEY`. Replace
the `dev-ingest-key` placeholder with a real key (`obs-unified keys mint`, or
scaffold with `--ingest-key <key>`) if the collector enforces ingest keys.

## Adding a backend

This template only sends browser analytics. Pair it with any of:

- A React + Vite + Hono Node app (`obs-unified create my-app`)
- A Hono on Cloudflare Workers API (`obs-unified create my-api`)
- Your existing backend, instrumented per the
  [Tier 1 SDK docs](https://docs.obsunified.com/docs/instrumenting) or one of
  the
  [Tier 3 recipes](https://github.com/dev-sawan-ruparel/obs-unified/tree/main/docs/recipes).
