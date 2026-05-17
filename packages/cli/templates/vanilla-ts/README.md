# __APP_NAME__

Scaffolded by `obs-unified create` (vanilla-TypeScript variant). No
framework — just the analytics SDK's auto-correlator on a plain HTML
page.

## Run

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:5173`, click the button, then check your
collector dashboard at `__COLLECTOR_URL__`.

## Adding a backend

Pair this with any of:

- A Hono backend on Node (`obs-unified create my-api` → pick `hono-node`)
- A Hono backend on Cloudflare Workers (`obs-unified create my-api` → pick `hono-workers`)
- Your existing backend, instrumented per the
  [Tier 1 SDK docs](https://obs-unified-docs.dev/docs/instrumenting)
  or one of the [Tier 3 recipes](https://github.com/obs-unified/obs-unified/tree/main/docs/recipes).
