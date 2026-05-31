# **APP_NAME**

Scaffolded by `obs-unified create` (vanilla-TypeScript variant). No framework —
just the analytics SDK's auto-correlator on a plain HTML page.

## Run

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:5173`, click the button, then check your collector
dashboard at `__COLLECTOR_URL__`.

## Adding a backend

This template only sends browser analytics. Pair it with any of:

- A React + Vite + Hono Node app (`obs-unified create my-app`)
- A Hono on Cloudflare Workers API (`obs-unified create my-api`)
- Your existing backend, instrumented per the
  [Tier 1 SDK docs](https://obs-unified-docs.dev/docs/instrumenting) or one of
  the
  [Tier 3 recipes](https://github.com/obs-unified/obs-unified/tree/main/docs/recipes).
