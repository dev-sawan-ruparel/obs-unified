# obs-unified-docs

Documentation site for [obs-unified](https://github.com/dev-sawan-ruparel/obs-unified) — unified observability across traces, logs, AI calls, usage, replay, alerts, profiles, and analyses. Live at **[docs.obsunified.com](https://docs.obsunified.com)**.

Built with [Fumadocs](https://fumadocs.dev/) on React Router 7 (SPA, no Next.js).

## Prerequisites

- Node.js **22 LTS or newer** (`.nvmrc` pins to 22)
- pnpm **10+**
- For deploys: [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) authenticated via `wrangler login`

## Quick start

```bash
pnpm install      # postinstall runs fumadocs-mdx
pnpm dev          # http://localhost:3000
```

## Edit content

Markdown files live under [`content/docs/`](./content/docs/). Page order is controlled by [`content/docs/meta.json`](./content/docs/meta.json). Add a new page by creating `content/docs/<slug>.mdx` and appending the slug to `meta.json`.

Frontmatter shape:

```mdx
---
title: Page title
description: Short subtitle shown under the heading.
---
```

## Build

```bash
pnpm build        # → build/client/ (static SPA)
pnpm types:check  # react-router typegen + fumadocs-mdx + tsc --noEmit
```

Output under `build/client/` deploys to any static host.

## Deploy

The site deploys to **Cloudflare Pages** (project name: `obsunified-docs`).

```bash
pnpm deploy           # build + push to main
pnpm deploy:preview   # build + push to a preview branch
```

Wrangler must be authenticated first (one-time): `wrangler login`. The Cloudflare Pages project (`obsunified-docs`) and the `docs.obsunified.com` custom domain are already configured. See [DEPLOY.md](./DEPLOY.md) for the full custom-domain + DNS walkthrough.

## Sibling projects

| Repo | What it is |
|---|---|
| [`obs-unified`](https://github.com/dev-sawan-ruparel/obs-unified) | The product (collector + SDKs + dashboard). |
| [`presence`](https://github.com/dev-sawan-ruparel/obs-unified/tree/main/apps/website) | Landing page. Live at [obsunified.com](https://obsunified.com). |
| [`ci`](https://github.com/dev-sawan-ruparel/obs-unified/tree/main/infra/cloudflare) | Cloudflare deployment configuration and helpers. |

See the project overview at [github.com/dev-sawan-ruparel/obs-unified](https://github.com/dev-sawan-ruparel/obs-unified).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The canonical contribution guide lives in [obs-unified/CONTRIBUTING.md](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/CONTRIBUTING.md).
